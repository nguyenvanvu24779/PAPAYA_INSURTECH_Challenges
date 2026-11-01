import cors from 'cors';
import express, { type ErrorRequestHandler, type Response } from 'express';
import { z } from 'zod';
import {
  CLAIM_FIELD_KINDS,
  ClaimNotFoundError,
  InvalidRequestError,
  type DenialCode,
  type Result,
  type WorkflowEngine,
} from '@claims/engine';

const actorSchema = z
  .object({ userId: z.string().trim().min(1).max(100), role: z.string().trim().min(1).max(50) })
  .strict();
// An empty/missing reason is passed on so the engine refuses (and audits) it.
const reasonSchema = z.string().max(1000).default('');
const dataSchema = z.record(z.string(), z.unknown());

const createBody = z.object({ actor: actorSchema, data: dataSchema.optional(), reason: reasonSchema }).strict();
const dataBody = z.object({ actor: actorSchema, data: dataSchema, reason: reasonSchema }).strict();
const transitionBody = z
  .object({ to: z.string().trim().min(1).max(100), actor: actorSchema, reason: reasonSchema, data: dataSchema.optional() })
  .strict();

const STATUS_BY_CODE: Record<DenialCode, number> = {
  INVALID_REASON: 400,
  INVALID_DATA: 400,
  UNKNOWN_STATE: 400,
  UNKNOWN_ROLE: 403,
  ROLE_NOT_ALLOWED: 403,
  DATA_NOT_ALLOWED: 403,
  TRANSITION_NOT_DEFINED: 409,
  MAX_COUNT_EXCEEDED: 409,
  PRECONDITION_FAILED: 409,
};

class BadRequest extends Error {
  constructor(message: string) {
    super(message);
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    throw new BadRequest(result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  }
  return result.data;
}

function send(res: Response, result: Result, successStatus: number): void {
  if (result.ok) {
    res.status(successStatus).json({ claim: result.claim, entry: result.entry });
    return;
  }
  res.status(STATUS_BY_CODE[result.code]).json({
    error: { code: result.code, message: result.message, details: result.details },
    entry: result.entry,
  });
}

export function createApp(engine: WorkflowEngine, options: { corsOrigin?: string } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: options.corsOrigin ?? 'http://localhost:5173' }));
  app.use(express.json({ limit: '100kb' }));

  const api = express.Router();

  api.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  api.get('/workflow', (_req, res) => {
    res.json({ workflow: engine.config, fields: CLAIM_FIELD_KINDS });
  });

  api.get('/claims', (_req, res) => {
    res.json({ claims: engine.listClaims() });
  });

  api.post('/claims', (req, res) => {
    const body = parse(createBody, req.body);
    send(res, engine.createClaim(body), 201);
  });

  api.get('/claims/:id', (req, res) => {
    res.json({ claim: engine.getClaim(req.params.id) });
  });

  api.patch('/claims/:id/data', (req, res) => {
    const body = parse(dataBody, req.body);
    send(res, engine.updateClaimData(req.params.id, body), 200);
  });

  api.get('/claims/:id/transitions', (req, res) => {
    res.json({ state: engine.getClaim(req.params.id).state, transitions: engine.availableTransitions(req.params.id) });
  });

  api.post('/claims/:id/transition', (req, res) => {
    const body = parse(transitionBody, req.body);
    send(res, engine.transition(req.params.id, body), 200);
  });

  api.get('/claims/:id/audit', (req, res) => {
    res.json({ claimId: req.params.id, entries: engine.getAudit(req.params.id) });
  });

  app.use('/api', api);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found', details: [] } });
  });

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof ClaimNotFoundError) {
      res.status(404).json({ error: { code: 'CLAIM_NOT_FOUND', message: err.message, details: [] } });
    } else if (err instanceof BadRequest || err instanceof InvalidRequestError) {
      res.status(400).json({ error: { code: 'INVALID_REQUEST', message: err.message, details: [] } });
    } else if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Malformed JSON body', details: [] } });
    } else {
      // Never leak internals; the cause stays in the server log.
      console.error(err);
      res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error', details: [] } });
    }
  };
  app.use(onError);

  return app;
}
