import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choosePlacement, groupOf } from '../src/placement.ts';
import type { Host, Vm } from '../src/types.ts';

const host = (id: string, over: Partial<Host> = {}): Host => ({
  id, name: id, address: '', status: 'healthy', cpus: 16, memoryGiB: 64, gpus: 0, addedAt: '', ...over,
});
const vm = (name: string, hostId: string, memoryGiB = 8, over: Partial<Vm> = {}): Vm => ({
  id: name, name, status: 'running', hostId, image: 'x', vcpus: 2, memoryGiB, gpus: 0, tenant: 't', createdAt: '', ...over,
});
const small = { vcpus: 2, memoryGiB: 8, gpus: 0 };

test('groupOf strips the trailing number', () => {
  assert.equal(groupOf('erp-app-03'), 'erp-app');
  assert.equal(groupOf('web'), 'web');
});

test('picks the least loaded host', () => {
  const p = choosePlacement('new-01', small, [host('a'), host('b')], [vm('x-01', 'a', 32)]);
  assert.equal(p?.hostId, 'b');
});

test('keeps VMs of one group apart even if that host is busier', () => {
  const vms = [vm('erp-app-01', 'a'), vm('other-01', 'b', 40)];
  const p = choosePlacement('erp-app-02', small, [host('a'), host('b')], vms);
  assert.equal(p?.hostId, 'b');
  assert.match(p!.reason, /kept apart/);
});

test('skips unhealthy, excluded and full hosts', () => {
  const hosts = [host('sick', { status: 'needs_attention' }), host('maint', { status: 'maintenance' }), host('full', { memoryGiB: 8 }), host('ok'), host('skip')];
  const p = choosePlacement('n-01', small, hosts, [vm('f-01', 'full', 8)], ['skip']);
  assert.equal(p?.hostId, 'ok');
});

test('GPU VMs only go where GPUs are free', () => {
  const hosts = [host('cpu'), host('gpu', { gpus: 1 })];
  assert.equal(choosePlacement('g-01', { ...small, gpus: 1 }, hosts, [])?.hostId, 'gpu');
  assert.equal(choosePlacement('g-02', { ...small, gpus: 1 }, hosts, [vm('g-01', 'gpu', 8, { gpus: 1 })]), null);
});

test('a migrating VM counts against both hosts', () => {
  const hosts = [host('a', { memoryGiB: 16 }), host('b', { memoryGiB: 16 })];
  const moving = vm('m-01', 'a', 12, { status: 'migrating', migratingTo: 'b' });
  assert.equal(choosePlacement('n-01', small, hosts, [moving]), null);
});
