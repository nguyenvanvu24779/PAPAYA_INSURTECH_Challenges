import { claimFieldKind, type ClaimData, type ClaimField } from '../domain/claim-data';
import type { Effect } from '../config/schema';
import type { Actor } from '../domain/types';

export interface EffectContext {
  claimId: string;
  from: string;
  to: string;
  data: ClaimData;
  actor: Actor;
  now: Date;
}

/**
 * What an effect wants to do. Effects are planned without side effects: data
 * changes are folded into the transition's atomic commit, and `detail` (the
 * mock "external call", printed to the console) is emitted only after the
 * commit succeeded.
 */
export interface EffectOutcome {
  detail: string;
  set?: ClaimData;
  clear?: readonly ClaimField[];
}

function render(template: string, data: ClaimData): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = (data as Record<string, unknown>)[name];
    if (value === undefined || value === null) {
      throw new Error(`placeholder {${name}} has no value`);
    }
    return Array.isArray(value) ? value.join(', ') : String(value);
  });
}

export function planEffect(effect: Effect, ctx: EffectContext): EffectOutcome {
  const tag = `claim ${ctx.claimId}`;
  switch (effect.type) {
    case 'notify':
      return { detail: `[notify:${effect.target}] ${tag}: ${render(effect.message, ctx.data)}` };
    case 'stampTime': {
      const at = ctx.now.toISOString();
      return {
        detail: `[clock] ${tag}: ${effect.field} = ${at}`,
        set: { [effect.field]: at } as ClaimData,
      };
    }
    case 'clearFields': {
      for (const f of effect.fields) {
        if (claimFieldKind(f) === undefined) throw new Error(`unknown claim field ${f}`);
      }
      return {
        detail: `[data] ${tag}: cleared ${effect.fields.join(', ')}`,
        clear: effect.fields as ClaimField[],
      };
    }
    case 'createPaymentRequest': {
      const id = `PAY-REQ-${ctx.claimId}`;
      return {
        detail: `[payments] ${tag}: payment request ${id} created for amount ${ctx.data.claimAmount ?? 'n/a'}`,
        set: { paymentRequestId: id },
      };
    }
    case 'triggerPayment':
      return {
        detail: `[payments] ${tag}: payment system triggered for request ${ctx.data.paymentRequestId ?? 'n/a'}`,
      };
    case 'archiveClaim':
      return { detail: `[archive] ${tag}: claim archived` };
  }
}

export function applyOutcome(data: ClaimData, outcome: EffectOutcome): ClaimData {
  const next: Record<string, unknown> = { ...data, ...outcome.set };
  for (const field of outcome.clear ?? []) delete next[field];
  return next as ClaimData;
}
