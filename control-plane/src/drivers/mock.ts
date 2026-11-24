import type { Host, Vm } from '../types.ts';
import type { HypervisorDriver } from './driver.ts';

type MockState = 'stopped' | 'running';

/** Keeps VM state in memory so the control plane can run without KVM. */
export class MockDriver implements HypervisorDriver {
  readonly name = 'mock';
  /** vmId -> where the mock "hypervisor" thinks it is and whether it runs. */
  readonly vms = new Map<string, { hostId: string; state: MockState }>();
  /** Set to make the next call fail, for testing error handling. */
  failNext?: string;
  private delayMs: number;

  constructor(delayMs = 0) {
    this.delayMs = delayMs;
  }

  private async step(op: string): Promise<void> {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.failNext) {
      const msg = this.failNext;
      this.failNext = undefined;
      throw new Error(`${op} failed: ${msg}`);
    }
  }

  private get(vm: Vm) {
    const s = this.vms.get(vm.id);
    if (!s) throw new Error(`mock: unknown VM ${vm.id}`);
    return s;
  }

  async create(vm: Vm, host: Host) {
    await this.step('create');
    this.vms.set(vm.id, { hostId: host.id, state: 'stopped' });
  }

  async start(vm: Vm) {
    await this.step('start');
    this.get(vm).state = 'running';
  }

  async stop(vm: Vm) {
    await this.step('stop');
    this.get(vm).state = 'stopped';
  }

  async delete(vm: Vm) {
    await this.step('delete');
    this.vms.delete(vm.id);
  }

  async migrate(vm: Vm, _from: Host, to: Host) {
    await this.step('migrate');
    this.get(vm).hostId = to.id;
  }
}
