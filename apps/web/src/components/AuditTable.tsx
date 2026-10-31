import { formatTime } from '../format';
import type { AuditEntry } from '../types';
import { card } from '../ui';

function show(v: unknown): string {
  return v === null || v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v);
}

export function AuditTable({ entries }: { entries: AuditEntry[] }) {
  const newestFirst = [...entries].reverse();
  return (
    <section className={`${card} p-4`} aria-labelledby="audit-heading">
      <div className="flex items-baseline justify-between">
        <h2 id="audit-heading" className="text-sm font-semibold">
          Audit trail
        </h2>
        <p className="text-xs text-slate-500">Append-only and hash-chained · newest first · {entries.length} entries</p>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm" data-testid="audit-table">
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 pr-3">#</th>
              <th className="py-2 pr-3">Time</th>
              <th className="py-2 pr-3">Result</th>
              <th className="py-2 pr-3">Action</th>
              <th className="py-2 pr-3">From → To</th>
              <th className="py-2 pr-3">By</th>
              <th className="py-2">Reason and details</th>
            </tr>
          </thead>
          <tbody>
            {newestFirst.map((e) => (
              <tr key={e.id} data-outcome={e.outcome} className="border-t border-slate-100 align-top dark:border-slate-800">
                <td className="py-2 pr-3 tabular-nums">{e.seq}</td>
                <td className="whitespace-nowrap py-2 pr-3 text-xs">{formatTime(e.timestamp)}</td>
                <td className="py-2 pr-3">
                  <span
                    className={`inline-flex rounded px-1.5 py-0.5 text-xs font-semibold ${
                      e.outcome === 'APPLIED'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                    }`}
                  >
                    {e.outcome === 'APPLIED' ? '✓ APPLIED' : '✗ DENIED'}
                  </span>
                </td>
                <td className="py-2 pr-3 text-xs">{e.kind}</td>
                <td className="whitespace-nowrap py-2 pr-3 text-xs">
                  {e.fromState ?? '(new)'} → {e.toState}
                </td>
                <td className="whitespace-nowrap py-2 pr-3 text-xs">
                  {e.triggeredBy.userId}
                  <br />
                  <span className="text-slate-500">{e.triggeredBy.role}</span>
                </td>
                <td className="py-2 text-xs">
                  <p>{e.reason || <em className="text-slate-500">no reason given</em>}</p>
                  {e.errorCode && (
                    <p className="mt-1 text-red-700 dark:text-red-400">
                      <b>{e.errorCode}</b>: {e.errorMessage}
                    </p>
                  )}
                  {e.dataChanges.length > 0 && (
                    <ul className="mt-1 text-slate-500">
                      {e.dataChanges.map((c) => (
                        <li key={c.field}>
                          {c.field}: {show(c.before)} → {show(c.after)}
                        </li>
                      ))}
                    </ul>
                  )}
                  {e.effects.map((f, i) => (
                    <p key={i} className={f.status === 'FAILED' ? 'mt-1 text-red-700' : 'mt-1 text-slate-500'}>
                      effect {f.type}: {f.status}
                      {f.status === 'FAILED' ? ` (${f.detail})` : ''}
                    </p>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
