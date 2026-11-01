import { checkPreconditions } from '../conditions/evaluate';
import type { TransitionConfig, WorkflowConfig } from '../config/schema';
import { claimDataSchema, type ClaimData } from '../domain/claim-data';
import type {
  Actor,
  AuditDraft,
  AuditEntry,
  AuditKind,
  Claim,
  DataChange,
  DenialCode,
  EffectRecord,
} from '../domain/types';
import { applyOutcome, planEffect } from '../effects/plan';
import type { AuditLog, ClaimRepository, Clock } from '../ports';
import { ClaimNotFoundError, InvalidRequestError } from './errors';

export interface EngineDeps {
  claims: ClaimRepository;
  audit: AuditLog;
  clock: Clock;
  /** Destination of mock side effects. Defaults to the console. */
  log?: (line: string) => void;
}

export interface Applied {
  ok: true;
  claim: Claim;
  entry: AuditEntry;
}

export interface Denied {
  ok: false;
  code: DenialCode;
  /** Specific, human-readable reason. */
  message: string;
  details: string[];
  /** The DENIED audit record; null only when no claim exists to attach it to. */
  entry: AuditEntry | null;
}

export type Result = Applied | Denied;

export interface TransitionInput {
  to: string;
  actor: Actor;
  reason: string;
  data?: unknown;
}

export interface DataUpdateInput {
  actor: Actor;
  reason: string;
  data: unknown;
}

export interface CreateClaimInput {
  actor: Actor;
  data?: unknown;
  reason?: string;
}

export interface AvailableTransition {
  id: string;
  to: string;
  description: string | null;
  roles: readonly string[];
  preconditions: { message: string; satisfied: boolean }[];
  limit: { max: number; used: number; message: string } | null;
}

function assertActor(actor: unknown): asserts actor is Actor {
  const a = actor as Partial<Actor> | null;
  if (
    !a ||
    typeof a.userId !== 'string' ||
    a.userId.trim() === '' ||
    typeof a.role !== 'string' ||
    a.role.trim() === ''
  ) {
    throw new InvalidRequestError('actor must have a non-empty userId and role');
  }
}

function stripUndefined(data: ClaimData): ClaimData {
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) as ClaimData;
}

function diffData(before: ClaimData, after: ClaimData): DataChange[] {
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  return [...new Set([...Object.keys(b), ...Object.keys(a)])]
    .sort()
    .filter((field) => JSON.stringify(b[field]) !== JSON.stringify(a[field]))
    .map((field) => ({ field, before: b[field] ?? null, after: a[field] ?? null }));
}

export class WorkflowEngine {
  private readonly byFrom = new Map<string, TransitionConfig[]>();
  private readonly roles: ReadonlySet<string>;
  private readonly log: (line: string) => void;

  constructor(
    readonly config: WorkflowConfig,
    private readonly deps: EngineDeps,
  ) {
    for (const t of config.transitions) {
      this.byFrom.set(t.from, [...(this.byFrom.get(t.from) ?? []), t]);
    }
    this.roles = new Set(config.roles);
    this.log = deps.log ?? ((line) => console.log(line));
  }

  // ---- queries -----------------------------------------------------------

  getClaim(id: string): Claim {
    const claim = this.deps.claims.get(id);
    if (!claim) throw new ClaimNotFoundError(id);
    return claim;
  }

  listClaims(): Claim[] {
    return this.deps.claims.list();
  }

  getAudit(claimId: string): readonly AuditEntry[] {
    this.getClaim(claimId);
    return this.deps.audit.query(claimId);
  }

  /** Transitions out of the claim's current state, with live precondition status. */
  availableTransitions(claimId: string): AvailableTransition[] {
    const claim = this.getClaim(claimId);
    const now = this.deps.clock.now();
    return (this.byFrom.get(claim.state) ?? []).map((t) => ({
      id: t.id,
      to: t.to,
      description: t.description ?? null,
      roles: t.roles,
      preconditions: checkPreconditions(t.preconditions, claim.data, now).results.map((r) => ({
        message: r.message,
        satisfied: r.ok,
      })),
      limit:
        t.maxCount !== undefined && t.limitMessage !== undefined
          ? { max: t.maxCount, used: this.appliedCount(claimId, t), message: t.limitMessage }
          : null,
    }));
  }

  // ---- commands ----------------------------------------------------------

  createClaim(input: CreateClaimInput): Result {
    assertActor(input.actor);
    const { actor } = input;
    const now = this.deps.clock.now();
    const initial = this.config.initialState;
    const reason = typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim() : 'Claim submitted';

    // No claim exists yet, so a refusal cannot be attached to a claim's history.
    const refuse = (code: DenialCode, message: string, details: string[] = []): Denied => ({
      ok: false,
      code,
      message,
      details,
      entry: null,
    });

    if (!this.roles.has(actor.role)) return refuse('UNKNOWN_ROLE', `Unknown role '${actor.role}'`);
    if (!this.config.intake.roles.includes(actor.role)) {
      return refuse(
        'ROLE_NOT_ALLOWED',
        `Role '${actor.role}' cannot submit claims; requires one of: ${this.config.intake.roles.join(', ')}`,
      );
    }
    const parsed = this.parsePatch(input.data);
    if (!parsed.ok) return refuse('INVALID_DATA', parsed.message);
    const access = this.dataAccessProblems(initial, actor.role, parsed.patch);
    if (access.length > 0) return refuse('DATA_NOT_ALLOWED', access[0]!, access);

    const claim: Claim = {
      id: `CLM-${String(this.deps.claims.list().length + 1).padStart(4, '0')}`,
      state: initial,
      data: parsed.patch,
      version: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    const entry = this.commit(
      claim,
      undefined,
      this.draft({
        kind: 'CREATE',
        claimId: claim.id,
        from: null,
        to: initial,
        actor,
        reason,
        now,
        changes: diffData({}, claim.data),
      }),
    );
    return { ok: true, claim, entry };
  }

  updateClaimData(claimId: string, input: DataUpdateInput): Result {
    const claim = this.getClaim(claimId);
    assertActor(input.actor);
    const { actor } = input;
    const now = this.deps.clock.now();
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    const deny = (code: DenialCode, message: string, details: string[] = []) =>
      this.deny({ kind: 'DATA_UPDATE', claim, to: claim.state, actor, reason, now, code, message, details });

    if (!reason) return deny('INVALID_REASON', 'A reason/note is required for every change');
    if (!this.roles.has(actor.role)) return deny('UNKNOWN_ROLE', `Unknown role '${actor.role}'`);
    const parsed = this.parsePatch(input.data);
    if (!parsed.ok) return deny('INVALID_DATA', parsed.message);
    if (Object.keys(parsed.patch).length === 0) return deny('INVALID_DATA', 'No data fields supplied');
    const access = this.dataAccessProblems(claim.state, actor.role, parsed.patch);
    if (access.length > 0) return deny('DATA_NOT_ALLOWED', access[0]!, access);

    const data = { ...claim.data, ...parsed.patch };
    const next: Claim = { ...claim, data, version: claim.version + 1, updatedAt: now.toISOString() };
    const entry = this.commit(
      next,
      claim,
      this.draft({
        kind: 'DATA_UPDATE',
        claimId,
        from: claim.state,
        to: claim.state,
        actor,
        reason,
        now,
        changes: diffData(claim.data, data),
      }),
    );
    return { ok: true, claim: next, entry };
  }

  /**
   * Pipeline, in order; the first failing gate denies (and audits) the attempt:
   * reason -> role known -> transition defined -> role allowed -> data valid
   * -> data writable -> cycle limit -> preconditions -> commit -> effects.
   * Supplied data is merged for checking only and persisted only on success.
   */
  transition(claimId: string, input: TransitionInput): Result {
    const claim = this.getClaim(claimId);
    assertActor(input.actor);
    if (typeof input.to !== 'string' || input.to === '') {
      throw new InvalidRequestError('to must be a non-empty state id');
    }
    const { actor, to } = input;
    const now = this.deps.clock.now();
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    const deny = (code: DenialCode, message: string, details: string[] = []) =>
      this.deny({ kind: 'TRANSITION', claim, to, actor, reason, now, code, message, details });
    const from = claim.state;

    if (!reason) return deny('INVALID_REASON', 'A reason/note is required for every transition');
    if (!this.roles.has(actor.role)) return deny('UNKNOWN_ROLE', `Unknown role '${actor.role}'`);
    if (!Object.hasOwn(this.config.states, to)) return deny('UNKNOWN_STATE', `Unknown target state '${to}'`);

    const t = (this.byFrom.get(from) ?? []).find((x) => x.to === to);
    if (!t) {
      const allowed = (this.byFrom.get(from) ?? []).map((x) => x.to);
      return deny(
        'TRANSITION_NOT_DEFINED',
        allowed.length === 0
          ? `Cannot move claim from ${from} to ${to}: ${from} is a final state with no outgoing transitions`
          : `Cannot move claim from ${from} to ${to}: no such transition. Allowed from ${from}: ${allowed.join(', ')}`,
      );
    }
    if (!t.roles.includes(actor.role)) {
      return deny(
        'ROLE_NOT_ALLOWED',
        `Role '${actor.role}' cannot move a claim from ${from} to ${to}; requires one of: ${t.roles.join(', ')}`,
      );
    }

    const parsed = this.parsePatch(input.data);
    if (!parsed.ok) return deny('INVALID_DATA', parsed.message);
    const access = this.dataAccessProblems(from, actor.role, parsed.patch);
    if (access.length > 0) return deny('DATA_NOT_ALLOWED', access[0]!, access);

    if (t.maxCount !== undefined && this.appliedCount(claimId, t) >= t.maxCount) {
      return deny('MAX_COUNT_EXCEEDED', t.limitMessage!);
    }

    const merged = { ...claim.data, ...parsed.patch };
    const report = checkPreconditions(t.preconditions, merged, now);
    if (!report.ok) {
      return deny(
        'PRECONDITION_FAILED',
        `Preconditions not met for ${from} -> ${to}: ${report.failures.join('; ')}`,
        report.failures,
      );
    }

    // Plan effects without side effects so the commit below is all-or-nothing.
    let data = merged;
    const records: EffectRecord[] = [];
    const lines: string[] = [];
    for (const effect of t.effects) {
      try {
        const outcome = planEffect(effect, { claimId, from, to, data, actor, now });
        data = applyOutcome(data, outcome);
        records.push({ type: effect.type, status: 'OK', detail: outcome.detail });
        lines.push(outcome.detail);
      } catch (err) {
        records.push({
          type: effect.type,
          status: 'FAILED',
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const next: Claim = { ...claim, state: to, data, version: claim.version + 1, updatedAt: now.toISOString() };
    const entry = this.commit(
      next,
      claim,
      this.draft({
        kind: 'TRANSITION',
        claimId,
        from,
        to,
        actor,
        reason,
        now,
        changes: diffData(claim.data, data),
        effects: records,
      }),
    );
    // Only now, after the transition is durable, do the mock side effects fire.
    lines.forEach((line) => this.log(line));
    return { ok: true, claim: next, entry };
  }

  // ---- internals ---------------------------------------------------------

  private appliedCount(claimId: string, t: TransitionConfig): number {
    return this.deps.audit
      .query(claimId)
      .filter((e) => e.kind === 'TRANSITION' && e.outcome === 'APPLIED' && e.fromState === t.from && e.toState === t.to)
      .length;
  }

  private parsePatch(raw: unknown): { ok: true; patch: ClaimData } | { ok: false; message: string } {
    const parsed = claimDataSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'data'}: ${i.message}`);
      return { ok: false, message: `Invalid claim data: ${issues.join('; ')}` };
    }
    return { ok: true, patch: stripUndefined(parsed.data) };
  }

  /** Per-field write rules from config; fields without a rule are system-managed. */
  private dataAccessProblems(state: string, role: string, patch: ClaimData): string[] {
    return Object.keys(patch).flatMap((field) => {
      const rule = Object.hasOwn(this.config.dataAccess, field) ? this.config.dataAccess[field] : undefined;
      if (!rule) return [`'${field}' is system-managed and cannot be set manually`];
      if (!rule.roles.includes(role) || !rule.states.includes(state)) {
        return [
          `Role '${role}' may not set '${field}' while the claim is ${state} ` +
            `(allowed roles: ${rule.roles.join(', ')}; allowed states: ${rule.states.join(', ')})`,
        ];
      }
      return [];
    });
  }

  /** Save the claim, then the audit record; if auditing fails, undo the save. */
  private commit(next: Claim, previous: Claim | undefined, draft: AuditDraft): AuditEntry {
    if (previous) this.deps.claims.save(next);
    else this.deps.claims.insert(next);
    try {
      return this.deps.audit.append(draft);
    } catch (err) {
      if (previous) this.deps.claims.save(previous);
      else this.deps.claims.remove(next.id);
      throw err;
    }
  }

  private deny(p: {
    kind: AuditKind;
    claim: Claim;
    to: string;
    actor: Actor;
    reason: string;
    now: Date;
    code: DenialCode;
    message: string;
    details: string[];
  }): Denied {
    const entry = this.deps.audit.append(
      this.draft({
        kind: p.kind,
        claimId: p.claim.id,
        from: p.claim.state,
        to: p.to,
        actor: p.actor,
        reason: p.reason,
        now: p.now,
        denial: { code: p.code, message: p.message },
      }),
    );
    return { ok: false, code: p.code, message: p.message, details: p.details, entry };
  }

  private draft(p: {
    kind: AuditKind;
    claimId: string;
    from: string | null;
    to: string;
    actor: Actor;
    reason: string;
    now: Date;
    changes?: DataChange[];
    effects?: EffectRecord[];
    denial?: { code: DenialCode; message: string };
  }): AuditDraft {
    return {
      timestamp: p.now.toISOString(),
      kind: p.kind,
      claimId: p.claimId,
      fromState: p.from,
      toState: p.to,
      triggeredBy: { userId: p.actor.userId, role: p.actor.role },
      reason: p.reason,
      outcome: p.denial ? 'DENIED' : 'APPLIED',
      errorCode: p.denial?.code ?? null,
      errorMessage: p.denial?.message ?? null,
      dataChanges: p.changes ?? [],
      effects: p.effects ?? [],
    };
  }
}
