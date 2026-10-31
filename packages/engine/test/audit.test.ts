import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileAuditLog, InMemoryAuditLog, JsonFileClaimRepository, verifyChain, type AuditDraft } from '../src';
import { createHarness } from '../scenarios/harness';
import { USERS, driveTo, steps, type Step } from '../scenarios/scenarios';

type TransitionStep = Extract<Step, { kind: 'transition' }>;

const draft = (claimId: string, n = 1): AuditDraft => ({
  timestamp: '2026-11-01T09:00:00.000Z',
  kind: 'TRANSITION',
  claimId,
  fromState: 'A',
  toState: 'B',
  triggeredBy: { userId: 'u', role: 'r' },
  reason: `reason ${n}`,
  outcome: 'APPLIED',
  errorCode: null,
  errorMessage: null,
  dataChanges: [],
  effects: [],
});

describe('audit entries', () => {
  it('record time, from, to, who (id + role) and reason for an applied transition', () => {
    const h = createHarness();
    const id = driveTo(h, 'DOCUMENTS_VERIFIED');
    const entry = h.engine.getAudit(id).at(-1)!;
    expect(entry).toMatchObject({
      kind: 'TRANSITION',
      claimId: id,
      timestamp: '2026-11-01T09:00:00.000Z',
      fromState: 'SUBMITTED',
      toState: 'DOCUMENTS_VERIFIED',
      triggeredBy: { userId: 'clerk-01', role: 'document_clerk' },
      reason: 'All required documents present',
      outcome: 'APPLIED',
      errorCode: null,
    });
    expect(entry.dataChanges).toEqual([
      { field: 'documents', before: null, after: ['claim_form', 'identity_document', 'supporting_evidence'] },
    ]);
    expect(entry.effects).toEqual([expect.objectContaining({ type: 'notify', status: 'OK' })]);
  });

  it('also record refused attempts, with the code and message', () => {
    const h = createHarness();
    const id = driveTo(h, 'SUBMITTED');
    h.engine.transition(id, { to: 'APPROVED', actor: USERS.assessor, reason: 'skip' });
    const entry = h.engine.getAudit(id).at(-1)!;
    expect(entry).toMatchObject({
      outcome: 'DENIED',
      errorCode: 'TRANSITION_NOT_DEFINED',
      fromState: 'SUBMITTED',
      toState: 'APPROVED',
      triggeredBy: { userId: 'assessor-01', role: 'assessor' },
    });
    expect(entry.errorMessage).toContain('Allowed from SUBMITTED');
  });

  it('record manual data changes with before and after values', () => {
    const h = createHarness();
    const id = driveTo(h, 'UNDER_ASSESSMENT');
    h.engine.updateClaimData(id, { actor: USERS.assessor, reason: 'Corrected amount', data: { claimAmount: 450_000 } });
    expect(h.engine.getAudit(id).at(-1)).toMatchObject({
      kind: 'DATA_UPDATE',
      outcome: 'APPLIED',
      dataChanges: [{ field: 'claimAmount', before: 500_000, after: 450_000 }],
    });
  });

  it('are returned per claim only, in order', () => {
    const h = createHarness();
    const a = driveTo(h, 'DOCUMENTS_VERIFIED');
    const b = driveTo(h, 'SUBMITTED');
    expect(h.engine.getAudit(a).every((e) => e.claimId === a)).toBe(true);
    expect(h.engine.getAudit(b)).toHaveLength(1);
    const seqs = h.engine.getAudit(a).map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
  });
});

describe('audit immutability', () => {
  it('stored entries cannot be modified', () => {
    const h = createHarness();
    const id = driveTo(h, 'SUBMITTED');
    const entry = h.engine.getAudit(id)[0] as any;
    expect(() => {
      entry.reason = 'tampered';
    }).toThrow(TypeError);
    expect(() => {
      entry.triggeredBy.role = 'admin';
    }).toThrow(TypeError);
    expect(entry.reason).toBe('Claim submitted');
  });

  it('exposes no update or delete operation, and the returned list is a copy', () => {
    const h = createHarness();
    const id = driveTo(h, 'SUBMITTED');
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(h.audit)).filter((n) => /update|delete|remove|clear|set/i.test(n))).toEqual([]);
    const list = h.engine.getAudit(id) as any[];
    list.length = 0;
    expect(h.engine.getAudit(id)).toHaveLength(1);
  });

  it('detects an edited, removed or reordered entry', () => {
    const log = new InMemoryAuditLog();
    for (let i = 1; i <= 4; i++) log.append(draft('C1', i));
    const entries = log.all().map((e) => structuredClone(e)) as any[];
    expect(verifyChain(entries)).toEqual({ ok: true });

    const edited = structuredClone(entries);
    edited[1].reason = 'tampered';
    expect(verifyChain(edited)).toEqual({ ok: false, brokenAt: 2 });

    expect(verifyChain([entries[0], entries[2], entries[3]])).toMatchObject({ ok: false });
    expect(verifyChain([entries[1], entries[0], entries[2]])).toMatchObject({ ok: false });
  });
});

describe('file persistence', () => {
  const tempFile = (name: string) => join(mkdtempSync(join(tmpdir(), 'claims-')), name);

  it('survives a restart with the full history and the chain intact', () => {
    const path = tempFile('audit.jsonl');
    const first = new FileAuditLog(path);
    first.append(draft('C1', 1));
    first.append(draft('C1', 2));
    const reopened = new FileAuditLog(path);
    expect(reopened.query('C1').map((e) => e.reason)).toEqual(['reason 1', 'reason 2']);
    reopened.append(draft('C1', 3));
    expect(new FileAuditLog(path).verifyIntegrity()).toEqual({ ok: true });
  });

  it('refuses to start on a file whose history was edited', () => {
    const path = tempFile('audit.jsonl');
    const log = new FileAuditLog(path);
    log.append(draft('C1', 1));
    log.append(draft('C1', 2));
    writeFileSync(path, readFileSync(path, 'utf8').replace('reason 1', 'reason X'));
    expect(() => new FileAuditLog(path)).toThrow(/integrity check/);
  });

  it('refuses to start on a file with a deleted entry', () => {
    const path = tempFile('audit.jsonl');
    const log = new FileAuditLog(path);
    for (let i = 1; i <= 3; i++) log.append(draft('C1', i));
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    writeFileSync(path, [lines[0], lines[2]].join('\n') + '\n');
    expect(() => new FileAuditLog(path)).toThrow(/integrity check/);
  });

  it('refuses to start on a file with a forged appended entry', () => {
    const path = tempFile('audit.jsonl');
    const log = new FileAuditLog(path);
    log.append(draft('C1', 1));
    appendFileSync(path, JSON.stringify({ ...log.all()[0], seq: 2, id: 'AUD-000002', reason: 'forged' }) + '\n');
    expect(() => new FileAuditLog(path)).toThrow(/integrity check/);
  });

  it('keeps claims across a restart too', () => {
    const path = tempFile('claims.json');
    const repo = new JsonFileClaimRepository(path);
    const h = createHarness();
    const id = driveTo(h, 'UNDER_ASSESSMENT');
    repo.insert(h.engine.getClaim(id));
    expect(new JsonFileClaimRepository(path).get(id)?.state).toBe('UNDER_ASSESSMENT');
  });
});

describe('atomicity', () => {
  it('leaves the claim untouched and fires no effects if the audit write fails', () => {
    const h = createHarness();
    const id = driveTo(h, 'UNDER_ASSESSMENT');
    const before = h.engine.getClaim(id);
    h.logs.length = 0;
    const realAppend = h.audit.append.bind(h.audit);
    h.audit.append = () => {
      throw new Error('disk full');
    };
    const s = steps.approve() as TransitionStep;
    expect(() => h.engine.transition(id, { to: s.to, actor: s.actor, reason: s.reason, data: s.data })).toThrow('disk full');
    h.audit.append = realAppend;
    expect(h.engine.getClaim(id)).toEqual(before);
    expect(h.logs).toEqual([]);
    expect(h.engine.getAudit(id).filter((e) => e.toState === 'APPROVED')).toHaveLength(0);
  });

  it('a failed effect is recorded but does not undo the transition', async () => {
    const { parseWorkflowYaml } = await import('../src');
    const yaml = readFileSync(new URL('../../../config/claim-workflow.yaml', import.meta.url), 'utf8').replace(
      'message: Claim documents verified, ready for assessment',
      'message: "Assigned to {assessorId}"',
    );
    const h = createHarness({ config: parseWorkflowYaml(yaml) });
    const id = driveTo(h, 'DOCUMENTS_VERIFIED');
    expect(h.engine.getClaim(id).state).toBe('DOCUMENTS_VERIFIED');
    const effect = h.engine.getAudit(id).at(-1)!.effects[0]!;
    expect(effect).toMatchObject({ type: 'notify', status: 'FAILED' });
    expect(effect.detail).toContain('assessorId');
  });
});
