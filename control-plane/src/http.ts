import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { ApiError } from './types.ts';
import type { Service } from './service.ts';

const MAX_BODY = 1 << 20;

type Params = Record<string, string>;
type Handler = (ctx: { req: IncomingMessage; params: Params; query: URLSearchParams; body: any; by: string }) => Promise<unknown> | unknown;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  status: number;
}

function route(method: string, path: string, handler: Handler, status = 200): Route {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$',
  );
  return { method, pattern, keys, handler, status };
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new ApiError(413, 'body_too_large', 'Request body is over 1 MB.');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new ApiError(400, 'invalid_json', 'Request body must be a JSON object.');
  }
}

function send(res: ServerResponse, status: number, body?: unknown) {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function tokenMatches(header: string | undefined, token: string): boolean {
  const given = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7) : '');
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

export function routes(svc: Service): Route[] {
  return [
    route('GET', '/api/v1/health', () => ({ status: 'ok', driver: svc.driver.name })),

    route('GET', '/api/v1/hosts', () => ({ hosts: svc.listHosts() })),
    route('POST', '/api/v1/hosts', ({ body, by }) => svc.addHost(body, by), 201),
    route('GET', '/api/v1/hosts/:id', ({ params }) => svc.listHosts().find((h) => h.id === params.id) ?? svc.getHost(params.id)),
    route('POST', '/api/v1/hosts/:id/maintenance', ({ params, body, by }) => {
      if (typeof body.enabled !== 'boolean') throw new ApiError(400, 'invalid_field', 'enabled must be true or false.');
      return svc.setMaintenance(params.id, body.enabled, by);
    }),

    route('GET', '/api/v1/vms', ({ query }) => ({
      vms: svc.listVms({ status: query.get('status') ?? undefined, hostId: query.get('host') ?? undefined, tenant: query.get('tenant') ?? undefined }),
    })),
    route('POST', '/api/v1/vms', ({ body, by }) => svc.createVm(body, by), 201),
    route('GET', '/api/v1/vms/:id', ({ params }) => svc.getVm(params.id)),
    route('DELETE', '/api/v1/vms/:id', ({ params, by }) => svc.deleteVm(params.id, by), 204),
    route('POST', '/api/v1/vms/:id/start', ({ params, by }) => svc.startVm(params.id, by)),
    route('POST', '/api/v1/vms/:id/stop', ({ params, body, by }) => svc.stopVm(params.id, body.force === true, by)),
    route('POST', '/api/v1/vms/:id/migrate', ({ params, body, by }) => svc.migrateVm(params.id, body.hostId, by)),

    route('POST', '/api/v1/placement/preview', ({ body }) => svc.previewPlacement(body.name, svc.resolveSize(body))),

    route('GET', '/api/v1/activity', ({ query }) => {
      const limit = Math.min(Number(query.get('limit')) || 50, 500);
      const vmId = query.get('vm');
      return { activity: svc.store.activity.filter((a) => !vmId || a.vmId === vmId).slice(0, limit) };
    }),
  ];
}

export interface ServerOptions {
  /** When set, every request needs "Authorization: Bearer <token>". */
  token?: string;
}

export function createApiServer(svc: Service, opts: ServerOptions = {}): Server {
  const table = routes(svc);
  return createServer(async (req, res) => {
    try {
      if (opts.token && !tokenMatches(req.headers.authorization, opts.token)) {
        throw new ApiError(401, 'unauthorized', 'Missing or wrong API token.');
      }
      const url = new URL(req.url ?? '/', 'http://localhost');
      const matches = table.filter((r) => r.pattern.test(url.pathname));
      if (matches.length === 0) throw new ApiError(404, 'not_found', `No route for ${url.pathname}.`);
      const r = matches.find((m) => m.method === req.method);
      if (!r) throw new ApiError(405, 'method_not_allowed', `${req.method} is not allowed on ${url.pathname}.`);

      const values = r.pattern.exec(url.pathname)!.slice(1);
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(values[i])]));
      const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readJson(req);
      // Until users and roles exist, every change is attributed to "api".
      const result = await r.handler({ req, params, query: url.searchParams, body, by: 'api' });
      send(res, r.status, r.status === 204 ? undefined : result);
    } catch (err) {
      if (err instanceof ApiError) {
        send(res, err.status, { error: { code: err.code, message: err.message } });
      } else {
        console.error(err);
        send(res, 500, { error: { code: 'internal', message: 'Internal error.' } });
      }
    }
  });
}
