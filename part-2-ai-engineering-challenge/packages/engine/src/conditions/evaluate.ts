import type { ClaimData } from '../domain/claim-data';
import type { Condition } from '../config/schema';

export interface ConditionResult {
  ok: boolean;
  /** What the condition requires; shown to the caller when it is not met. */
  message: string;
}

/**
 * Fail-closed: a missing or wrongly-typed value never satisfies a condition.
 * `isPast` is strict (now must be after the instant) so a deadline is not
 * considered expired during its final moment.
 */
export function evaluateCondition(c: Condition, data: ClaimData, now: Date): ConditionResult {
  const get = (field: string): unknown => (data as Record<string, unknown>)[field];
  const result = (ok: boolean, fallback: string): ConditionResult => ({
    ok,
    message: c.message ?? fallback,
  });

  switch (c.type) {
    case 'exists': {
      const v = get(c.field);
      return result(v !== undefined && v !== null, `${c.field} is required`);
    }
    case 'nonEmpty': {
      const v = get(c.field);
      const ok = typeof v === 'string' ? v.trim().length > 0 : Array.isArray(v) && v.length > 0;
      return result(ok, `${c.field} must not be empty`);
    }
    case 'isTrue':
      return result(get(c.field) === true, `${c.field} must be true`);
    case 'isPast': {
      const v = get(c.field);
      const at = typeof v === 'string' ? Date.parse(v) : NaN;
      return result(!Number.isNaN(at) && now.getTime() > at, `${c.field} must be in the past`);
    }
    case 'isFuture': {
      const v = get(c.field);
      const at = typeof v === 'string' ? Date.parse(v) : NaN;
      return result(!Number.isNaN(at) && at > now.getTime(), `${c.field} must be in the future`);
    }
    case 'includesAll': {
      const v = get(c.field);
      const ok = Array.isArray(v) && c.values.every((x) => v.includes(x));
      return result(ok, `${c.field} must include: ${c.values.join(', ')}`);
    }
    case 'lte': {
      const a = get(c.field);
      const b = get(c.otherField);
      const ok =
        typeof a === 'number' && typeof b === 'number' && Number.isSafeInteger(a) && Number.isSafeInteger(b) && a <= b;
      return result(ok, `${c.field} must be <= ${c.otherField}`);
    }
    case 'any': {
      const inner = c.conditions.map((x) => evaluateCondition(x, data, now));
      return result(
        inner.some((r) => r.ok),
        `At least one of: ${inner.map((r) => r.message).join('; ')}`,
      );
    }
    case 'all': {
      const inner = c.conditions.map((x) => evaluateCondition(x, data, now));
      return result(
        inner.every((r) => r.ok),
        inner
          .filter((r) => !r.ok)
          .map((r) => r.message)
          .join('; '),
      );
    }
  }
}

export interface PreconditionReport {
  ok: boolean;
  results: ConditionResult[];
  failures: string[];
}

export function checkPreconditions(
  conditions: readonly Condition[],
  data: ClaimData,
  now: Date,
): PreconditionReport {
  const results = conditions.map((c) => evaluateCondition(c, data, now));
  return {
    ok: results.every((r) => r.ok),
    results,
    failures: results.filter((r) => !r.ok).map((r) => r.message),
  };
}
