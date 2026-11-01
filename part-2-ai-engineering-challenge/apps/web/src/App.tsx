import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type ApiResult } from './api';
import { AuditTable } from './components/AuditTable';
import { Banner, type BannerState } from './components/Banner';
import { ClaimList } from './components/ClaimList';
import { DataPanel } from './components/DataPanel';
import { Stepper } from './components/Stepper';
import { TransitionsPanel } from './components/TransitionsPanel';
import type { Actor, AuditEntry, AvailableTransition, Claim, FieldKind, Workflow } from './types';
import { btnSecondary, card, input, label } from './ui';

/** Demo identities. There is no login: the operator picks who they are acting as. */
const KNOWN_USERS: Record<string, string> = {
  document_clerk: 'clerk-01',
  team_lead: 'lead-01',
  assessor: 'assessor-01',
  finance: 'finance-01',
  system: 'system',
};

interface Detail {
  claim: Claim;
  transitions: AvailableTransition[];
  audit: AuditEntry[];
}

export function App() {
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [fields, setFields] = useState<Record<string, FieldKind>>({});
  const [claims, setClaims] = useState<Claim[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [role, setRole] = useState('document_clerk');
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const actor: Actor = useMemo(() => ({ userId: KNOWN_USERS[role] ?? `${role}-01`, role }), [role]);

  const loadDetail = useCallback(async (id: string) => {
    const [c, t, a] = await Promise.all([api.claim(id), api.transitions(id), api.audit(id)]);
    if (c.ok && t.ok && a.ok) setDetail({ claim: c.data.claim, transitions: t.data.transitions, audit: a.data.entries });
  }, []);

  const loadClaims = useCallback(async () => {
    const res = await api.claims();
    if (res.ok) setClaims(res.data.claims);
  }, []);

  useEffect(() => {
    void (async () => {
      const [w, c] = await Promise.all([api.workflow(), api.claims()]);
      if (!w.ok) return setLoadError(w.error.message);
      setWorkflow(w.data.workflow);
      setFields(w.data.fields);
      if (c.ok) setClaims(c.data.claims);
    })();
  }, []);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  const visited = useMemo(() => {
    const set = new Set<string>();
    for (const e of detail?.audit ?? []) if (e.outcome === 'APPLIED') set.add(e.toState);
    return set;
  }, [detail]);

  /** Runs a command, shows the outcome (including the server's specific refusal), refreshes the view. */
  async function run(title: string, call: Promise<ApiResult<{ claim: Claim }>>, id?: string) {
    const res = await call;
    if (res.ok) {
      setBanner({ kind: 'success', title: `${title} — applied`, message: `Claim ${res.data.claim.id} is now ${res.data.claim.state}.` });
      await loadClaims();
      setSelectedId(res.data.claim.id);
      await loadDetail(res.data.claim.id);
    } else {
      setBanner({ kind: 'error', title: `${title} — refused (${res.error.code})`, message: res.error.message, details: res.error.details });
      if (id) await loadDetail(id);
    }
  }

  if (loadError) {
    return (
      <main className="mx-auto max-w-xl p-8">
        <Banner banner={{ kind: 'error', title: 'Cannot load the workflow', message: loadError }} onDismiss={() => undefined} />
      </main>
    );
  }
  if (!workflow) return <main className="p-8 text-sm text-slate-500">Loading workflow…</main>;

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div>
            <h1 className="text-lg font-semibold">Claim Workflow Console</h1>
            <p className="text-xs text-slate-500">State machine defined in config · {Object.keys(workflow.states).length} states · {workflow.transitions.length} transitions</p>
          </div>
          <div className="flex items-end gap-3">
            <div>
              <label className={label} htmlFor="acting-role">
                Acting as (role)
              </label>
              <select id="acting-role" className={`${input} min-w-44`} value={role} onChange={(e) => setRole(e.target.value)}>
                {workflow.roles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <p className="pb-1.5 text-xs text-slate-500" data-testid="actor">
              user <b>{actor.userId}</b>
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[300px_1fr]">
        <aside>
          <ClaimList
            claims={claims}
            selectedId={selectedId}
            role={role}
            intakeRoles={workflow.intake.roles}
            onSelect={setSelectedId}
            onCreate={(data) => run('Submit claim', api.createClaim(actor, data, 'Claim submitted'))}
          />
          <p className="mt-3 text-xs text-slate-500">
            Demo only: there is no login. Switching the role above is how you play each part, and the server enforces what that role may do.
          </p>
        </aside>

        <div className="min-w-0 space-y-6">
          {/* Sticky so the outcome of an action is visible wherever on the page it was triggered. */}
          <div className="sticky top-3 z-10 empty:hidden">
            <Banner banner={banner} onDismiss={() => setBanner(null)} />
          </div>

          {!detail ? (
            <div className={`${card} p-8 text-center text-sm text-slate-500`}>Select a claim, or submit a new one, to begin.</div>
          ) : (
            <>
              <section className={`${card} p-4`} aria-labelledby="claim-heading">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 id="claim-heading" className="text-base font-semibold">
                    {detail.claim.id}
                  </h2>
                  <span className="text-xs text-slate-500" data-testid="current-state">
                    Current state: <b>{detail.claim.state}</b> · v{detail.claim.version}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{workflow.states[detail.claim.state]?.description}</p>
                <div className="mt-3">
                  <Stepper workflow={workflow} current={detail.claim.state} visited={visited} />
                </div>
              </section>

              <TransitionsPanel
                key={`transitions-${detail.claim.id}-${detail.claim.version}-${role}`}
                transitions={detail.transitions}
                state={detail.claim.state}
                role={role}
                onPerform={(to, reason) =>
                  run(`Move to ${to}`, api.transition(detail.claim.id, actor, to, reason), detail.claim.id)
                }
              />

              <DataPanel
                key={`data-${detail.claim.id}-${detail.claim.version}-${role}`}
                workflow={workflow}
                fields={fields}
                claim={detail.claim}
                role={role}
                onSave={(patch, reason) => run('Update data', api.updateData(detail.claim.id, actor, patch, reason), detail.claim.id)}
              />

              <AuditTable entries={detail.audit} />
              <button type="button" className={btnSecondary} onClick={() => selectedId && void loadDetail(selectedId)}>
                Refresh
              </button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
