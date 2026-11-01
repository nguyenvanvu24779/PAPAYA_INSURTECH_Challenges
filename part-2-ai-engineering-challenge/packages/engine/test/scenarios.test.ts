import { describe, expect, it } from 'vitest';
import { createHarness } from '../scenarios/harness';
import { CYCLE_LIMIT_MESSAGE, SCENARIOS, runScenario } from '../scenarios/scenarios';

describe.each(SCENARIOS)('scenario $id: $name', (scenario) => {
  const harness = createHarness();
  const report = runScenario(harness, scenario);

  it('every step behaves as expected and the claim ends in the right state', () => {
    expect(report.steps.filter((s) => !s.passed)).toEqual([]);
    expect(report.finalState).toBe(scenario.finalState);
    expect(report.passed).toBe(true);
  });

  it('leaves a complete, ordered audit trail', () => {
    const applied = report.audit.filter((e) => e.outcome === 'APPLIED' && e.kind === 'TRANSITION');
    const denied = report.audit.filter((e) => e.outcome === 'DENIED');
    const expectedDenied = scenario.steps.filter((s) => s.kind !== 'advanceClock' && s.expect !== 'APPLIED');

    expect(denied).toHaveLength(expectedDenied.length);
    // The applied transitions chain together: each starts where the previous ended.
    applied.forEach((entry, i) => {
      if (i > 0) expect(entry.fromState).toBe(applied[i - 1]!.toState);
    });
    expect(applied.at(-1)?.toState ?? 'SUBMITTED').toBe(scenario.finalState === 'SUBMITTED' ? 'SUBMITTED' : scenario.finalState);
    expect(report.audit.map((e) => e.seq)).toEqual([...report.audit.keys()].map((i) => report.audit[0]!.seq + i));
    for (const e of report.audit) {
      expect(e.triggeredBy.userId).not.toBe('');
      expect(e.reason).not.toBe('');
      expect(Number.isNaN(Date.parse(e.timestamp))).toBe(false);
    }
  });
});

describe('scenario specifics', () => {
  it('happy path audit lists the five transitions and the creation, all applied', () => {
    const report = runScenario(createHarness(), SCENARIOS[0]!);
    expect(report.audit.map((e) => `${e.fromState ?? '-'}>${e.toState}:${e.outcome}`)).toEqual([
      '->SUBMITTED:APPLIED',
      'SUBMITTED>DOCUMENTS_VERIFIED:APPLIED',
      'DOCUMENTS_VERIFIED>UNDER_ASSESSMENT:APPLIED',
      'UNDER_ASSESSMENT>APPROVED:APPLIED',
      'APPROVED>PAYMENT_INITIATED:APPLIED',
      'PAYMENT_INITIATED>CLOSED:APPLIED',
    ]);
  });

  it('records who did each step, with their role', () => {
    const report = runScenario(createHarness(), SCENARIOS[0]!);
    expect(report.audit.map((e) => e.triggeredBy.role)).toEqual([
      'document_clerk',
      'document_clerk',
      'team_lead',
      'assessor',
      'finance',
      'finance',
    ]);
  });

  it('the info loop passes through PENDING_INFO and back exactly once', () => {
    const report = runScenario(createHarness(), SCENARIOS[2]!);
    const path = report.audit.filter((e) => e.kind === 'TRANSITION').map((e) => e.toState);
    expect(path).toEqual([
      'DOCUMENTS_VERIFIED',
      'UNDER_ASSESSMENT',
      'PENDING_INFO',
      'DOCUMENTS_VERIFIED',
      'UNDER_ASSESSMENT',
      'APPROVED',
      'PAYMENT_INITIATED',
      'CLOSED',
    ]);
  });

  it('the cycle guard scenario ends refused with the mandated message in the audit', () => {
    const report = runScenario(createHarness(), SCENARIOS[5]!);
    const last = report.audit.at(-1)!;
    expect(last).toMatchObject({ outcome: 'DENIED', errorCode: 'MAX_COUNT_EXCEEDED', errorMessage: CYCLE_LIMIT_MESSAGE });
  });
});
