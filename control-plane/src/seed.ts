import type { Service } from './service.ts';

/** The mumbai-dc1 sample cluster from the Console designs. */
export async function seedDemo(svc: Service): Promise<void> {
  if (svc.store.hosts.size > 0) return;
  const hosts = [
    { name: 'host-01', address: '10.20.0.11', cpus: 64, memoryGiB: 512 },
    { name: 'host-02', address: '10.20.0.12', cpus: 64, memoryGiB: 512 },
    { name: 'host-03', address: '10.20.0.13', cpus: 64, memoryGiB: 512 },
    { name: 'host-04', address: '10.20.0.14', cpus: 64, memoryGiB: 512 },
    { name: 'host-05', address: '10.20.0.15', cpus: 64, memoryGiB: 512 },
    { name: 'gpu-01', address: '10.20.0.21', cpus: 96, memoryGiB: 1024, gpus: 8 },
  ];
  const ids: Record<string, string> = {};
  for (const h of hosts) ids[h.name] = svc.addHost(h, 'seed').id;

  const vms = [
    { name: 'db-prod-01', host: 'host-01', image: 'ubuntu-24.04', vcpus: 16, memoryGiB: 64, start: true },
    { name: 'db-prod-02', host: 'host-03', image: 'ubuntu-24.04', vcpus: 16, memoryGiB: 64, start: true },
    { name: 'erp-app-01', host: 'host-02', image: 'win2022-base', vcpus: 8, memoryGiB: 32, start: true, tenant: 'finance' },
    { name: 'erp-app-02', host: 'host-04', image: 'win2022-base', vcpus: 8, memoryGiB: 32, start: true, tenant: 'finance' },
    { name: 'llm-train-01', host: 'gpu-01', image: 'ubuntu-24.04', vcpus: 32, memoryGiB: 256, gpus: 4, start: true },
    { name: 'llm-infer-01', host: 'gpu-01', image: 'ubuntu-24.04', vcpus: 16, memoryGiB: 128, gpus: 1, start: true },
    { name: 'web-stage-01', host: 'host-05', image: 'rocky-9', vcpus: 4, memoryGiB: 8, start: false },
    { name: 'ad-dc-01', host: 'host-01', image: 'win2022-base', vcpus: 4, memoryGiB: 16, start: true },
  ];
  for (const v of vms) await svc.createVm({ ...v, hostId: ids[v.host] }, 'seed');
}
