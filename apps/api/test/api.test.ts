import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createHarness } from '../../../packages/engine/scenarios/harness';
import { REQUIRED_DOCS, USERS } from '../../../packages/engine/scenarios/scenarios';

function setup() {
  const h = createHarness();
  return { h, app: createApp(h.engine) };
}

async function newClaim(app: ReturnType<typeof setup>['app']) {
  const res = await request(app)
    .post('/api/claims')
    .send({ actor: USERS.clerk, data: { claimAmount: 500_000, coverageLimit: 1_000_000 } });
  return res.body.claim.id as string;
}

describe('workflow and claims', () => {
  it('serves the workflow definition from config', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/workflow');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.workflow.states)).toHaveLength(8);
    expect(res.body.workflow.transitions).toHaveLength(9);
    expect(res.body.fields.claimAmount).toBe('integer');
  });

  it('creates a claim in SUBMITTED for the intake role and audits it', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/claims').send({ actor: USERS.clerk, data: { claimAmount: 100 } });
    expect(res.status).toBe(201);
    expect(res.body.claim).toMatchObject({ id: 'CLM-0001', state: 'SUBMITTED' });
    const audit = await request(app).get('/api/claims/CLM-0001/audit');
    expect(audit.body.entries).toHaveLength(1);
    expect(audit.body.entries[0]).toMatchObject({ kind: 'CREATE', triggeredBy: { userId: 'clerk-01', role: 'document_clerk' } });
  });

  it('refuses claim creation by a role without intake rights (403)', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/claims').send({ actor: USERS.finance, data: {} });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ROLE_NOT_ALLOWED');
  });

  it('returns 404 for an unknown claim and an unknown route', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/claims/CLM-9999')).status).toBe(404);
    expect((await request(app).get('/api/nope')).status).toBe(404);
  });
});

describe('transitions over HTTP', () => {
  it('applies a valid transition and exposes the next steps with required roles', async () => {
    const { app } = setup();
    const id = await newClaim(app);
    const res = await request(app)
      .post(`/api/claims/${id}/transition`)
      .send({ to: 'DOCUMENTS_VERIFIED', actor: USERS.clerk, reason: 'Docs ok', data: { documents: REQUIRED_DOCS } });
    expect(res.status).toBe(200);
    expect(res.body.claim.state).toBe('DOCUMENTS_VERIFIED');

    const next = await request(app).get(`/api/claims/${id}/transitions`);
    expect(next.body.state).toBe('DOCUMENTS_VERIFIED');
    expect(next.body.transitions).toEqual([
      expect.objectContaining({ to: 'UNDER_ASSESSMENT', roles: ['team_lead'] }),
    ]);
  });

  it('answers an invalid transition with 409 and a specific message', async () => {
    const { app } = setup();
    const id = await newClaim(app);
    const res = await request(app)
      .post(`/api/claims/${id}/transition`)
      .send({ to: 'APPROVED', actor: USERS.assessor, reason: 'skip' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'TRANSITION_NOT_DEFINED',
      message: 'Cannot move claim from SUBMITTED to APPROVED: no such transition. Allowed from SUBMITTED: DOCUMENTS_VERIFIED',
    });
  });

  it('answers a wrong role with 403', async () => {
    const { app } = setup();
    const id = await newClaim(app);
    const res = await request(app)
      .post(`/api/claims/${id}/transition`)
      .send({ to: 'DOCUMENTS_VERIFIED', actor: USERS.finance, reason: 'x', data: { documents: REQUIRED_DOCS } });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ROLE_NOT_ALLOWED');
  });

  it('answers an unmet precondition with 409 and lists what is missing', async () => {
    const { app } = setup();
    const id = await newClaim(app);
    const res = await request(app)
      .post(`/api/claims/${id}/transition`)
      .send({ to: 'DOCUMENTS_VERIFIED', actor: USERS.clerk, reason: 'no docs' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRECONDITION_FAILED');
    expect(res.body.error.details[0]).toContain('All required documents must be present');
  });

  it('records refused attempts in the audit trail returned by the API', async () => {
    const { app } = setup();
    const id = await newClaim(app);
    await request(app).post(`/api/claims/${id}/transition`).send({ to: 'APPROVED', actor: USERS.assessor, reason: 'skip' });
    const audit = await request(app).get(`/api/claims/${id}/audit`);
    expect(audit.body.entries.at(-1)).toMatchObject({ outcome: 'DENIED', errorCode: 'TRANSITION_NOT_DEFINED' });
  });

  it('blocks the 4th information request with the mandated message', async () => {
    const { app } = setup();
    const id = await newClaim(app);
    const post = (to: string, actor: object, data?: object) =>
      request(app).post(`/api/claims/${id}/transition`).send({ to, actor, reason: 'step', data });
    await post('DOCUMENTS_VERIFIED', USERS.clerk, { documents: REQUIRED_DOCS });
    await post('UNDER_ASSESSMENT', USERS.lead, { assessorId: 'assessor-01' });
    for (let n = 1; n <= 3; n++) {
      expect((await post('PENDING_INFO', USERS.assessor, { missingInfoDescription: `need ${n}` })).status).toBe(200);
      expect((await post('DOCUMENTS_VERIFIED', USERS.clerk, { newInfoReceived: true })).status).toBe(200);
      expect((await post('UNDER_ASSESSMENT', USERS.lead)).status).toBe(200);
    }
    const fourth = await post('PENDING_INFO', USERS.assessor, { missingInfoDescription: 'need 4' });
    expect(fourth.status).toBe(409);
    expect(fourth.body.error.message).toBe('Maximum information requests exceeded — escalate to team lead');
  });

  it('refuses a manual edit of a system-managed field (403)', async () => {
    const { app } = setup();
    const id = await newClaim(app);
    const res = await request(app)
      .patch(`/api/claims/${id}/data`)
      .send({ actor: USERS.clerk, reason: 'fake', data: { paymentRequestId: 'PAY-REQ-FAKE' } });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('DATA_NOT_ALLOWED');
  });
});

describe('request validation and errors', () => {
  it('rejects a body without an actor (400)', async () => {
    const { app } = setup();
    const id = await newClaim(app);
    const res = await request(app).post(`/api/claims/${id}/transition`).send({ to: 'DOCUMENTS_VERIFIED' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  it('rejects unknown keys in the body instead of ignoring them', async () => {
    const { app } = setup();
    const id = await newClaim(app);
    const res = await request(app)
      .post(`/api/claims/${id}/transition`)
      .send({ to: 'DOCUMENTS_VERIFIED', actor: USERS.clerk, reason: 'x', skipChecks: true });
    expect(res.status).toBe(400);
  });

  it('rejects malformed JSON (400)', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/claims').set('Content-Type', 'application/json').send('{"actor":');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Malformed JSON body');
  });

  it('refuses a transition with no reason, and audits the refusal', async () => {
    const { app } = setup();
    const id = await newClaim(app);
    const res = await request(app)
      .post(`/api/claims/${id}/transition`)
      .send({ to: 'DOCUMENTS_VERIFIED', actor: USERS.clerk, data: { documents: REQUIRED_DOCS } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REASON');
    expect(res.body.entry.outcome).toBe('DENIED');
  });

  it('hides internal errors behind a generic 500', async () => {
    const { h, app } = setup();
    h.engine.listClaims = () => {
      throw new Error('secret database password leaked');
    };
    const res = await request(app).get('/api/claims');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret');
    expect(res.body.error.code).toBe('INTERNAL');
  });
});
