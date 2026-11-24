# WhaleVisor control plane

The control plane is the API behind the WhaleVisor Console. It tracks servers and VMs, chooses where each VM runs, and tells the hypervisor on each server what to do.

It is the "Control plane and API" item in the build plan's first phase (months 0–6). In the target architecture it runs inside the service VM on each server.

## Run it

You need Node.js 22.18 or newer. It has no dependencies and no build step, because Node runs the TypeScript directly.

```sh
npm test       # run the test suite
npm run demo   # start on http://127.0.0.1:8443 with the mumbai-dc1 sample cluster
npm start      # start empty
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8443` | Port to listen on |
| `HOST` | `127.0.0.1` | Address to listen on. Any other address requires `WHALEVISOR_TOKEN` |
| `WHALEVISOR_TOKEN` | none | If set, every request needs `Authorization: Bearer <token>` |
| `WHALEVISOR_TOKEN_FILE` | none | Read the token from this file instead. Used by the ISO |
| `DATA_FILE` | none | JSON file to keep state across restarts. Without it, state is in memory only |
| `SEED` | none | `demo` loads the sample servers and VMs from the Console designs |

## API

All paths start with `/api/v1`. Errors come back as `{"error": {"code", "message"}}`.

| Method | Path | Does |
| --- | --- | --- |
| GET | `/health` | Status and active driver |
| GET | `/hosts` | Servers, with allocated vCPU, memory, GPUs and VM count |
| POST | `/hosts` | Add a server: `name`, `address`, `cpus`, `memoryGiB`, optional `gpus` |
| GET | `/hosts/:id` | One server |
| POST | `/hosts/:id/maintenance` | `{"enabled": true}` moves every VM off first. If they don't all fit, nothing moves |
| GET | `/vms?status=&host=&tenant=` | VMs, filtered |
| POST | `/vms` | Create: `name`, `image`, and either `size` (`small`, `medium`, `large`, `gpu`) or `vcpus` + `memoryGiB` + `gpus`. Optional `hostId`, `tenant`, `start` |
| GET | `/vms/:id` | One VM |
| DELETE | `/vms/:id` | Delete a stopped VM |
| POST | `/vms/:id/start` | Start |
| POST | `/vms/:id/stop` | Stop. `{"force": true}` also stops a VM in error |
| POST | `/vms/:id/migrate` | Move to `hostId`, or let placement choose |
| POST | `/placement/preview` | Which server a new VM would go to, and why |
| GET | `/activity?vm=&limit=` | Recent actions, newest first |

## How it fits together

```
http.ts       routes, JSON, auth token
service.ts    rules: names, sizes, states, per-VM locking, maintenance planning
placement.ts  picks a server
store.ts      state, saved to a JSON file
drivers/      the hypervisor interface; mock.ts implements it in memory
```

**Placement** only considers healthy servers with room. vCPUs can be overcommitted 4 to 1; memory and GPUs can't. VMs in the same group, like `erp-app-01` and `erp-app-02`, go on different servers where possible, so one failure doesn't take them all down. After that, placement picks the server with the lowest load. Load today means current allocation. Whale AI will later replace it with a 7-day forecast.

## Not built yet

- **Cloud Hypervisor driver:** needs a Linux server with KVM to build and test.
- **Users, roles and tenants:** there's one shared token, and every action is logged as `api`.
- **Replicated state for the 3-node pilot:** the JSON file works for one control plane only.
- **Long operations:** migrations run inside the request. They should become background jobs with progress.
- **Storage, networks, images, GPUs as resources, snapshots, and the rest of the Console screens.**
