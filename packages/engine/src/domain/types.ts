import type { ClaimData } from './claim-data';

export interface Actor {
  readonly userId: string;
  readonly role: string;
}

export interface Claim {
  readonly id: string;
  readonly state: string;
  readonly data: ClaimData;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type AuditKind = 'CREATE' | 'TRANSITION' | 'DATA_UPDATE';
export type AuditOutcome = 'APPLIED' | 'DENIED';

export const DENIAL_CODES = [
  'INVALID_REASON',
  'UNKNOWN_ROLE',
  'UNKNOWN_STATE',
  'TRANSITION_NOT_DEFINED',
  'ROLE_NOT_ALLOWED',
  'INVALID_DATA',
  'DATA_NOT_ALLOWED',
  'MAX_COUNT_EXCEEDED',
  'PRECONDITION_FAILED',
] as const;
export type DenialCode = (typeof DENIAL_CODES)[number];

export interface DataChange {
  readonly field: string;
  readonly before: unknown;
  readonly after: unknown;
}

export interface EffectRecord {
  readonly type: string;
  readonly status: 'OK' | 'FAILED';
  readonly detail: string;
}

/**
 * One immutable audit record. Every key is always present (null when not
 * applicable) so the hashed JSON is stable across a write/read round trip.
 */
export interface AuditEntry {
  readonly id: string;
  readonly seq: number;
  readonly timestamp: string;
  readonly kind: AuditKind;
  readonly claimId: string;
  readonly fromState: string | null;
  readonly toState: string;
  readonly triggeredBy: Actor;
  readonly reason: string;
  readonly outcome: AuditOutcome;
  readonly errorCode: DenialCode | null;
  readonly errorMessage: string | null;
  readonly dataChanges: readonly DataChange[];
  readonly effects: readonly EffectRecord[];
  readonly prevHash: string;
  readonly hash: string;
}

export type AuditDraft = Omit<AuditEntry, 'id' | 'seq' | 'prevHash' | 'hash'>;
