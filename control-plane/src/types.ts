export type VmStatus = 'creating' | 'stopped' | 'running' | 'migrating' | 'error';
export type HostStatus = 'healthy' | 'needs_attention' | 'maintenance';

export interface Host {
  id: string;
  name: string;
  address: string;
  status: HostStatus;
  cpus: number;
  memoryGiB: number;
  gpus: number;
  addedAt: string;
}

export interface Vm {
  id: string;
  name: string;
  status: VmStatus;
  hostId: string;
  image: string;
  vcpus: number;
  memoryGiB: number;
  gpus: number;
  tenant: string;
  createdAt: string;
  /** Set while status is 'migrating'. */
  migratingTo?: string;
  error?: string;
}

export interface Activity {
  at: string;
  action: string;
  by: string;
  vmId?: string;
  hostId?: string;
  detail: string;
}

export interface Size {
  vcpus: number;
  memoryGiB: number;
  gpus: number;
}

/** Presets shown in the Create VM wizard. */
export const SIZES: Record<string, Size> = {
  small: { vcpus: 2, memoryGiB: 4, gpus: 0 },
  medium: { vcpus: 8, memoryGiB: 32, gpus: 0 },
  large: { vcpus: 16, memoryGiB: 64, gpus: 0 },
  gpu: { vcpus: 16, memoryGiB: 128, gpus: 1 },
};

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
