import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ConfigError, loadWorkflowFile, parseWorkflowObject, parseWorkflowYaml } from '../src';

const CONFIG_PATH = fileURLToPath(new URL('../../../config/claim-workflow.yaml', import.meta.url));

/** Fresh mutable copy of the raw config for building invalid variants. */
function rawConfig(): any {
  return parse(readFileSync(CONFIG_PATH, 'utf8'));
}

function problemsOf(raw: unknown): string[] {
  try {
    parseWorkflowObject(raw);
  } catch (err) {
    if (err instanceof ConfigError) return err.problems;
    throw err;
  }
  return [];
}

describe('claim-workflow.yaml', () => {
  const config = loadWorkflowFile(CONFIG_PATH);

  it('declares the 8 states and 9 transitions of the brief', () => {
    expect(Object.keys(config.states).sort()).toEqual(
      [
        'APPROVED',
        'CLOSED',
        'DOCUMENTS_VERIFIED',
        'PAYMENT_INITIATED',
        'PENDING_INFO',
        'REJECTED',
        'SUBMITTED',
        'UNDER_ASSESSMENT',
      ].sort(),
    );
    expect(config.transitions).toHaveLength(9);
  });

  it('matches the roles of every row in the brief', () => {
    const rolesByPair = Object.fromEntries(config.transitions.map((t) => [`${t.from}->${t.to}`, t.roles]));
    expect(rolesByPair).toEqual({
      'SUBMITTED->DOCUMENTS_VERIFIED': ['document_clerk'],
      'DOCUMENTS_VERIFIED->UNDER_ASSESSMENT': ['team_lead'],
      'UNDER_ASSESSMENT->APPROVED': ['assessor'],
      'UNDER_ASSESSMENT->REJECTED': ['assessor'],
      'UNDER_ASSESSMENT->PENDING_INFO': ['assessor'],
      'PENDING_INFO->DOCUMENTS_VERIFIED': ['document_clerk'],
      'APPROVED->PAYMENT_INITIATED': ['finance'],
      'PAYMENT_INITIATED->CLOSED': ['finance'],
      'REJECTED->CLOSED': ['system'],
    });
  });

  it('limits information requests to 3 with the mandated message', () => {
    const t = config.transitions.find((x) => x.from === 'UNDER_ASSESSMENT' && x.to === 'PENDING_INFO');
    expect(t?.maxCount).toBe(3);
    expect(t?.limitMessage).toBe('Maximum information requests exceeded — escalate to team lead');
  });
});

describe('config validation', () => {
  it('rejects a transition to an unknown state', () => {
    const raw = rawConfig();
    raw.transitions[0].to = 'NOWHERE';
    expect(problemsOf(raw).join('\n')).toContain('unknown to state NOWHERE');
  });

  it('rejects a role that is not declared', () => {
    const raw = rawConfig();
    raw.transitions[0].roles = ['intern'];
    expect(problemsOf(raw).join('\n')).toContain('role intern is not declared');
  });

  it('rejects a duplicate from->to transition', () => {
    const raw = rawConfig();
    raw.transitions.push({ ...raw.transitions[0], id: 'verify_documents_again' });
    expect(problemsOf(raw).join('\n')).toContain('duplicate transition SUBMITTED->DOCUMENTS_VERIFIED');
  });

  it('rejects a precondition on an unknown claim field', () => {
    const raw = rawConfig();
    raw.transitions[1].preconditions = [{ type: 'nonEmpty', field: 'favouriteColour' }];
    expect(problemsOf(raw).join('\n')).toContain('unknown claim field favouriteColour');
  });

  it('rejects a precondition applied to a field of the wrong kind', () => {
    const raw = rawConfig();
    raw.transitions[2].preconditions = [{ type: 'lte', field: 'assessorId', otherField: 'coverageLimit' }];
    expect(problemsOf(raw).join('\n')).toContain('field assessorId is string, expected integer');
  });

  it('rejects an unknown precondition type', () => {
    const raw = rawConfig();
    raw.transitions[0].preconditions = [{ type: 'eval', code: 'true' }];
    expect(problemsOf(raw).length).toBeGreaterThan(0);
  });

  it('rejects maxCount without limitMessage', () => {
    const raw = rawConfig();
    delete raw.transitions.find((t: any) => t.id === 'request_info').limitMessage;
    expect(problemsOf(raw).join('\n')).toContain('maxCount and limitMessage must be set together');
  });

  it('rejects a transition that leaves a terminal state', () => {
    const raw = rawConfig();
    raw.transitions.push({ id: 'reopen', from: 'CLOSED', to: 'SUBMITTED', roles: ['team_lead'] });
    expect(problemsOf(raw).join('\n')).toContain('leaves terminal state CLOSED');
  });

  it('rejects a state that cannot be reached from the initial state', () => {
    const raw = rawConfig();
    raw.states.ORPHAN = { description: 'nobody gets here' };
    raw.transitions.push({ id: 'orphan_exit', from: 'ORPHAN', to: 'CLOSED', roles: ['team_lead'] });
    expect(problemsOf(raw).join('\n')).toContain('state ORPHAN: unreachable');
  });

  it('rejects a non-terminal state with no way out', () => {
    const raw = rawConfig();
    raw.states.DEAD_END = { description: 'trap' };
    raw.transitions.push({ id: 'into_trap', from: 'SUBMITTED', to: 'DEAD_END', roles: ['team_lead'] });
    expect(problemsOf(raw).join('\n')).toContain('state DEAD_END: not terminal but has no outgoing');
  });

  it('rejects unknown keys instead of ignoring them', () => {
    const raw = rawConfig();
    raw.transitions[0].rolez = ['document_clerk'];
    expect(problemsOf(raw).length).toBeGreaterThan(0);
  });

  it('reports every problem in one pass', () => {
    const raw = rawConfig();
    raw.transitions[0].to = 'NOWHERE';
    raw.transitions[1].roles = ['intern'];
    expect(problemsOf(raw).length).toBeGreaterThanOrEqual(2);
  });

  it('reports malformed YAML as a ConfigError', () => {
    expect(() => parseWorkflowYaml('version: [unclosed')).toThrow(ConfigError);
  });
});

describe('config validation: access rules and messages', () => {
  it('rejects an intake role that is not declared', () => {
    const raw = rawConfig();
    raw.intake.roles = ['intern'];
    expect(problemsOf(raw).join('\n')).toContain('intake: role intern is not declared');
  });

  it('rejects a dataAccess rule for an unknown field, role or state', () => {
    const raw = rawConfig();
    raw.dataAccess.favouriteColour = { roles: ['assessor'], states: ['SUBMITTED'] };
    raw.dataAccess.claimAmount = { roles: ['intern'], states: ['NOWHERE'] };
    const text = problemsOf(raw).join('\n');
    expect(text).toContain('unknown claim field favouriteColour');
    expect(text).toContain('role intern is not declared');
    expect(text).toContain('unknown state NOWHERE');
  });

  it('rejects a notify placeholder that is not a claim field', () => {
    const raw = rawConfig();
    raw.transitions[0].effects[0].message = 'Hello {nobody}';
    expect(problemsOf(raw).join('\n')).toContain('unknown claim field nobody');
  });
});
