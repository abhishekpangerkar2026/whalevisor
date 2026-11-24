import type { Host, Vm } from '../types.ts';

/**
 * What the control plane needs from the hypervisor on each host.
 *
 * MockDriver implements it in memory. A Cloud Hypervisor driver will
 * implement it by calling the per-VM REST API (vm.create, vm.boot,
 * vm.shutdown, vm.delete, vm.send-migration / vm.receive-migration)
 * through an agent on each host.
 */
export interface HypervisorDriver {
  readonly name: string;
  create(vm: Vm, host: Host): Promise<void>;
  start(vm: Vm, host: Host): Promise<void>;
  stop(vm: Vm, host: Host, force: boolean): Promise<void>;
  delete(vm: Vm, host: Host): Promise<void>;
  migrate(vm: Vm, from: Host, to: Host): Promise<void>;
}
