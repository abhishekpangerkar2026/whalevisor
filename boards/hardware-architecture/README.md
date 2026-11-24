# WhaleVisor — Hardware and System Architecture

Source: claude.ai whiteboard — https://claude.ai/code/artifact/f51113f8-8e45-44f2-801d-4a7feb0774f8

**WhaleVisor architecture**
- A small Rust core; everything else lives in VMs.
- Blue: WhaleVisor Core. Peach: optional parts.

## Customer VMs

- Linux VM
- Windows VM
- GPU / AI VM

## Service VM (minimal Linux, privileged)

- Device drivers
- Control plane and API
- WhaleVisor Console
- Storage and networking
- Whale AI engine
- LLM adapter

## WhaleVisor Core (Rust, runs directly on the hardware)

- VM entry and exit
- vCPU scheduler
- Memory isolation
- Device passthrough
- Measured boot

## Server hardware

- CPU (VT-x / AMD-V)
- Memory
- NVMe disks
- Network cards
- GPUs
- TPM 2.0 chip
- DPU card

## Connections

- Customer VMs → point [310, 464]
- Service VM (minimal Linux, privileged) → point [1066, 464]
- WhaleVisor Core (Rust, runs directly on the hardware) → Server hardware
