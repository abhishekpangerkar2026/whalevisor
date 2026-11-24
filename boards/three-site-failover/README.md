# WhaleVisor — Three-Site Architecture and Failover

Source: claude.ai whiteboard — https://claude.ai/code/artifact/da2ed995-8c1e-49b0-8432-610fe61a757d

**WhaleVisor across three sites**
- One cluster per site; the other two absorb a failure.
- Blue: management. Peach: standby replicas. Dashed arrows: replication between sites.
- WhaleVisor Manager: one screen for all sites
- If a site fails
- 1. Other sites detect it
- 2. Admin confirms failover
- 3. Replicas start in order
- 4. Network and DNS switch
- 5. Fail back when repaired

## Site 1: Mumbai cluster

- Servers with built-in or external storage
- Production VMs (at most two-thirds full)
- Replicas of Pune and Chennai VMs

## Site 2: Pune cluster

- Servers with built-in or external storage
- Production VMs (at most two-thirds full)
- Replicas of Mumbai and Chennai VMs

## Site 3: Chennai cluster

- Servers with built-in or external storage
- Production VMs (at most two-thirds full)
- Replicas of Mumbai and Pune VMs

## Connections

- WhaleVisor Manager: one screen for all sites → Site 1: Mumbai cluster
- WhaleVisor Manager: one screen for all sites → Site 2: Pune cluster
- WhaleVisor Manager: one screen for all sites → Site 3: Chennai cluster
- Site 1: Mumbai cluster → Site 2: Pune cluster
- Site 2: Pune cluster → Site 3: Chennai cluster
- 1. Other sites detect it → 2. Admin confirms failover
- 2. Admin confirms failover → 3. Replicas start in order
- 3. Replicas start in order → 4. Network and DNS switch
- 4. Network and DNS switch → 5. Fail back when repaired
