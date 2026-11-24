import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import type { Activity, Host, Vm } from './types.ts';

interface State {
  hosts: Host[];
  vms: Vm[];
  activity: Activity[];
}

const MAX_ACTIVITY = 1000;

/**
 * In-memory state, optionally saved to a JSON file after every change.
 * Good enough for one control-plane node; the pilot cluster will need a
 * replicated store (etcd or Raft) so any node can take over.
 */
export class Store {
  hosts = new Map<string, Host>();
  vms = new Map<string, Vm>();
  activity: Activity[] = [];
  private file?: string;

  constructor(file?: string) {
    this.file = file;
    if (file && existsSync(file)) {
      const s = JSON.parse(readFileSync(file, 'utf8')) as State;
      for (const h of s.hosts) this.hosts.set(h.id, h);
      for (const v of s.vms) this.vms.set(v.id, v);
      this.activity = s.activity ?? [];
    }
  }

  log(entry: Omit<Activity, 'at'>): void {
    this.activity.unshift({ at: new Date().toISOString(), ...entry });
    if (this.activity.length > MAX_ACTIVITY) this.activity.length = MAX_ACTIVITY;
  }

  save(): void {
    if (!this.file) return;
    const state: State = {
      hosts: [...this.hosts.values()],
      vms: [...this.vms.values()],
      activity: this.activity,
    };
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, this.file);
  }
}
