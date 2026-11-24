import { readFileSync } from 'node:fs';
import { MockDriver } from './drivers/mock.ts';
import { createApiServer } from './http.ts';
import { seedDemo } from './seed.ts';
import { Service } from './service.ts';
import { Store } from './store.ts';

const port = Number(process.env.PORT ?? 8443);
const host = process.env.HOST ?? '127.0.0.1';
const tokenFile = process.env.WHALEVISOR_TOKEN_FILE;
const token = tokenFile ? readFileSync(tokenFile, 'utf8').trim() || undefined : process.env.WHALEVISOR_TOKEN;

const svc = new Service(new Store(process.env.DATA_FILE), new MockDriver());
if (process.env.SEED === 'demo') await seedDemo(svc);

if (!token && host !== '127.0.0.1' && host !== 'localhost') {
  console.error('Refusing to listen beyond localhost without WHALEVISOR_TOKEN set.');
  process.exit(1);
}

createApiServer(svc, { token }).listen(port, host, () => {
  console.log(`WhaleVisor control plane on http://${host}:${port} (driver: ${svc.driver.name})`);
});
