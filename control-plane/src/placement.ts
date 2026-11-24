import type { Host, Size, Vm } from './types.ts';

/** vCPUs may be overcommitted; memory and GPUs may not. */
export const CPU_OVERCOMMIT = 4;

export interface HostUsage {
  host: Host;
  vcpus: number;
  memoryGiB: number;
  gpus: number;
  vmCount: number;
}

export interface Placement {
  hostId: string;
  reason: string;
}

/** VMs named like erp-app-01 and erp-app-02 belong to group "erp-app". */
export function groupOf(name: string): string {
  return name.replace(/-\d+$/, '');
}

export function usageByHost(hosts: Iterable<Host>, vms: Iterable<Vm>): Map<string, HostUsage> {
  const usage = new Map<string, HostUsage>();
  for (const host of hosts) usage.set(host.id, { host, vcpus: 0, memoryGiB: 0, gpus: 0, vmCount: 0 });
  for (const vm of vms) {
    // A migrating VM holds resources on both ends until it lands.
    for (const id of vm.migratingTo ? [vm.hostId, vm.migratingTo] : [vm.hostId]) {
      const u = usage.get(id);
      if (!u) continue;
      u.vcpus += vm.vcpus;
      u.memoryGiB += vm.memoryGiB;
      u.gpus += vm.gpus;
      u.vmCount += 1;
    }
  }
  return usage;
}

export function fits(u: HostUsage, size: Size): boolean {
  return (
    u.vcpus + size.vcpus <= u.host.cpus * CPU_OVERCOMMIT &&
    u.memoryGiB + size.memoryGiB <= u.host.memoryGiB &&
    u.gpus + size.gpus <= u.host.gpus
  );
}

/** Load after placing the VM: the higher of CPU and memory use, 0 to 1. */
function loadAfter(u: HostUsage, size: Size): number {
  return Math.max(
    (u.vcpus + size.vcpus) / (u.host.cpus * CPU_OVERCOMMIT),
    (u.memoryGiB + size.memoryGiB) / u.host.memoryGiB,
  );
}

/**
 * Picks the healthy host with the lowest load after placement, keeping VMs of
 * the same group on different hosts where possible.
 *
 * This uses current allocations only. Whale AI will later replace the load
 * figure with a 7-day forecast, as described on the Create VM screen.
 */
export function choosePlacement(
  name: string,
  size: Size,
  hosts: Iterable<Host>,
  vms: Iterable<Vm>,
  exclude: string[] = [],
): Placement | null {
  const vmList = [...vms];
  const group = groupOf(name);
  const siblingHosts = new Set(
    vmList.filter((v) => v.name !== name && groupOf(v.name) === group).flatMap((v) => [v.hostId, v.migratingTo ?? v.hostId]),
  );

  const candidates = [...usageByHost(hosts, vmList).values()]
    .filter((u) => u.host.status === 'healthy' && !exclude.includes(u.host.id) && fits(u, size))
    .map((u) => ({ u, load: loadAfter(u, size), apart: !siblingHosts.has(u.host.id) }))
    .sort((a, b) => Number(b.apart) - Number(a.apart) || a.load - b.load || a.u.host.name.localeCompare(b.u.host.name));

  const best = candidates[0];
  if (!best) return null;
  const pct = Math.round(best.load * 100);
  const reasons = [`lowest load after placement (${pct}%)`];
  if (siblingHosts.size > 0) {
    reasons.push(best.apart ? `kept apart from other ${group} VMs` : `no host free of other ${group} VMs`);
  }
  return { hostId: best.u.host.id, reason: reasons.join('; ') };
}
