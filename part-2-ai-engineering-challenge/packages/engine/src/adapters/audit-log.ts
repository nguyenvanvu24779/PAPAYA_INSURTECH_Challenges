import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AuditDraft, AuditEntry } from '../domain/types';
import type { AuditLog } from '../ports';

const GENESIS_HASH = '0'.repeat(64);

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function hashOf(body: Omit<AuditEntry, 'hash'>): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

export interface IntegrityReport {
  ok: boolean;
  /** Sequence number of the first entry that fails verification. */
  brokenAt?: number;
}

/**
 * Hash-chained, append-only log. Entries are deep-frozen; each carries the
 * hash of its predecessor, so any edit, deletion or reordering of stored
 * history is detectable with verifyIntegrity().
 */
export class InMemoryAuditLog implements AuditLog {
  protected readonly entries: AuditEntry[] = [];

  append(draft: AuditDraft): AuditEntry {
    const seq = this.entries.length + 1;
    const body = {
      id: `AUD-${String(seq).padStart(6, '0')}`,
      seq,
      ...structuredClone(draft),
      prevHash: this.entries.at(-1)?.hash ?? GENESIS_HASH,
    };
    const entry = deepFreeze({ ...body, hash: hashOf(body) }) as AuditEntry;
    // Persist before exposing: if this throws, the log is unchanged.
    this.persist(entry);
    this.entries.push(entry);
    return entry;
  }

  query(claimId: string): readonly AuditEntry[] {
    return this.entries.filter((e) => e.claimId === claimId);
  }

  all(): readonly AuditEntry[] {
    return [...this.entries];
  }

  verifyIntegrity(): IntegrityReport {
    return verifyChain(this.entries);
  }

  protected persist(_entry: AuditEntry): void {}
}

export function verifyChain(entries: readonly AuditEntry[]): IntegrityReport {
  let prev = GENESIS_HASH;
  for (const [index, entry] of entries.entries()) {
    const { hash, ...body } = entry;
    if (entry.seq !== index + 1 || entry.prevHash !== prev || hashOf(body) !== hash) {
      return { ok: false, brokenAt: entry.seq };
    }
    prev = hash;
  }
  return { ok: true };
}

/** JSON Lines file, opened append-only. Refuses to start on a tampered file. */
export class FileAuditLog extends InMemoryAuditLog {
  constructor(private readonly path: string) {
    super();
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim() !== '');
      const loaded = lines.map((l) => deepFreeze(JSON.parse(l) as AuditEntry));
      const report = verifyChain(loaded);
      if (!report.ok) {
        throw new Error(`Audit file ${path} failed integrity check at entry ${report.brokenAt}`);
      }
      this.entries.push(...loaded);
    }
  }

  protected override persist(entry: AuditEntry): void {
    appendFileSync(this.path, JSON.stringify(entry) + '\n', { flag: 'a' });
  }
}
