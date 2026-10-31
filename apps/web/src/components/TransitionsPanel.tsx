import { useState } from 'react';
import type { AvailableTransition } from '../types';
import { badge, btnPrimary, card, input, label } from '../ui';

interface Props {
  transitions: AvailableTransition[];
  state: string;
  role: string;
  onPerform: (to: string, reason: string) => Promise<void>;
}

export function TransitionsPanel({ transitions, state, role, onPerform }: Props) {
  const [reason, setReason] = useState('');

  return (
    <section className={`${card} p-4`} aria-labelledby="transitions-heading">
      <h2 id="transitions-heading" className="text-sm font-semibold">
        Available transitions from {state}
      </h2>

      {transitions.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">This is a final state. No further transitions are possible.</p>
      ) : (
        <>
          <div className="mt-3">
            <label className={label} htmlFor="transition-reason">
              Reason / note (required, recorded in the audit trail)
            </label>
            <input
              id="transition-reason"
              className={input}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. All documents checked against the policy"
            />
          </div>

          <ul className="mt-4 space-y-3">
            {transitions.map((t) => {
              const roleOk = t.roles.includes(role);
              const ready = t.preconditions.every((p) => p.satisfied);
              const exhausted = t.limit !== null && t.limit.used >= t.limit.max;
              return (
                <li key={t.id} data-transition={t.to} className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">→ {t.to}</p>
                      {t.description && <p className="text-xs text-slate-500">{t.description}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="text-slate-500">Requires role:</span>
                      {t.roles.map((r) => (
                        <span key={r} className={`${badge} ${r === role ? '!bg-emerald-100 !text-emerald-800' : ''}`}>
                          {r}
                        </span>
                      ))}
                    </div>
                  </div>

                  <ul className="mt-2 space-y-1 text-sm" aria-label={`Preconditions for ${t.to}`}>
                    {t.preconditions.length === 0 && <li className="text-slate-500">No preconditions.</li>}
                    {t.preconditions.map((p) => (
                      <li key={p.message} className={p.satisfied ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}>
                        <span aria-hidden="true">{p.satisfied ? '✓' : '✗'}</span> {p.satisfied ? 'Met' : 'Not met'}: {p.message}
                      </li>
                    ))}
                  </ul>

                  {t.limit && (
                    <p className={`mt-2 text-xs ${exhausted ? 'font-medium text-red-700' : 'text-slate-500'}`}>
                      Used {t.limit.used} of {t.limit.max} allowed.{exhausted && ` ${t.limit.message}`}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button type="button" className={btnPrimary} onClick={() => onPerform(t.to, reason)}>
                      Move to {t.to}
                    </button>
                    {!roleOk && (
                      <span className="text-xs text-amber-700 dark:text-amber-400">
                        You are acting as <b>{role}</b>; the server will refuse this.
                      </span>
                    )}
                    {roleOk && !ready && (
                      <span className="text-xs text-amber-700 dark:text-amber-400">Preconditions are not met yet; the server will refuse this.</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
