# WhaleVisor

WhaleVisor is a hypervisor platform from BlueWhale Stack. It uses a small Rust core on KVM and adds an AI layer for VM placement and operations.

This repo holds the planning and design work, exported from claude.ai artifacts.

## Contents

| Folder | What it is | Source artifact |
| --- | --- | --- |
| [boards/build-plan](boards/build-plan/README.md) | 24-month roadmap: foundation, AI layer, hardware and trust, plus risks | [Build Plan](https://claude.ai/code/artifact/a63074ab-ae3f-4a06-b7de-9a155e7ea8fe) |
| [boards/hardware-architecture](boards/hardware-architecture/README.md) | Layers: customer VMs, service VM, Rust core, server hardware | [Hardware and System Architecture](https://claude.ai/code/artifact/f51113f8-8e45-44f2-801d-4a7feb0774f8) |
| [boards/three-site-failover](boards/three-site-failover/README.md) | Mumbai, Pune and Chennai clusters with cross-site replication and failover steps | [Three-Site Architecture and Failover](https://claude.ai/code/artifact/da2ed995-8c1e-49b0-8432-610fe61a757d) |
| [design/project](design/project) | 40 screen designs (`.dc.html`) for the Console, Installer and Manager | [Console and Installer Screens](https://claude.ai/code/artifact/583b6c9d-464d-43e3-9586-07f63002bdb3) |

Each board folder has a `README.md` summary. Its `elements/` folder holds the raw whiteboard elements as JSON.

## Design screens

`design/project/canvas.json` is the index. It lists every screen with its title and page:

- **Console:** sign in, dashboard, VMs, servers, storage, networks, GPUs, backup, Whale AI, VMware import, tenants, usage, alerts and settings.
- **Installer:** the boot menu through to the installed status screen, shown on the server's own display.
- **Manager:** sites and clusters, adding a cluster, replication and recovery plans.

The screens are written in the claude.ai Design canvas format. Images such as the logo point to `/_blob/...` uploads, so the files render fully only inside the canvas.

## Known gaps

- `design/project/WhaleAI.dc.html` is not here yet. The export failed with a network error.
