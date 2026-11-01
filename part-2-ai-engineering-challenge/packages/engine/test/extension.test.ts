import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadWorkflowFile } from '../src';
import { createHarness } from '../scenarios/harness';
import { USERS, driveTo } from '../scenarios/scenarios';

const EXTENDED = fileURLToPath(new URL('../../../docs/examples/claim-workflow.with-escalation.yaml', import.meta.url));

describe('extending the workflow by configuration only', () => {
  const config = loadWorkflowFile(EXTENDED);

  it('adds a new state and two transitions with no code change', () => {
    expect(config.states).toHaveProperty('ESCALATED');
    expect(config.transitions).toHaveLength(11);
  });

  it('lets the team lead escalate a claim and hand it back, and enforces the new rules', () => {
    const h = createHarness({ config });
    const id = driveTo(h, 'UNDER_ASSESSMENT');

    const wrongRole = h.engine.transition(id, { to: 'ESCALATED', actor: USERS.assessor, reason: 'x' });
    expect(wrongRole).toMatchObject({ ok: false, code: 'ROLE_NOT_ALLOWED' });

    expect(h.engine.transition(id, { to: 'ESCALATED', actor: USERS.lead, reason: 'Info limit reached' }).ok).toBe(true);
    expect(h.engine.getClaim(id).state).toBe('ESCALATED');
    expect(h.logs.at(-1)).toContain('Claim escalated to team lead');

    expect(h.engine.transition(id, { to: 'UNDER_ASSESSMENT', actor: USERS.lead, reason: 'Back to assessment' }).ok).toBe(true);
    expect(h.engine.getAudit(id).at(-1)).toMatchObject({ fromState: 'ESCALATED', toState: 'UNDER_ASSESSMENT' });
  });

  it('the original workflow still refuses the new move', () => {
    const h = createHarness();
    const id = driveTo(h, 'UNDER_ASSESSMENT');
    expect(h.engine.transition(id, { to: 'ESCALATED', actor: USERS.lead, reason: 'x' })).toMatchObject({
      ok: false,
      code: 'UNKNOWN_STATE',
    });
  });
});
