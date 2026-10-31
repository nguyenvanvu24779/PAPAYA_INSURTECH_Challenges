import { describe, expect, it } from 'vitest';
import { CLAIM_FIELD_KINDS, loadWorkflowFile, type FieldKind } from '../src';
import { CONFIG_PATH, createHarness } from '../scenarios/harness';
import { REQUIRED_DOCS, USERS, driveTo, steps, type Step } from '../scenarios/scenarios';

type TransitionStep = Extract<Step, { kind: 'transition' }>;

function attempt(h: ReturnType<typeof createHarness>, claimId: string, step: TransitionStep, overrides: Partial<TransitionStep> = {}) {
  const s = { ...step, ...overrides };
  return h.engine.transition(claimId, { to: s.to, actor: s.actor, reason: s.reason, data: s.data });
}

const approve = steps.approve() as TransitionStep;
const reject = steps.reject() as TransitionStep;
const resume = steps.resume() as TransitionStep;
const requestInfo = steps.requestInfo() as TransitionStep;
const startAssessment = steps.startAssessment() as TransitionStep;

/** Goes UNDER_ASSESSMENT -> PENDING_INFO -> DOCUMENTS_VERIFIED -> UNDER_ASSESSMENT. */
function oneInfoCycle(h: ReturnType<typeof createHarness>, id: string) {
  expect(attempt(h, id, requestInfo).ok).toBe(true);
  expect(attempt(h, id, resume).ok).toBe(true);
  expect(attempt(h, id, startAssessment).ok).toBe(true);
}

describe('1. documents are re-checked in full after information is received', () => {
  it('refuses to resume when the clerk hands back only the missing documents', () => {
    const h = createHarness();
    const id = driveTo(h, 'PENDING_INFO');
    const result = attempt(h, id, resume, { data: { documents: ['hospital_invoice'], newInfoReceived: true } });
    expect(result).toMatchObject({ ok: false, code: 'PRECONDITION_FAILED' });
    expect(!result.ok && result.details[0]).toContain('All required documents must be present again');
    expect(h.engine.getClaim(id).state).toBe('PENDING_INFO');
  });

  it('refuses to resume when one required document is still missing', () => {
    const h = createHarness();
    const id = driveTo(h, 'PENDING_INFO');
    const result = attempt(h, id, resume, { data: { documents: ['claim_form', 'identity_document'], newInfoReceived: true } });
    expect(result).toMatchObject({ ok: false, code: 'PRECONDITION_FAILED' });
  });

  it('resumes once the complete set is present, extra documents allowed', () => {
    const h = createHarness();
    const id = driveTo(h, 'PENDING_INFO');
    const result = attempt(h, id, resume, { data: { documents: [...REQUIRED_DOCS, 'hospital_invoice'], newInfoReceived: true } });
    expect(result.ok).toBe(true);
  });

  it('applies the same list as the first verification (single source in config)', () => {
    const config = loadWorkflowFile(CONFIG_PATH);
    const requiredDocs = (id: string) =>
      (config.transitions.find((t) => t.id === id)!.preconditions.find((p) => p.type === 'includesAll') as { values: string[] }).values;
    expect(requiredDocs('resume_after_info')).toEqual(requiredDocs('verify_documents'));
    expect(requiredDocs('verify_documents')).toEqual(REQUIRED_DOCS);
  });
});

describe('2. every return from PENDING_INFO restarts the assessment', () => {
  it('wipes the previous assessment, so the assessor cannot approve straight away', () => {
    const h = createHarness();
    const id = driveTo(h, 'UNDER_ASSESSMENT');
    h.engine.updateClaimData(id, {
      actor: USERS.assessor,
      reason: 'Assessment finished before asking for more',
      data: { assessmentReportComplete: true, approvedAmount: 500_000 },
    });
    oneInfoCycle(h, id);

    const data = h.engine.getClaim(id).data;
    expect(data.assessmentReportComplete).toBeUndefined();
    expect(data.approvedAmount).toBeUndefined();

    const immediate = attempt(h, id, approve, { data: undefined });
    expect(immediate).toMatchObject({ ok: false, code: 'PRECONDITION_FAILED' });
    expect(attempt(h, id, approve).ok).toBe(true); // only after assessing again
  });

  it('wipes a stale rejection reason and appeal deadline as well', () => {
    const h = createHarness();
    const id = driveTo(h, 'UNDER_ASSESSMENT');
    h.engine.updateClaimData(id, {
      actor: USERS.assessor,
      reason: 'Draft rejection',
      data: { assessmentReportComplete: true, rejectionReason: 'Draft', appealDeadline: '2030-01-01T00:00:00.000Z' },
    });
    oneInfoCycle(h, id);
    expect(attempt(h, id, reject, { data: undefined })).toMatchObject({ ok: false, code: 'PRECONDITION_FAILED' });
  });

  it('applies on every cycle, not only the first', () => {
    const h = createHarness();
    const id = driveTo(h, 'UNDER_ASSESSMENT');
    for (let n = 1; n <= 3; n++) {
      h.engine.updateClaimData(id, { actor: USERS.assessor, reason: `report ${n}`, data: { assessmentReportComplete: true } });
      oneInfoCycle(h, id);
      expect(h.engine.getClaim(id).data.assessmentReportComplete).toBeUndefined();
    }
  });

  it('keeps the original request and assignment intact', () => {
    const h = createHarness();
    const id = driveTo(h, 'UNDER_ASSESSMENT');
    oneInfoCycle(h, id);
    expect(h.engine.getClaim(id).data).toMatchObject({ claimAmount: 500_000, coverageLimit: 1_000_000, assessorId: 'assessor-01' });
  });
});

describe('3. each role edits data only in its own stage', () => {
  const config = loadWorkflowFile(CONFIG_PATH);
  const SAMPLE: Record<FieldKind, unknown> = {
    string: 'x',
    boolean: true,
    integer: 1,
    datetime: '2030-01-01T00:00:00.000Z',
    stringArray: ['a'],
  };

  it('config invariant: the clerk only writes at intake or while receiving information', () => {
    for (const [field, rule] of Object.entries(config.dataAccess)) {
      if (rule.roles.includes('document_clerk')) {
        expect(rule.states.every((s) => ['SUBMITTED', 'PENDING_INFO'].includes(s)), field).toBe(true);
      }
    }
  });

  it('config invariant: the assessor only writes while assessing', () => {
    for (const [field, rule] of Object.entries(config.dataAccess)) {
      if (rule.roles.includes('assessor')) expect(rule.states, field).toEqual(['UNDER_ASSESSMENT']);
    }
  });

  it.each(Object.keys(config.states))(
    'in %s every role may set exactly the fields its rule allows, nothing else',
    (state) => {
      const h = createHarness();
      const id = driveTo(h, state);
      for (const role of config.roles) {
        for (const [field, kind] of Object.entries(CLAIM_FIELD_KINDS)) {
          const rule = config.dataAccess[field];
          const expected = rule !== undefined && rule.roles.includes(role) && rule.states.includes(state);
          const result = h.engine.updateClaimData(id, {
            actor: { userId: `u-${role}`, role },
            reason: 'matrix',
            data: { [field]: SAMPLE[kind] },
          });
          expect(result.ok, `${role} setting ${field} in ${state}`).toBe(expected);
        }
      }
    },
  );

  it('the clerk cannot touch the amount once assessment has started', () => {
    const h = createHarness();
    const id = driveTo(h, 'UNDER_ASSESSMENT');
    const result = h.engine.updateClaimData(id, { actor: USERS.clerk, reason: 'fix amount', data: { claimAmount: 100 } });
    expect(result).toMatchObject({ ok: false, code: 'DATA_NOT_ALLOWED' });
    expect(h.engine.getClaim(id).data.claimAmount).toBe(500_000);
  });

  it('the assessor cannot edit documents or intake data', () => {
    const h = createHarness();
    const id = driveTo(h, 'UNDER_ASSESSMENT');
    for (const data of [{ documents: ['x'] }, { claimAmount: 1 }, { coverageLimit: 99_999_999 }]) {
      expect(h.engine.updateClaimData(id, { actor: USERS.assessor, reason: 'x', data })).toMatchObject({ ok: false, code: 'DATA_NOT_ALLOWED' });
    }
  });
});

describe('4. the requested amount is preserved; approval uses a separate approved amount', () => {
  const OVER_LIMIT = { claimAmount: 1_500_000, coverageLimit: 1_000_000 };

  it('an over-limit claim can be approved at the limit and the requested amount stays', () => {
    const h = createHarness();
    const id = driveTo(h, 'UNDER_ASSESSMENT', OVER_LIMIT);
    const result = attempt(h, id, approve, { data: { assessmentReportComplete: true, approvedAmount: 1_000_000 } });
    expect(result.ok).toBe(true);
    expect(h.engine.getClaim(id).data).toMatchObject({ claimAmount: 1_500_000, approvedAmount: 1_000_000 });
  });

  it('refuses an approved amount above the coverage limit', () => {
    const h = createHarness();
    const id = driveTo(h, 'UNDER_ASSESSMENT', OVER_LIMIT);
    const result = attempt(h, id, approve, { data: { assessmentReportComplete: true, approvedAmount: 1_000_001 } });
    expect(result).toMatchObject({ ok: false, code: 'PRECONDITION_FAILED' });
    expect(!result.ok && result.details).toEqual(['Approved amount must not exceed the coverage limit']);
  });

  it('refuses an approved amount above what was claimed', () => {
    const h = createHarness();
    const id = driveTo(h, 'UNDER_ASSESSMENT');
    const result = attempt(h, id, approve, { data: { assessmentReportComplete: true, approvedAmount: 600_000 } });
    expect(!result.ok && result.details).toEqual(['Approved amount must not exceed the amount claimed']);
  });

  it('refuses approval with no approved amount at all', () => {
    const h = createHarness();
    const id = driveTo(h, 'UNDER_ASSESSMENT');
    const result = attempt(h, id, approve, { data: { assessmentReportComplete: true } });
    expect(!result.ok && result.details).toContain('An approved amount must be set');
  });

  it('accepts an approved amount exactly equal to both the claim and the limit', () => {
    const h = createHarness();
    const exact = { claimAmount: 1_000_000, coverageLimit: 1_000_000 };
    const id = driveTo(h, 'UNDER_ASSESSMENT', exact);
    expect(attempt(h, id, approve, { data: { assessmentReportComplete: true, approvedAmount: 1_000_000 } }).ok).toBe(true);
  });

  it('the assessor cannot lower the claimed amount to get under the limit, by any route', () => {
    const h = createHarness();
    const id = driveTo(h, 'UNDER_ASSESSMENT', OVER_LIMIT);
    const viaUpdate = h.engine.updateClaimData(id, { actor: USERS.assessor, reason: 'cap', data: { claimAmount: 1_000_000 } });
    const viaTransition = attempt(h, id, approve, { data: { assessmentReportComplete: true, claimAmount: 1_000_000, approvedAmount: 1_000_000 } });
    expect(viaUpdate).toMatchObject({ ok: false, code: 'DATA_NOT_ALLOWED' });
    expect(viaTransition).toMatchObject({ ok: false, code: 'DATA_NOT_ALLOWED' });
    expect(h.engine.getClaim(id).data.claimAmount).toBe(1_500_000);
    expect(h.engine.getClaim(id).state).toBe('UNDER_ASSESSMENT');
  });
});

describe('5. the appeal deadline must be after the time of rejection', () => {
  const rejectWith = (appealDeadline?: string) => ({
    assessmentReportComplete: true,
    rejectionReason: 'Policy exclusion applies',
    ...(appealDeadline === undefined ? {} : { appealDeadline }),
  });

  it('refuses a deadline in the past, so the member keeps the right to appeal', () => {
    const h = createHarness();
    const id = driveTo(h, 'UNDER_ASSESSMENT');
    const result = attempt(h, id, reject, { data: rejectWith('2020-01-01T00:00:00.000Z') });
    expect(result).toMatchObject({ ok: false, code: 'PRECONDITION_FAILED' });
    expect(!result.ok && result.message).toContain('after the time of rejection');
    expect(h.engine.getClaim(id).state).toBe('UNDER_ASSESSMENT');
  });

  it('refuses a deadline equal to the moment of rejection and accepts one millisecond later', () => {
    const h = createHarness();
    const id = driveTo(h, 'UNDER_ASSESSMENT');
    const now = h.clock.now();
    expect(attempt(h, id, reject, { data: rejectWith(now.toISOString()) }).ok).toBe(false);
    expect(attempt(h, id, reject, { data: rejectWith(new Date(now.getTime() + 1).toISOString()) }).ok).toBe(true);
  });

  it('refuses a rejection with no deadline at all', () => {
    const h = createHarness();
    const id = driveTo(h, 'UNDER_ASSESSMENT');
    expect(attempt(h, id, reject, { data: rejectWith() })).toMatchObject({ ok: false, code: 'PRECONDITION_FAILED' });
  });

  it('a deadline that was in the future when set but has since passed is refused at rejection time', () => {
    const h = createHarness();
    const id = driveTo(h, 'UNDER_ASSESSMENT');
    h.engine.updateClaimData(id, {
      actor: USERS.assessor,
      reason: 'planned deadline',
      data: { appealDeadline: new Date(h.clock.now().getTime() + 60_000).toISOString() },
    });
    h.clock.advance(120_000);
    const result = attempt(h, id, reject, { data: { assessmentReportComplete: true, rejectionReason: 'late' } });
    expect(result).toMatchObject({ ok: false, code: 'PRECONDITION_FAILED' });
  });

  it('the system cannot close a rejected claim immediately, and the deadline cannot be edited afterwards', () => {
    const h = createHarness();
    const id = driveTo(h, 'REJECTED');
    expect(attempt(h, id, steps.closeRejectedAfterDeadline() as TransitionStep)).toMatchObject({ ok: false, code: 'PRECONDITION_FAILED' });
    const edit = h.engine.updateClaimData(id, { actor: USERS.assessor, reason: 'shorten', data: { appealDeadline: '2020-01-01T00:00:00.000Z' } });
    expect(edit).toMatchObject({ ok: false, code: 'DATA_NOT_ALLOWED' });
  });
});
