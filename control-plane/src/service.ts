import { randomUUID } from 'node:crypto';
import type { HypervisorDriver } from './drivers/driver.ts';
import { choosePlacement, fits, usageByHost, type Placement } from './placement.ts';
import { Store } from './store.ts';
import { ApiError, SIZES, type Host, type Size, type Vm, type VmStatus } from './types.ts';

const NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export interface CreateVmInput {
  name: string;
  image: string;
  size?: string;
  vcpus?: number;
  memoryGiB?: number;
  gpus?: number;
  tenant?: string;
  /** Omit to let the control plane choose. */
  hostId?: string;
  start?: boolean;
}

export interface AddHostInput {
  name: string;
  address: string;
  cpus: number;
  memoryGiB: number;
  gpus?: number;
}

function checkName(name: unknown): string {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    throw new ApiError(400, 'invalid_name', 'Name must be 1-63 lowercase letters, digits or hyphens, not starting or ending with a hyphen.');
  }
  return name;
}

function positiveInt(value: unknown, field: string, min = 1): number {
  if (!Number.isInteger(value) || (value as number) < min) {
    throw new ApiError(400, 'invalid_field', `${field} must be a whole number of at least ${min}.`);
  }
  return value as number;
}

export class Service {
  readonly store: Store;
  readonly driver: HypervisorDriver;
  /** VMs with an operation in flight; a second request for one gets 409. */
  private busy = new Set<string>();

  constructor(store: Store, driver: HypervisorDriver) {
    this.store = store;
    this.driver = driver;
  }

  private async exclusive<T>(vm: Vm, fn: () => Promise<T>): Promise<T> {
    if (this.busy.has(vm.id)) throw new ApiError(409, 'vm_busy', `Another operation on ${vm.name} is still running.`);
    this.busy.add(vm.id);
    try {
      return await fn();
    } finally {
      this.busy.delete(vm.id);
    }
  }

  // ---- Hosts ----

  listHosts() {
    const usage = usageByHost(this.store.hosts.values(), this.store.vms.values());
    return [...usage.values()].map((u) => ({
      ...u.host,
      allocated: { vcpus: u.vcpus, memoryGiB: u.memoryGiB, gpus: u.gpus },
      vmCount: u.vmCount,
    }));
  }

  getHost(id: string): Host {
    const h = this.store.hosts.get(id);
    if (!h) throw new ApiError(404, 'host_not_found', `No server with id ${id}.`);
    return h;
  }

  addHost(input: AddHostInput, by: string): Host {
    const name = checkName(input.name);
    if ([...this.store.hosts.values()].some((h) => h.name === name)) {
      throw new ApiError(409, 'host_exists', `A server named ${name} already exists.`);
    }
    if (typeof input.address !== 'string' || !input.address) {
      throw new ApiError(400, 'invalid_field', 'address is required.');
    }
    const host: Host = {
      id: randomUUID(),
      name,
      address: input.address,
      status: 'healthy',
      cpus: positiveInt(input.cpus, 'cpus'),
      memoryGiB: positiveInt(input.memoryGiB, 'memoryGiB'),
      gpus: input.gpus === undefined ? 0 : positiveInt(input.gpus, 'gpus', 0),
      addedAt: new Date().toISOString(),
    };
    this.store.hosts.set(host.id, host);
    this.store.log({ action: 'host.added', by, hostId: host.id, detail: `Added server ${name}` });
    this.store.save();
    return host;
  }

  /**
   * Entering maintenance moves every VM off the server first. The whole move
   * is planned before anything changes, so it either all fits or nothing moves.
   */
  async setMaintenance(id: string, enabled: boolean, by: string): Promise<Host> {
    const host = this.getHost(id);
    if (!enabled) {
      host.status = 'healthy';
      this.store.log({ action: 'host.maintenance_off', by, hostId: id, detail: `${host.name} left maintenance mode` });
      this.store.save();
      return host;
    }
    if (host.status === 'maintenance') return host;

    const residents = [...this.store.vms.values()].filter((v) => v.hostId === id);
    const busy = residents.find((v) => v.status === 'creating' || v.status === 'migrating');
    if (busy) throw new ApiError(409, 'vm_busy', `${busy.name} is ${busy.status}; try again when it finishes.`);

    // Plan against a copy so each placement sees the ones before it.
    const others = [...this.store.hosts.values()].filter((h) => h.id !== id);
    const planned = [...this.store.vms.values()].map((v) => ({ ...v }));
    const moves: { vm: Vm; to: string }[] = [];
    for (const vm of residents.sort((a, b) => b.memoryGiB - a.memoryGiB)) {
      const p = choosePlacement(vm.name, vm, others, planned.filter((v) => v.id !== vm.id));
      if (!p) throw new ApiError(409, 'no_capacity', `Not enough room on other servers for ${vm.name}; nothing was moved.`);
      moves.push({ vm, to: p.hostId });
      planned.find((v) => v.id === vm.id)!.hostId = p.hostId;
    }

    host.status = 'maintenance';
    this.store.save();
    for (const m of moves) await this.moveVm(m.vm, m.to, by, `evacuating ${host.name}`);
    this.store.log({ action: 'host.maintenance_on', by, hostId: id, detail: `${host.name} entered maintenance mode; ${moves.length} VMs moved` });
    this.store.save();
    return host;
  }

  // ---- VMs ----

  listVms(filter: { status?: string; hostId?: string; tenant?: string } = {}): Vm[] {
    return [...this.store.vms.values()]
      .filter((v) => !filter.status || v.status === filter.status)
      .filter((v) => !filter.hostId || v.hostId === filter.hostId)
      .filter((v) => !filter.tenant || v.tenant === filter.tenant)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getVm(id: string): Vm {
    const vm = this.store.vms.get(id);
    if (!vm) throw new ApiError(404, 'vm_not_found', `No VM with id ${id}.`);
    return vm;
  }

  resolveSize(input: Pick<CreateVmInput, 'size' | 'vcpus' | 'memoryGiB' | 'gpus'>): Size {
    if (input.size !== undefined) {
      const preset = SIZES[input.size];
      if (!preset) throw new ApiError(400, 'invalid_size', `size must be one of: ${Object.keys(SIZES).join(', ')}.`);
      return { ...preset };
    }
    return {
      vcpus: positiveInt(input.vcpus, 'vcpus'),
      memoryGiB: positiveInt(input.memoryGiB, 'memoryGiB'),
      gpus: input.gpus === undefined ? 0 : positiveInt(input.gpus, 'gpus', 0),
    };
  }

  previewPlacement(name: string, size: Size): Placement {
    const p = choosePlacement(checkName(name), size, this.store.hosts.values(), this.store.vms.values());
    if (!p) throw new ApiError(409, 'no_capacity', 'No healthy server has room for a VM of this size.');
    return p;
  }

  async createVm(input: CreateVmInput, by: string): Promise<{ vm: Vm; placement: Placement }> {
    const name = checkName(input.name);
    if ([...this.store.vms.values()].some((v) => v.name === name)) {
      throw new ApiError(409, 'vm_exists', `A VM named ${name} already exists.`);
    }
    if (typeof input.image !== 'string' || !input.image) throw new ApiError(400, 'invalid_field', 'image is required.');
    const size = this.resolveSize(input);

    let placement: Placement;
    if (input.hostId) {
      const host = this.getHost(input.hostId);
      if (host.status !== 'healthy') throw new ApiError(409, 'host_unavailable', `${host.name} is ${host.status}.`);
      const u = usageByHost([host], this.store.vms.values()).get(host.id)!;
      if (!fits(u, size)) throw new ApiError(409, 'no_capacity', `${host.name} does not have room for this VM.`);
      placement = { hostId: host.id, reason: 'chosen by user' };
    } else {
      placement = this.previewPlacement(name, size);
    }

    const vm: Vm = {
      id: randomUUID(),
      name,
      status: 'creating',
      hostId: placement.hostId,
      image: input.image,
      ...size,
      tenant: input.tenant ?? 'default',
      createdAt: new Date().toISOString(),
    };
    this.store.vms.set(vm.id, vm);
    const host = this.getHost(vm.hostId);

    try {
      await this.driver.create(vm, host);
      vm.status = 'stopped';
      if (input.start) {
        await this.driver.start(vm, host);
        vm.status = 'running';
      }
    } catch (err) {
      vm.status = 'error';
      vm.error = (err as Error).message;
    }
    this.store.log({ action: 'vm.created', by, vmId: vm.id, hostId: vm.hostId, detail: `Created ${name} on ${host.name} (${placement.reason})` });
    this.store.save();
    return { vm, placement };
  }

  private requireStatus(vm: Vm, allowed: VmStatus[], action: string) {
    if (!allowed.includes(vm.status)) {
      throw new ApiError(409, 'invalid_state', `Cannot ${action} ${vm.name} while it is ${vm.status}.`);
    }
  }

  private run(vm: Vm, allowed: VmStatus[], action: string, by: string, op: () => Promise<void>, next: VmStatus) {
    return this.exclusive(vm, async () => {
      this.requireStatus(vm, allowed, action);
      try {
        await op();
      } catch (err) {
        throw new ApiError(502, 'hypervisor_error', (err as Error).message);
      }
      vm.status = next;
      vm.error = undefined;
      this.store.log({ action: `vm.${action}`, by, vmId: vm.id, hostId: vm.hostId, detail: `${action} ${vm.name}` });
      this.store.save();
    });
  }

  async startVm(id: string, by: string): Promise<Vm> {
    const vm = this.getVm(id);
    await this.run(vm, ['stopped'], 'start', by, () => this.driver.start(vm, this.getHost(vm.hostId)), 'running');
    return vm;
  }

  async stopVm(id: string, force: boolean, by: string): Promise<Vm> {
    const vm = this.getVm(id);
    await this.run(vm, force ? ['running', 'error'] : ['running'], 'stop', by, () => this.driver.stop(vm, this.getHost(vm.hostId), force), 'stopped');
    return vm;
  }

  async deleteVm(id: string, by: string): Promise<void> {
    const vm = this.getVm(id);
    await this.exclusive(vm, async () => {
      this.requireStatus(vm, ['stopped', 'error'], 'delete');
      try {
        await this.driver.delete(vm, this.getHost(vm.hostId));
      } catch (err) {
        // A VM that failed to create may not exist on the host at all.
        if (vm.status !== 'error') throw new ApiError(502, 'hypervisor_error', (err as Error).message);
      }
      this.store.vms.delete(id);
      this.store.log({ action: 'vm.deleted', by, vmId: id, hostId: vm.hostId, detail: `Deleted ${vm.name}` });
      this.store.save();
    });
  }

  async migrateVm(id: string, targetHostId: string | undefined, by: string): Promise<{ vm: Vm; placement: Placement }> {
    const vm = this.getVm(id);
    this.requireStatus(vm, ['running', 'stopped'], 'migrate');
    let placement: Placement;
    if (targetHostId) {
      const target = this.getHost(targetHostId);
      if (target.id === vm.hostId) throw new ApiError(400, 'same_host', `${vm.name} is already on ${target.name}.`);
      if (target.status !== 'healthy') throw new ApiError(409, 'host_unavailable', `${target.name} is ${target.status}.`);
      const u = usageByHost([target], this.store.vms.values()).get(target.id)!;
      if (!fits(u, vm)) throw new ApiError(409, 'no_capacity', `${target.name} does not have room for ${vm.name}.`);
      placement = { hostId: target.id, reason: 'chosen by user' };
    } else {
      const p = choosePlacement(vm.name, vm, this.store.hosts.values(), [...this.store.vms.values()].filter((v) => v.id !== vm.id), [vm.hostId]);
      if (!p) throw new ApiError(409, 'no_capacity', `No other healthy server has room for ${vm.name}.`);
      placement = p;
    }
    await this.moveVm(vm, placement.hostId, by, placement.reason);
    return { vm, placement };
  }

  private moveVm(vm: Vm, toId: string, by: string, why: string) {
    return this.exclusive(vm, () => this.moveVmLocked(vm, toId, by, why));
  }

  private async moveVmLocked(vm: Vm, toId: string, by: string, why: string) {
    this.requireStatus(vm, ['running', 'stopped'], 'migrate');
    const from = this.getHost(vm.hostId);
    const to = this.getHost(toId);
    const before = vm.status;
    vm.status = 'migrating';
    vm.migratingTo = to.id;
    this.store.save();
    try {
      await this.driver.migrate(vm, from, to);
      vm.hostId = to.id;
    } catch (err) {
      vm.status = before;
      vm.migratingTo = undefined;
      this.store.save();
      throw new ApiError(502, 'hypervisor_error', (err as Error).message);
    }
    vm.status = before;
    vm.migratingTo = undefined;
    this.store.log({ action: 'vm.migrated', by, vmId: vm.id, hostId: to.id, detail: `Moved ${vm.name} from ${from.name} to ${to.name} (${why})` });
    this.store.save();
  }
}
