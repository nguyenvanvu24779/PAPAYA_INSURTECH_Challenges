import { useState } from 'react';
import { formatMoney, localInputToUtcIso, moneyInputValue, parseMoney, utcIsoToLocalInput, formatTime } from '../format';
import type { Claim, FieldKind, Workflow } from '../types';
import { btnPrimary, card, input, label } from '../ui';

interface Props {
  workflow: Workflow;
  fields: Record<string, FieldKind>;
  claim: Claim;
  role: string;
  onSave: (patch: Record<string, unknown>, reason: string) => Promise<void>;
}

function display(kind: FieldKind, value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (kind === 'integer' && typeof value === 'number') return formatMoney(value);
  if (kind === 'datetime' && typeof value === 'string') return formatTime(value);
  if (kind === 'stringArray' && Array.isArray(value)) return value.join(', ');
  return String(value);
}

function toDraft(kind: FieldKind, value: unknown): string {
  if (value === undefined || value === null) return '';
  if (kind === 'integer' && typeof value === 'number') return moneyInputValue(value);
  if (kind === 'datetime' && typeof value === 'string') return utcIsoToLocalInput(value);
  if (kind === 'stringArray' && Array.isArray(value)) return value.join(', ');
  return String(value);
}

type Parsed = { ok: true; value: unknown } | { ok: false; message: string };

function parseDraft(kind: FieldKind, text: string): Parsed {
  switch (kind) {
    case 'string':
      return { ok: true, value: text.trim() };
    case 'boolean':
      return { ok: true, value: text === 'true' };
    case 'integer': {
      const minor = parseMoney(text);
      return minor === null ? { ok: false, message: 'Enter an amount like 5000.00' } : { ok: true, value: minor };
    }
    case 'datetime': {
      const iso = localInputToUtcIso(text);
      return iso === null ? { ok: false, message: 'Enter a valid date and time (UTC)' } : { ok: true, value: iso };
    }
    case 'stringArray':
      return { ok: true, value: text.split(',').map((s) => s.trim()).filter(Boolean) };
  }
}

export function DataPanel({ workflow, fields, claim, role, onSave }: Props) {
  const names = Object.keys(fields);
  const editable = names.filter((n) => {
    const rule = workflow.dataAccess[n];
    return rule !== undefined && rule.roles.includes(role) && rule.states.includes(claim.state);
  });
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(editable.map((n) => [n, toDraft(fields[n]!, claim.data[n])])),
  );
  const [reason, setReason] = useState('Update claim data');
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const patch: Record<string, unknown> = {};
    const nextErrors: Record<string, string> = {};
    for (const name of editable) {
      const text = draft[name] ?? '';
      const kind = fields[name]!;
      const untouched = text === toDraft(kind, claim.data[name]);
      if (untouched || (text === '' && kind !== 'boolean')) continue;
      const parsed = parseDraft(kind, text);
      if (parsed.ok) patch[name] = parsed.value;
      else nextErrors[name] = parsed.message;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    if (Object.keys(patch).length === 0) {
      setErrors({ _form: 'Nothing changed.' });
      return;
    }
    await onSave(patch, reason);
  }

  return (
    <section className={`${card} p-4`} aria-labelledby="data-heading">
      <h2 id="data-heading" className="text-sm font-semibold">
        Claim data
      </h2>

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        {names.map((n) => (
          <div key={n} className="flex justify-between gap-3 border-b border-slate-100 py-1 dark:border-slate-800">
            <dt className="text-slate-500">{n}</dt>
            <dd className="text-right font-medium" data-field={n}>
              {display(fields[n]!, claim.data[n])}
            </dd>
          </div>
        ))}
      </dl>

      <form onSubmit={save} className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-800">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Editable by {role} while {claim.state}
        </h3>
        {editable.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            This role cannot edit any field in this state. (Rules come from <code>dataAccess</code> in the workflow config.)
          </p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {editable.map((n) => {
              const kind = fields[n]!;
              const id = `field-${n}`;
              return (
                <div key={n}>
                  <label className={label} htmlFor={id}>
                    {n}
                    {kind === 'datetime' ? ' (UTC)' : kind === 'stringArray' ? ' (comma separated)' : kind === 'integer' ? ' (amount)' : ''}
                  </label>
                  {kind === 'boolean' ? (
                    <select id={id} className={input} value={draft[n] ?? ''} onChange={(e) => setDraft({ ...draft, [n]: e.target.value })}>
                      <option value="">— not set —</option>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : (
                    <input
                      id={id}
                      className={input}
                      type={kind === 'datetime' ? 'datetime-local' : 'text'}
                      inputMode={kind === 'integer' ? 'decimal' : undefined}
                      value={draft[n] ?? ''}
                      onChange={(e) => setDraft({ ...draft, [n]: e.target.value })}
                    />
                  )}
                  {errors[n] && <p className="mt-1 text-xs text-red-600">{errors[n]}</p>}
                </div>
              );
            })}
            <div className="sm:col-span-2">
              <label className={label} htmlFor="data-reason">
                Reason / note (required, recorded in the audit trail)
              </label>
              <input id="data-reason" className={input} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            {errors._form && <p className="text-xs text-red-600 sm:col-span-2">{errors._form}</p>}
            <div className="sm:col-span-2">
              <button type="submit" className={btnPrimary}>
                Save changes
              </button>
            </div>
          </div>
        )}
      </form>
    </section>
  );
}
