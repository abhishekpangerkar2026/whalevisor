import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockDriver } from '../src/drivers/mock.ts';
import { createApiServer } from '../src/http.ts';
import { Service } from '../src/service.ts';
import { Store } from '../src/store.ts';

let server: Server;
let base: string;
let driver: MockDriver;
let svc: Service;

async function start(opts: { token?: string; file?: string } = {}) {
  driver = new MockDriver();
  svc = new Service(new Store(opts.file), driver);
  server = createApiServer(svc, { token: opts.token });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
}

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

async function addHost(name: string, extra: object = {}) {
  const r = await call('POST', '/hosts', { name, address: `10.0.0.${name.length}`, cpus: 16, memoryGiB: 64, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id as string;
}

beforeEach(() => start());
afterEach(() => new Promise<void>((r) => server.close(() => r())));

test('health reports the driver', async () => {
  assert.deepEqual((await call('GET', '/health')).body, { status: 'ok', driver: 'mock' });
});

test('VM lifecycle: create, start, stop, delete', async () => {
  await addHost('host-01');
  const created = await call('POST', '/vms', { name: 'web-01', image: 'ubuntu-24.04', size: 'small' });
  assert.equal(created.status, 201);
  const id = created.body.vm.id;
  assert.equal(created.body.vm.status, 'stopped');
  assert.equal(created.body.vm.vcpus, 2);

  assert.equal((await call('POST', `/vms/${id}/start`)).body.status, 'running');
  assert.equal((await call('DELETE', `/vms/${id}`)).status, 409, 'cannot delete a running VM');
  assert.equal((await call('POST', `/vms/${id}/stop`)).body.status, 'stopped');
  assert.equal((await call('DELETE', `/vms/${id}`)).status, 204);
  assert.equal((await call('GET', `/vms/${id}`)).status, 404);
  assert.equal(driver.vms.size, 0);

  const log = (await call('GET', '/activity')).body.activity.map((a: any) => a.action);
  assert.deepEqual(log.slice(0, 4), ['vm.deleted', 'vm.stop', 'vm.start', 'vm.created']);
});

test('rejects bad input with clear errors', async () => {
  await addHost('host-01');
  const cases: [unknown, string][] = [
    [{ name: 'Bad Name', image: 'x', size: 'small' }, 'invalid_name'],
    [{ name: 'ok-01', size: 'small' }, 'invalid_field'],
    [{ name: 'ok-01', image: 'x', size: 'huge' }, 'invalid_size'],
    [{ name: 'ok-01', image: 'x', vcpus: 0, memoryGiB: 4 }, 'invalid_field'],
    [{ name: 'ok-01', image: 'x', vcpus: 999, memoryGiB: 4 }, 'no_capacity'],
  ];
  for (const [body, code] of cases) {
    const r = await call('POST', '/vms', body);
    assert.equal(r.body.error.code, code, JSON.stringify(body));
  }
  const bad = await fetch(base + '/vms', { method: 'POST', body: '{not json' });
  assert.equal(bad.status, 400);
  assert.equal((await call('PUT', '/vms')).status, 405);
  assert.equal((await call('GET', '/nope')).status, 404);
});

test('duplicate VM names are refused', async () => {
  await addHost('host-01');
  await call('POST', '/vms', { name: 'a-01', image: 'x', size: 'small' });
  assert.equal((await call('POST', '/vms', { name: 'a-01', image: 'x', size: 'small' })).status, 409);
});

test('placement preview and automatic placement spread a group', async () => {
  const h1 = await addHost('host-01');
  const h2 = await addHost('host-02');
  const first = await call('POST', '/vms', { name: 'erp-app-01', image: 'x', size: 'medium', hostId: h2 });
  assert.equal(first.body.vm.hostId, h2);
  const preview = await call('POST', '/placement/preview', { name: 'erp-app-02', size: 'medium' });
  assert.equal(preview.body.hostId, h1);
  const second = await call('POST', '/vms', { name: 'erp-app-02', image: 'x', size: 'medium' });
  assert.equal(second.body.vm.hostId, h1);
});

test('migrate moves a VM and keeps its state', async () => {
  const h1 = await addHost('host-01');
  const h2 = await addHost('host-02');
  const { body } = await call('POST', '/vms', { name: 'm-01', image: 'x', size: 'small', hostId: h1, start: true });
  const moved = await call('POST', `/vms/${body.vm.id}/migrate`, {});
  assert.equal(moved.status, 200);
  assert.equal(moved.body.vm.hostId, h2);
  assert.equal(moved.body.vm.status, 'running');
  assert.equal(driver.vms.get(body.vm.id)?.hostId, h2);
  assert.equal((await call('POST', `/vms/${body.vm.id}/migrate`, { hostId: h2 })).body.error.code, 'same_host');
});

test('a failed migration leaves the VM where it was', async () => {
  const h1 = await addHost('host-01');
  await addHost('host-02');
  const { body } = await call('POST', '/vms', { name: 'm-01', image: 'x', size: 'small', hostId: h1, start: true });
  driver.failNext = 'link down';
  const r = await call('POST', `/vms/${body.vm.id}/migrate`, {});
  assert.equal(r.status, 502);
  const vm = (await call('GET', `/vms/${body.vm.id}`)).body;
  assert.equal(vm.hostId, h1);
  assert.equal(vm.status, 'running');
  assert.equal(vm.migratingTo, undefined);
});

test('a second operation on a busy VM is refused', async () => {
  await addHost('host-01');
  const { body } = await call('POST', '/vms', { name: 'c-01', image: 'x', size: 'small' });
  const slow = new MockDriver(50);
  slow.vms.set(body.vm.id, { hostId: body.vm.hostId, state: 'stopped' });
  (svc as any).driver = slow;
  const [a, b] = await Promise.all([call('POST', `/vms/${body.vm.id}/start`), call('POST', `/vms/${body.vm.id}/start`)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal((await call('GET', `/vms/${body.vm.id}`)).body.status, 'running');
});

test('a failed create is kept as error and can be deleted', async () => {
  await addHost('host-01');
  driver.failNext = 'disk full';
  const r = await call('POST', '/vms', { name: 'e-01', image: 'x', size: 'small' });
  assert.equal(r.body.vm.status, 'error');
  assert.match(r.body.vm.error, /disk full/);
  assert.equal((await call('DELETE', `/vms/${r.body.vm.id}`)).status, 204);
});

test('maintenance mode moves every VM off, or nothing if they do not fit', async () => {
  const h1 = await addHost('host-01');
  const h2 = await addHost('host-02');
  const h3 = await addHost('host-03', { memoryGiB: 16 });
  for (const n of ['a-01', 'b-01']) await call('POST', '/vms', { name: n, image: 'x', size: 'medium', hostId: h1, start: true });

  // Two 32 GB VMs; host-02 (64 GB) can take both, host-03 (16 GB) neither.
  const on = await call('POST', `/hosts/${h1}/maintenance`, { enabled: true });
  assert.equal(on.body.status, 'maintenance');
  const vms = (await call('GET', '/vms')).body.vms;
  assert.ok(vms.every((v: any) => v.hostId === h2 && v.status === 'running'));
  assert.equal((await call('POST', '/vms', { name: 'c-01', image: 'x', size: 'small', hostId: h1 })).body.error.code, 'host_unavailable');

  // host-02 is now full apart from host-03, which is too small: refuse and move nothing.
  const refused = await call('POST', `/hosts/${h2}/maintenance`, { enabled: true });
  assert.equal(refused.body.error.code, 'no_capacity');
  assert.equal((await call('GET', `/hosts/${h2}`)).body.status, 'healthy');
  assert.equal((await call('GET', `/vms?host=${h2}`)).body.vms.length, 2);
  assert.ok(h3);

  assert.equal((await call('POST', `/hosts/${h1}/maintenance`, { enabled: false })).body.status, 'healthy');
});

test('host list shows allocations', async () => {
  const h1 = await addHost('host-01');
  await call('POST', '/vms', { name: 'a-01', image: 'x', size: 'large', hostId: h1 });
  const h = (await call('GET', `/hosts/${h1}`)).body;
  assert.deepEqual(h.allocated, { vcpus: 16, memoryGiB: 64, gpus: 0 });
  assert.equal(h.vmCount, 1);
});

test('token is required when configured', async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await start({ token: 's3cret' });
  assert.equal((await call('GET', '/health')).status, 401);
  assert.equal((await call('GET', '/health', undefined, { authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await call('GET', '/health', undefined, { authorization: 'Bearer s3cret' })).status, 200);
});

test('state survives a restart when a data file is set', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'whalevisor-'));
  const file = join(dir, 'state.json');
  try {
    await new Promise<void>((r) => server.close(() => r()));
    await start({ file });
    const h1 = await addHost('host-01');
    await call('POST', '/vms', { name: 'p-01', image: 'x', size: 'small', hostId: h1 });
    await new Promise<void>((r) => server.close(() => r()));
    await start({ file });
    const vms = (await call('GET', '/vms')).body.vms;
    assert.equal(vms.length, 1);
    assert.equal(vms[0].name, 'p-01');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
