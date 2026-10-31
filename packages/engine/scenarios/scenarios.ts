import type { Actor, AuditEntry, DenialCode, Result } from '../src';
import { T0, type Harness } from './harness';

export const USERS = {
  clerk: { userId: 'clerk-01', role: 'document_clerk' },
  lead: { userId: 'lead-01', role: 'team_lead' },
  assessor: { userId: 'assessor-01', role: 'assessor' },
  finance: { userId: 'finance-01', role: 'finance' },
  system: { userId: 'system', role: 'system' },
} as const satisfies Record<string, Actor>;

export const REQUIRED_DOCS = ['claim_form', 'identity_document', 'supporting_evidence'];
export const HOUR_MS = 3_600_000;
export const APPEAL_DEADLINE = new Date(T0.getTime() + 30 * 24 * HOUR_MS).toISOString();
export const CYCLE_LIMIT_MESSAGE = 'Maximum information requests exceeded — escalate to team lead';

export type Expect = 'APPLIED' | DenialCode;

export type Step =
  | { kind: 'create'; label: string; actor: Actor; data?: object; expect: Expect }
  | {
      kind: 'transition';
      label: string;
      to: string;
      actor: Actor;
      reason: string;
      data?: object;
      expect: Expect;
      expectMessage?: string;
    }
  | { kind: 'advanceClock'; label: string; hours: number };

function transition(
  label: string,
  to: string,
  actor: Actor,
  reason: string,
  data?: object,
  expect: Expect = 'APPLIED',
  expectMessage?: string,
): Step {
  return { kind: 'transition', label, to, actor, reason, data, expect, expectMessage };
}

/** Reusable steps. Each is the successful form of one row of the brief's table. */
export const steps = {
  create: (data: object = { claimAmount: 500_000, coverageLimit: 1_000_000 }): Step => ({
    kind: 'create',
    label: 'Clerk submits claim (amount 5,000.00, limit 10,000.00)',
    actor: USERS.clerk,
    data,
    expect: 'APPLIED',
  }),
  verify: (): Step =>
    transition('Clerk verifies documents', 'DOCUMENTS_VERIFIED', USERS.clerk, 'All required documents present', {
      documents: REQUIRED_DOCS,
    }),
  startAssessment: (): Step =>
    transition('Team lead assigns assessor and starts assessment', 'UNDER_ASSESSMENT', USERS.lead, 'Assigned to assessor-01', {
      assessorId: 'assessor-01',
    }),
  approve: (): Step =>
    transition('Assessor approves', 'APPROVED', USERS.assessor, 'Report complete, amount within coverage limit', {
      assessmentReportComplete: true,
      approvedAmount: 500_000,
    }),
  reject: (): Step =>
    transition('Assessor rejects', 'REJECTED', USERS.assessor, 'Policy exclusion applies', {
      assessmentReportComplete: true,
      rejectionReason: 'Policy exclusion applies',
      appealDeadline: APPEAL_DEADLINE,
    }),
  requestInfo: (n = 1): Step =>
    transition(`Assessor requests information (#${n})`, 'PENDING_INFO', USERS.assessor, `Information request #${n}`, {
      missingInfoDescription: `Hospital invoice, request #${n}`,
    }),
  resume: (): Step =>
    transition('Clerk records received information', 'DOCUMENTS_VERIFIED', USERS.clerk, 'Member sent the requested documents', {
      documents: [...REQUIRED_DOCS, 'hospital_invoice'],
      newInfoReceived: true,
    }),
  pay: (): Step =>
    transition('Finance initiates payment', 'PAYMENT_INITIATED', USERS.finance, 'Payment request approved for processing'),
  closePaid: (): Step =>
    transition('Finance closes after payment confirmation', 'CLOSED', USERS.finance, 'Payment confirmed by bank', {
      paymentConfirmed: true,
      paymentReference: 'BANK-TXN-778899',
    }),
  closeRejectedAcknowledged: (): Step =>
    transition('System closes: member acknowledged rejection', 'CLOSED', USERS.system, 'Member acknowledged the rejection', {
      memberAcknowledged: true,
    }),
  closeRejectedAfterDeadline: (): Step =>
    transition('System closes: appeal period expired', 'CLOSED', USERS.system, 'Appeal period expired'),
};

/** Steps that bring a fresh claim to the given state (all must be APPLIED). */
export function pathTo(state: string, createData?: object): Step[] {
  const toUnderAssessment = [steps.create(createData), steps.verify(), steps.startAssessment()];
  switch (state) {
    case 'SUBMITTED':
      return [steps.create(createData)];
    case 'DOCUMENTS_VERIFIED':
      return [steps.create(createData), steps.verify()];
    case 'UNDER_ASSESSMENT':
      return toUnderAssessment;
    case 'APPROVED':
      return [...toUnderAssessment, steps.approve()];
    case 'PAYMENT_INITIATED':
      return [...toUnderAssessment, steps.approve(), steps.pay()];
    case 'REJECTED':
      return [...toUnderAssessment, steps.reject()];
    case 'PENDING_INFO':
      return [...toUnderAssessment, steps.requestInfo()];
    case 'CLOSED':
      return [...toUnderAssessment, steps.approve(), steps.pay(), steps.closePaid()];
    default:
      throw new Error(`No path defined to ${state}`);
  }
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  steps: Step[];
  finalState: string;
}

const cycleSteps = (n: number): Step[] => [steps.requestInfo(n), steps.resume(), steps.startAssessment()];

export const SCENARIOS: Scenario[] = [
  {
    id: '1',
    name: 'Happy path',
    description: 'SUBMITTED → DOCUMENTS_VERIFIED → UNDER_ASSESSMENT → APPROVED → PAYMENT_INITIATED → CLOSED',
    steps: [...pathTo('PAYMENT_INITIATED'), steps.closePaid()],
    finalState: 'CLOSED',
  },
  {
    id: '2',
    name: 'Rejection path',
    description:
      'SUBMITTED → DOCUMENTS_VERIFIED → UNDER_ASSESSMENT → REJECTED → CLOSED. ' +
      'Also proves a failed precondition: the system cannot close before the appeal period ends.',
    steps: [
      ...pathTo('REJECTED'),
      {
        ...steps.closeRejectedAfterDeadline(),
        label: 'System tries to close during the appeal period (must fail)',
        expect: 'PRECONDITION_FAILED',
      } as Step,
      { kind: 'advanceClock', label: 'Time passes: 31 days', hours: 31 * 24 },
      steps.closeRejectedAfterDeadline(),
    ],
    finalState: 'CLOSED',
  },
  {
    id: '3',
    name: 'Information request loop',
    description:
      'SUBMITTED → DOCUMENTS_VERIFIED → UNDER_ASSESSMENT → PENDING_INFO → DOCUMENTS_VERIFIED → ' +
      'UNDER_ASSESSMENT → APPROVED → PAYMENT_INITIATED → CLOSED',
    steps: [
      ...pathTo('PENDING_INFO'),
      steps.resume(),
      steps.startAssessment(),
      steps.approve(),
      steps.pay(),
      steps.closePaid(),
    ],
    finalState: 'CLOSED',
  },
  {
    id: '4',
    name: 'Invalid transition',
    description: 'SUBMITTED → APPROVED is not defined and must fail with a specific error.',
    steps: [
      steps.create(),
      transition(
        'Assessor tries SUBMITTED → APPROVED (must fail)',
        'APPROVED',
        USERS.assessor,
        'Trying to skip verification',
        { assessmentReportComplete: true },
        'TRANSITION_NOT_DEFINED',
        'Cannot move claim from SUBMITTED to APPROVED: no such transition. Allowed from SUBMITTED: DOCUMENTS_VERIFIED',
      ),
    ],
    finalState: 'SUBMITTED',
  },
  {
    id: '5',
    name: 'Wrong role',
    description: 'A role that is not allowed attempts a valid transition and must be refused.',
    steps: [
      steps.create(),
      {
        ...steps.verify(),
        label: 'Finance tries to verify documents (must fail)',
        actor: USERS.finance,
        expect: 'ROLE_NOT_ALLOWED',
        expectMessage: "Role 'finance' cannot move a claim from SUBMITTED to DOCUMENTS_VERIFIED; requires one of: document_clerk",
      } as Step,
      steps.verify(),
      {
        ...steps.startAssessment(),
        label: 'Clerk tries to start assessment (must fail)',
        actor: USERS.clerk,
        expect: 'ROLE_NOT_ALLOWED',
      } as Step,
    ],
    finalState: 'DOCUMENTS_VERIFIED',
  },
  {
    id: '6 (extra)',
    name: 'Cycle guard',
    description:
      'Three information-request cycles are allowed; the 4th request is refused with the mandated message.',
    steps: [
      ...pathTo('UNDER_ASSESSMENT'),
      ...cycleSteps(1),
      ...cycleSteps(2),
      ...cycleSteps(3),
      {
        ...steps.requestInfo(4),
        label: 'Assessor requests information a 4th time (must fail)',
        expect: 'MAX_COUNT_EXCEEDED',
        expectMessage: CYCLE_LIMIT_MESSAGE,
      } as Step,
    ],
    finalState: 'UNDER_ASSESSMENT',
  },
];

export interface StepReport {
  label: string;
  expected: Expect | null;
  actual: Expect | null;
  message: string | null;
  stateAfter: string | null;
  passed: boolean;
}

export interface ScenarioReport {
  scenario: Scenario;
  claimId: string | null;
  steps: StepReport[];
  finalState: string | null;
  passed: boolean;
  audit: readonly AuditEntry[];
}

export function runScenario({ engine, clock }: Harness, scenario: Scenario): ScenarioReport {
  let claimId: string | null = null;
  const reports: StepReport[] = [];

  for (const step of scenario.steps) {
    if (step.kind === 'advanceClock') {
      clock.advance(step.hours * HOUR_MS);
      reports.push({ label: step.label, expected: null, actual: null, message: null, stateAfter: claimId && engine.getClaim(claimId).state, passed: true });
      continue;
    }

    let result: Result;
    if (step.kind === 'create') {
      result = engine.createClaim({ actor: step.actor, data: step.data });
      if (result.ok) claimId = result.claim.id;
    } else {
      result = engine.transition(claimId!, { to: step.to, actor: step.actor, reason: step.reason, data: step.data });
    }

    const actual: Expect = result.ok ? 'APPLIED' : result.code;
    const message = result.ok ? null : result.message;
    reports.push({
      label: step.label,
      expected: step.expect,
      actual,
      message,
      stateAfter: claimId && engine.getClaim(claimId).state,
      passed: actual === step.expect && (step.kind !== 'transition' || step.expectMessage === undefined || message === step.expectMessage),
    });
  }

  const finalState = claimId && engine.getClaim(claimId).state;
  return {
    scenario,
    claimId,
    steps: reports,
    finalState,
    passed: reports.every((r) => r.passed) && finalState === scenario.finalState,
    audit: claimId ? engine.getAudit(claimId) : [],
  };
}

/** Drive a fresh claim to `state`, asserting every step is applied. */
export function driveTo(harness: Harness, state: string, createData?: object): string {
  const report = runScenario(harness, {
    id: 'path',
    name: `path to ${state}`,
    description: '',
    steps: pathTo(state, createData),
    finalState: state,
  });
  if (!report.passed) throw new Error(`Could not reach ${state}: ${JSON.stringify(report.steps)}`);
  return report.claimId!;
}
