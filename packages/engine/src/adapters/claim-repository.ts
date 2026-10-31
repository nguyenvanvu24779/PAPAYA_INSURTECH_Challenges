import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Claim } from '../domain/types';
import type { ClaimRepository } from '../ports';

export class InMemoryClaimRepository implements ClaimRepository {
  protected readonly claims = new Map<string, Claim>();

  get(id: string): Claim | undefined {
    const claim = this.claims.get(id);
    return claim && structuredClone(claim);
  }

  list(): Claim[] {
    return [...this.claims.values()].map((c) => structuredClone(c));
  }

  insert(claim: Claim): void {
    if (this.claims.has(claim.id)) throw new Error(`Claim ${claim.id} already exists`);
    this.claims.set(claim.id, structuredClone(claim));
    this.flush();
  }

  save(claim: Claim): void {
    if (!this.claims.has(claim.id)) throw new Error(`Claim ${claim.id} does not exist`);
    this.claims.set(claim.id, structuredClone(claim));
    this.flush();
  }

  remove(id: string): void {
    this.claims.delete(id);
    this.flush();
  }

  protected flush(): void {}
}

/** Snapshot persisted on every change (write to temp file, then rename). */
export class JsonFileClaimRepository extends InMemoryClaimRepository {
  constructor(private readonly path: string) {
    super();
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      for (const claim of JSON.parse(readFileSync(path, 'utf8')) as Claim[]) {
        this.claims.set(claim.id, claim);
      }
    }
  }

  protected override flush(): void {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify([...this.claims.values()], null, 2));
    renameSync(tmp, this.path);
  }
}
