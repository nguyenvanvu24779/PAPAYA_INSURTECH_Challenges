import type { AuditDraft, AuditEntry, Claim } from '../domain/types';

/** Append-only by construction: there is deliberately no update or delete. */
export interface AuditLog {
  append(draft: AuditDraft): AuditEntry;
  query(claimId: string): readonly AuditEntry[];
}

/** Returns copies: callers can never mutate stored claims in place. */
export interface ClaimRepository {
  get(id: string): Claim | undefined;
  list(): Claim[];
  insert(claim: Claim): void;
  save(claim: Claim): void;
  remove(id: string): void;
}

export interface Clock {
  now(): Date;
}
