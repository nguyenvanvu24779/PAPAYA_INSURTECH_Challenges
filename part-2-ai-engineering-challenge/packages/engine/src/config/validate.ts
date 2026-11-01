import { claimFieldKind, type FieldKind } from '../domain/claim-data';
import type { Condition, WorkflowConfig } from './schema';

/**
 * Cross-checks that the shape schema cannot express: references between
 * states, roles and claim fields, plus reachability. Returns every problem
 * found so a bad config is fixed in one pass.
 */
export function validateWorkflow(config: WorkflowConfig): string[] {
  const problems: string[] = [];
  const states = new Set(Object.keys(config.states));
  const roles = new Set(config.roles);

  if (roles.size !== config.roles.length) problems.push('roles: duplicate role ids');
  if (!states.has(config.initialState)) {
    problems.push(`initialState: unknown state ${config.initialState}`);
  }

  for (const role of config.intake.roles) {
    if (!roles.has(role)) problems.push(`intake: role ${role} is not declared in roles`);
  }
  for (const [field, rule] of Object.entries(config.dataAccess)) {
    const at = `dataAccess ${field}`;
    expectKind(field, null, at, problems);
    for (const role of rule.roles) {
      if (!roles.has(role)) problems.push(`${at}: role ${role} is not declared in roles`);
    }
    for (const state of rule.states) {
      if (!states.has(state)) problems.push(`${at}: unknown state ${state}`);
    }
  }

  const seenIds = new Set<string>();
  const seenPairs = new Set<string>();
  const outgoing = new Map<string, string[]>();

  for (const t of config.transitions) {
    const where = `transition ${t.id}`;

    if (seenIds.has(t.id)) problems.push(`${where}: duplicate transition id`);
    seenIds.add(t.id);

    const pair = `${t.from}->${t.to}`;
    if (seenPairs.has(pair)) problems.push(`${where}: duplicate transition ${pair}`);
    seenPairs.add(pair);

    if (!states.has(t.from)) problems.push(`${where}: unknown from state ${t.from}`);
    if (!states.has(t.to)) problems.push(`${where}: unknown to state ${t.to}`);
    if (config.states[t.from]?.terminal) {
      problems.push(`${where}: leaves terminal state ${t.from}`);
    }

    for (const role of t.roles) {
      if (!roles.has(role)) problems.push(`${where}: role ${role} is not declared in roles`);
    }
    if (new Set(t.roles).size !== t.roles.length) problems.push(`${where}: duplicate roles`);

    if ((t.maxCount === undefined) !== (t.limitMessage === undefined)) {
      problems.push(`${where}: maxCount and limitMessage must be set together`);
    }

    for (const c of t.preconditions) checkCondition(c, where, problems);
    for (const e of t.effects) {
      if (e.type === 'stampTime') expectKind(e.field, ['datetime'], `${where} effect stampTime`, problems);
      if (e.type === 'notify') {
        for (const [, name] of e.message.matchAll(/\{(\w+)\}/g)) {
          expectKind(name!, null, `${where} effect notify placeholder`, problems);
        }
      }
      if (e.type === 'clearFields') {
        for (const f of e.fields) expectKind(f, null, `${where} effect clearFields`, problems);
      }
    }

    outgoing.set(t.from, [...(outgoing.get(t.from) ?? []), t.to]);
  }

  for (const [id, state] of Object.entries(config.states)) {
    if (!state.terminal && !outgoing.has(id)) {
      problems.push(`state ${id}: not terminal but has no outgoing transitions`);
    }
  }

  const reachable = new Set<string>();
  const queue = states.has(config.initialState) ? [config.initialState] : [];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    queue.push(...(outgoing.get(current) ?? []));
  }
  for (const id of states) {
    if (!reachable.has(id)) problems.push(`state ${id}: unreachable from ${config.initialState}`);
  }

  return problems;
}

function checkCondition(c: Condition, where: string, problems: string[]): void {
  const at = `${where} precondition ${c.type}`;
  switch (c.type) {
    case 'exists':
      expectKind(c.field, null, at, problems);
      break;
    case 'nonEmpty':
      expectKind(c.field, ['string', 'stringArray'], at, problems);
      break;
    case 'isTrue':
      expectKind(c.field, ['boolean'], at, problems);
      break;
    case 'isPast':
    case 'isFuture':
      expectKind(c.field, ['datetime'], at, problems);
      break;
    case 'includesAll':
      expectKind(c.field, ['stringArray'], at, problems);
      break;
    case 'lte':
      expectKind(c.field, ['integer'], at, problems);
      expectKind(c.otherField, ['integer'], at, problems);
      break;
    case 'any':
    case 'all':
      for (const inner of c.conditions) checkCondition(inner, where, problems);
      break;
  }
}

/** `allowed` null means any known claim field is acceptable. */
function expectKind(
  field: string,
  allowed: FieldKind[] | null,
  at: string,
  problems: string[],
): void {
  const kind = claimFieldKind(field);
  if (kind === undefined) {
    problems.push(`${at}: unknown claim field ${field}`);
  } else if (allowed !== null && !allowed.includes(kind)) {
    problems.push(`${at}: field ${field} is ${kind}, expected ${allowed.join(' or ')}`);
  }
}
