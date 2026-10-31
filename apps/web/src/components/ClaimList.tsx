import { useState } from 'react';
import { formatMoney, parseMoney } from '../format';
import type { Claim } from '../types';
import { badge, btnPrimary, btnSecondary, card, input, label } from '../ui';

interface Props {
  claims: Claim[];
  selectedId: string | null;
  role: string;
  intakeRoles: string[];
  onSelect: (id: string) => void;
  onCreate: (data: Record<string, unknown>) => Promise<void>;
}

export function ClaimList({ claims, selectedId, role, intakeRoles, onSelect, onCreate }: Props) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('5000.00');
  const [limit, setLimit] = useState('10000.00');
  const [error, setError] = useState<string | null>(null);
  const allowed = intakeRoles.includes(role);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const claimAmount = parseMoney(amount);
    const coverageLimit = parseMoney(limit);
    if (claimAmount === null || coverageLimit === null) {
      setError('Enter amounts like 5000.00 (up to 2 decimals).');
      return;
    }
    setError(null);
    await onCreate({ claimAmount, coverageLimit });
    setOpen(false);
  }

  return (
    <section className={`${card} p-4`} aria-labelledby="claims-heading">
      <div className="flex items-center justify-between">
        <h2 id="claims-heading" className="text-sm font-semibold">
          Claims
        </h2>
        <button type="button" className={btnSecondary} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          New claim
        </button>
      </div>

      {open && (
        <form onSubmit={submit} className="mt-3 space-y-2 rounded-md bg-slate-50 p-3 dark:bg-slate-800/50">
          {!allowed && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Role <b>{role}</b> cannot submit claims — the server will refuse. Allowed: {intakeRoles.join(', ')}.
            </p>
          )}
          <div>
            <label className={label} htmlFor="new-amount">
              Claim amount
            </label>
            <input id="new-amount" className={input} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
          </div>
          <div>
            <label className={label} htmlFor="new-limit">
              Coverage limit
            </label>
            <input id="new-limit" className={input} value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button type="submit" className={btnPrimary}>
            Submit claim
          </button>
        </form>
      )}

      {claims.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No claims yet. Submit one to begin.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {[...claims].reverse().map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                aria-current={c.id === selectedId ? 'true' : undefined}
                className={`w-full rounded-md border px-3 py-2 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  c.id === selectedId
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950'
                    : 'border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800'
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">{c.id}</span>
                  <span className={badge}>{c.state}</span>
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {typeof c.data.claimAmount === 'number' ? formatMoney(c.data.claimAmount) : 'no amount'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
