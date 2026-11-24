# WhaleVisor — Build Plan

Source: claude.ai whiteboard — https://claude.ai/code/artifact/a63074ab-ae3f-4a06-b7de-9a155e7ea8fe

**WhaleVisor**
- Open questions
- First customer: GPU/AI tenants or VMware leavers?
- Build on KVM; win with the AI layer.
- Blue: the differentiator. Peach: risks.
- Hardware means a DPU appliance, not custom chips.
- Risks
- vGPU on KVM needs NVIDIA vendor approval
- Certifications and integrations take years
- Kernel and Rust engineers are scarce

## Months 0–6: Foundation

- Fork Cloud Hypervisor on KVM
- Control plane and API
- GPU passthrough
- 3-node pilot cluster

## Months 6–12: AI layer

- Predictive VM placement
- AI operations agent
- GPU scheduling
- VMware import tool

## Months 12–24: Hardware and trust

- DPU offload (BlueField)
- Confidential computing
- WhaleVisor appliance on certified servers
- NVIDIA and UAE certifications

## Connections

- Months 0–6: Foundation → Months 6–12: AI layer
- Months 6–12: AI layer → Months 12–24: Hardware and trust
