import { describe, expect, it } from 'vitest';
import { InvalidRequestError, ClaimNotFoundError } from '../src';
import { createHarness } from '../scenarios/harness';
import { USERS, driveTo, pathTo, steps, type Step } from '../scenarios/scenarios';

type TransitionStep = Extract<Step, { kind: 'transition' }>;

/** Every row of the brief's table: where it starts and the step that performs it. */
const ROWS: { from: string; to: string; step: TransitionStep; hasPrecondition: boolean }[] = [
  { from: 'SUBMITTED', to: 'DOCUMENTS_VERIFIED', step: steps.verify() as TransitionStep, hasPrecondition: true },
  { from: 'DOCUMENTS_VERIFIED', to: 'UNDER_ASSESSMENT', step: steps.startAssessment() as TransitionStep, hasPrecondition: true },
  { from: 'UNDER_ASSESSMENT', to: 'APPROVED', step: steps.approve() as TransitionStep, hasPrecondition: true },
  { from: 'UNDER_ASSESSMENT', to: 'REJECTED', step: steps.reject() as TransitionStep, hasPrecondition: true },
  { from: 'UNDER_ASSESSMENT', to: 'PENDING_INFO', step: steps.requestInfo() as TransitionStep, hasPrecondition: true },
  { from: 'PENDING_INFO', to: 'DOCUMENTS_VERIFIED', step: steps.resume() as TransitionStep, hasPrecondition: true },
  // The payment request is created automatically on approval, so this gate cannot be failed by a user.
  { from: 'APPROVED', to: 'PAYMENT_INITIATED', step: steps.pay() as TransitionStep, hasPrecondition: false },
  { from: 'PAYMENT_INITIATED', to: 'CLOSED', step: steps.closePaid() as TransitionStep, hasPrecondition: true },
  { from: 'REJECTED', to: 'CLOSED', step: steps.closeRejectedAcknowledged() as TransitionStep, hasPrecondition: true },
];

function attempt(h: ReturnType<typeof createHarness>, claimId: string, step: TransitionStep, overrides: Partial<TransitionStep> = {}) {
  const s = { ...step, ...overrides };
  return h.engine.transition(claimId, { to: s.to, actor: s.actor, reason: s.reason, data: s.data });
}

describe.each(ROWS)('$from -> $to', ({ from, to, step, hasPrecondition }) => {
  it('is applied for the allowed role with valid data', () => {
    const h = createHarness();
    const id = driveTo(h, from);
    const result = attempt(h, id, step);
    expect(result.ok).toBe(true);
    expect(h.engine.getClaim(id).state).toBe(to);
  });

  it('is refused for a role that is not allowed, naming the roles required', () => {
    const h = createHarness();
    const id = driveTo(h, from);
    const wrong = step.actor.role === 'finance' ? USERS.assessor : USERS.finance;
    const result = attempt(h, id, step, { actor: wrong });
    expect(result).toMatchObject({ ok: false, code: 'ROLE_NOT_ALLOWED' });
    expect(!result.ok && result.message).toContain(`requires one of: ${step.actor.role}`);
    expect(h.engine.getClaim(id).state).toBe(from);
  });

  it.runIf(hasPrecondition)('is refused when its precondition is not met, without keeping the data', () => {
    const h = createHarness();
    const id = driveTo(h, from);
    const before = h.engine.getClaim(id);
    const result = attempt(h, id, step, { data: undefined });
    expect(result).toMatchObject({ ok: false, code: 'PRECONDITION_FAILED' });
    expect(h.engine.getClaim(id)).toEqual(before);
  });
});

describe('invalid transitions', () => {
  it('SUBMITTED -> APPROVED names both states and the allowed targets', () => {
    const h = createHarness();
    const id = driveTo(h, 'SUBMITTED');
    const result = h.engine.transition(id, { to: 'APPROVED', actor: USERS.assessor, reason: 'skip ahead' });
    expect(result).toMatchObject({
      ok: false,
      code: 'TRANSITION_NOT_DEFINED',
      message: 'Cannot move claim from SUBMITTED to APPROVED: no such transition. Allowed from SUBMITTED: DOCUMENTS_VERIFIED',
    });
  });

  it('refuses any move out of the final state', () => {
    const h = createHarness();
    const id = driveTo(h, 'CLOSED');
    const result = h.engine.transition(id, { to: 'SUBMITTED', actor: USERS.lead, reason: 'reopen' });
    expect(result).toMatchObject({ ok: false, code: 'TRANSITION_NOT_DEFINED' });
    expect(!result.ok && result.message).toContain('CLOSED is a final state');
  });

  it('refuses an unknown target state', () => {
    const h = createHarness();
    const id = driveTo(h, 'SUBMITTED');
    const result = h.engine.transition(id, { to: 'FLYING', actor: USERS.clerk, reason: 'x' });
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN_STATE' });
  });

  it('refuses an unknown role', () => {
    const h = createHarness();
    const id = driveTo(h, 'SUBMITTED');
    const result = h.engine.transition(id, {
      to: 'DOCUMENTS_VERIFIED',
      actor: { userId: 'u1', role: 'admin' },
      reason: 'x',
    });
    expect(result).toMatchObject({ ok: false, code: 'UNKNOWN_ROLE' });
  });

  it('requires a reason on every transition', () => {
    const h = createHarness();
    const id = driveTo(h, 'SUBMITTED');
    const { step } = ROWS[0]!;
    expect(attempt(h, id, step, { reason: '   ' })).toMatchObject({ ok: false, code: 'INVALID_REASON' });
  });

  it('rejects a malformed actor and an unknown claim without touching any claim', () => {
    const h = createHarness();
    const id = driveTo(h, 'SUBMITTED');
    expect(() =>
      h.engine.transition(id, { to: 'DOCUMENTS_VERIFIED', actor: { userId: '', role: 'document_clerk' }, reason: 'x' }),
    ).toThrow(InvalidRequestError);
    expect(() =>
      h.engine.transition('CLM-9999', { to: 'DOCUMENTS_VERIFIED', actor: USERS.clerk, reason: 'x' }),
    ).toThrow(ClaimNotFoundError);
  });
});

describe('preconditions in detail', () => {

  it('reports every failed condition, not just the first', () => {
    const h = createHarness();
    const id = driveTo(h, 'UNDER_ASSESSMENT');
    const result = attempt(h, id, steps.reject() as TransitionStep, { data: {} });
    expect(!result.ok && result.details).toHaveLength(3);
  });

  it.each([1.5, -100, '500', Number.NaN, 2 ** 60])('rejects a non-integer or negative amount: %s', (bad) => {
    const h = createHarness();
    const id = driveTo(h, 'SUBMITTED');
    const result = h.engine.updateClaimData(id, { actor: USERS.clerk, reason: 'typo', data: { claimAmount: bad } });
    expect(result).toMatchObject({ ok: false, code: 'INVALID_DATA' });
  });

  it('a rejected claim cannot close during the appeal period, but can once it has passed', () => {
    const h = createHarness();
    const id = driveTo(h, 'REJECTED');
    const close = steps.closeRejectedAfterDeadline() as TransitionStep;
    expect(attempt(h, id, close)).toMatchObject({ ok: false, code: 'PRECONDITION_FAILED' });
    h.clock.advance(30 * 24 * 3_600_000); // exactly at the deadline: still open for appeal
    expect(attempt(h, id, close)).toMatchObject({ ok: false, code: 'PRECONDITION_FAILED' });
    h.clock.advance(1); // one millisecond later
    expect(attempt(h, id, close).ok).toBe(true);
  });

  it('a rejected claim can close early once the member acknowledges', () => {
    const h = createHarness();
    const id = driveTo(h, 'REJECTED');
    expect(attempt(h, id, steps.closeRejectedAcknowledged() as TransitionStep).ok).toBe(true);
  });
});

describe('who may set which data', () => {
  it('refuses a transition that smuggles in a field the role does not own', () => {
    const h = createHarness();
    const id = driveTo(h, 'APPROVED');
    const result = attempt(h, id, steps.pay() as TransitionStep, { data: { paymentConfirmed: true } });
    expect(result).toMatchObject({ ok: false, code: 'DATA_NOT_ALLOWED' });
  });

  it('refuses to set system-managed fields by hand', () => {
    const h = createHarness();
    const id = driveTo(h, 'UNDER_ASSESSMENT');
    const result = h.engine.updateClaimData(id, {
      actor: USERS.assessor,
      reason: 'fake payment request',
      data: { paymentRequestId: 'PAY-REQ-FAKE' },
    });
    expect(result).toMatchObject({ ok: false, code: 'DATA_NOT_ALLOWED' });
    expect(!result.ok && result.message).toContain('system-managed');
  });

  it('refuses edits in a state where the field is locked', () => {
    const h = createHarness();
    const id = driveTo(h, 'APPROVED');
    const result = h.engine.updateClaimData(id, { actor: USERS.assessor, reason: 'raise amount after approval', data: { claimAmount: 900_000 } });
    expect(result).toMatchObject({ ok: false, code: 'DATA_NOT_ALLOWED' });
  });

  it('only the intake role can submit a claim', () => {
    const h = createHarness();
    expect(h.engine.createClaim({ actor: USERS.finance, data: {} })).toMatchObject({ ok: false, code: 'ROLE_NOT_ALLOWED' });
    expect(h.engine.listClaims()).toHaveLength(0);
  });
});

describe('information-request cycle guard', () => {
  function cycles(h: ReturnType<typeof createHarness>, id: string, count: number) {
    for (let n = 1; n <= count; n++) {
      expect(attempt(h, id, steps.requestInfo(n) as TransitionStep).ok).toBe(true);
      expect(attempt(h, id, steps.resume() as TransitionStep).ok).toBe(true);
      expect(attempt(h, id, steps.startAssessment() as TransitionStep).ok).toBe(true);
    }
  }

  it('allows three cycles and refuses the fourth request with the exact message', () => {
    const h = createHarness();
    const id = driveTo(h, 'UNDER_ASSESSMENT');
    cycles(h, id, 3);
    const fourth = attempt(h, id, steps.requestInfo(4) as TransitionStep);
    expect(fourth).toMatchObject({
      ok: false,
      code: 'MAX_COUNT_EXCEEDED',
      message: 'Maximum information requests exceeded — escalate to team lead',
    });
    expect(h.engine.getClaim(id).state).toBe('UNDER_ASSESSMENT');
  });

  it('still lets the assessor decide after the limit is hit', () => {
    const h = createHarness();
    const id = driveTo(h, 'UNDER_ASSESSMENT');
    cycles(h, id, 3);
    expect(attempt(h, id, steps.requestInfo(4) as TransitionStep).ok).toBe(false);
    expect(attempt(h, id, steps.approve() as TransitionStep).ok).toBe(true);
  });

  it('counts per claim, not globally', () => {
    const h = createHarness();
    const a = driveTo(h, 'UNDER_ASSESSMENT');
    const b = driveTo(h, 'UNDER_ASSESSMENT');
    cycles(h, a, 3);
    expect(attempt(h, b, steps.requestInfo(1) as TransitionStep).ok).toBe(true);
  });

  it('does not count refused attempts toward the limit', () => {
    const h = createHarness();
    const id = driveTo(h, 'UNDER_ASSESSMENT');
    for (let i = 0; i < 5; i++) attempt(h, id, steps.requestInfo(1) as TransitionStep, { data: {} }); // precondition fails
    cycles(h, id, 3);
  });

  it('clears per-cycle data so a stale flag cannot satisfy the next cycle', () => {
    const h = createHarness();
    const id = driveTo(h, 'UNDER_ASSESSMENT');
    cycles(h, id, 1);
    attempt(h, id, steps.requestInfo(2) as TransitionStep);
    const resume = attempt(h, id, steps.resume() as TransitionStep, { data: { documents: ['claim_form'] } });
    expect(resume).toMatchObject({ ok: false, code: 'PRECONDITION_FAILED' });
  });
});

describe('side effects', () => {
  it('fire only after a transition is committed, in config order, with rendered messages', () => {
    const h = createHarness();
    const id = driveTo(h, 'UNDER_ASSESSMENT');
    h.logs.length = 0;
    attempt(h, id, steps.approve() as TransitionStep);
    expect(h.logs).toEqual([
      `[notify:member] claim ${id}: Your claim has been approved`,
      `[payments] claim ${id}: payment request PAY-REQ-${id} created for approved amount 500000`,
    ]);
    expect(h.engine.getClaim(id).data.paymentRequestId).toBe(`PAY-REQ-${id}`);
  });

  it('do not fire for a refused transition', () => {
    const h = createHarness();
    const id = driveTo(h, 'UNDER_ASSESSMENT');
    h.logs.length = 0;
    attempt(h, id, steps.approve() as TransitionStep, { data: undefined, actor: USERS.finance });
    expect(h.logs).toEqual([]);
  });

  it('include the rejection reason and payment reference in member notices', () => {
    const h = createHarness();
    const rejected = driveTo(h, 'REJECTED');
    expect(h.logs.some((l) => l.includes('Reason: Policy exclusion applies'))).toBe(true);
    h.logs.length = 0;
    const paid = driveTo(h, 'CLOSED');
    expect(h.logs.some((l) => l.includes(`claim ${paid}: Your claim is closed. Payment reference: BANK-TXN-778899`))).toBe(true);
    expect(rejected).not.toBe(paid);
  });

  it('records the start of assessment and clears it when the clock is reset', () => {
    const h = createHarness();
    const id = driveTo(h, 'UNDER_ASSESSMENT');
    expect(h.engine.getClaim(id).data.assessmentStartedAt).toBe('2026-11-01T09:00:00.000Z');
    attempt(h, id, steps.requestInfo() as TransitionStep);
    attempt(h, id, steps.resume() as TransitionStep);
    expect(h.engine.getClaim(id).data.assessmentStartedAt).toBeUndefined();
  });
});

describe('available transitions', () => {
  it('lists next steps with required roles and live precondition status', () => {
    const h = createHarness();
    const id = driveTo(h, 'UNDER_ASSESSMENT');
    const available = h.engine.availableTransitions(id);
    expect(available.map((t) => t.to).sort()).toEqual(['APPROVED', 'PENDING_INFO', 'REJECTED']);
    const approve = available.find((t) => t.to === 'APPROVED')!;
    expect(approve.roles).toEqual(['assessor']);
    expect(approve.preconditions.map((p) => p.satisfied)).toEqual([false, false, false, false]);
    expect(available.find((t) => t.to === 'PENDING_INFO')!.limit).toMatchObject({ max: 3, used: 0 });
  });

  it('is empty in the final state', () => {
    const h = createHarness();
    expect(h.engine.availableTransitions(driveTo(h, 'CLOSED'))).toEqual([]);
  });
});

describe('pathTo', () => {
  it('every reachable state has a path', () => {
    for (const state of ['SUBMITTED', 'DOCUMENTS_VERIFIED', 'UNDER_ASSESSMENT', 'APPROVED', 'PAYMENT_INITIATED', 'REJECTED', 'PENDING_INFO', 'CLOSED']) {
      expect(pathTo(state).length).toBeGreaterThan(0);
    }
  });
});
