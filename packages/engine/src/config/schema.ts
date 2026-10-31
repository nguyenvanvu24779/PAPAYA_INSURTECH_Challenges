import { z } from 'zod';

const stateId = z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'state ids are UPPER_SNAKE_CASE');
const roleId = z.string().regex(/^[a-z][a-z0-9_]*$/, 'role ids are lower_snake_case');
const fieldName = z.string().min(1);
const text = z.string().min(1);

/**
 * Preconditions are declarative: no expressions, no eval. A new kind of check
 * needs a new member here and in the condition registry; using the existing
 * kinds in new transitions needs config only.
 * `message` is the specific explanation returned when the check fails.
 */
export type Condition =
  | { type: 'exists'; field: string; message?: string }
  | { type: 'nonEmpty'; field: string; message?: string }
  | { type: 'isTrue'; field: string; message?: string }
  | { type: 'isPast'; field: string; message?: string }
  | { type: 'includesAll'; field: string; values: string[]; message?: string }
  | { type: 'lte'; field: string; otherField: string; message?: string }
  | { type: 'any'; conditions: Condition[]; message?: string }
  | { type: 'all'; conditions: Condition[]; message?: string };

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('exists'), field: fieldName, message: text.optional() }).strict(),
    z.object({ type: z.literal('nonEmpty'), field: fieldName, message: text.optional() }).strict(),
    z.object({ type: z.literal('isTrue'), field: fieldName, message: text.optional() }).strict(),
    z.object({ type: z.literal('isPast'), field: fieldName, message: text.optional() }).strict(),
    z
      .object({
        type: z.literal('includesAll'),
        field: fieldName,
        values: z.array(text).min(1),
        message: text.optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal('lte'),
        field: fieldName,
        otherField: fieldName,
        message: text.optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal('any'),
        conditions: z.array(conditionSchema).min(1),
        message: text.optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal('all'),
        conditions: z.array(conditionSchema).min(1),
        message: text.optional(),
      })
      .strict(),
  ]),
);

/**
 * Effects run after a transition has been applied. `stampTime` and
 * `clearFields` change claim data; `notify`, `createPaymentRequest`,
 * `triggerPayment` and `archiveClaim` are mocks that log to the console
 * (createPaymentRequest also records the request id on the claim).
 * `notify.message` may contain `{field}` placeholders filled from claim data.
 */
export const effectSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('notify'), target: text, message: text }).strict(),
  z.object({ type: z.literal('stampTime'), field: fieldName }).strict(),
  z.object({ type: z.literal('clearFields'), fields: z.array(fieldName).min(1) }).strict(),
  z.object({ type: z.literal('createPaymentRequest') }).strict(),
  z.object({ type: z.literal('triggerPayment') }).strict(),
  z.object({ type: z.literal('archiveClaim') }).strict(),
]);

export type Effect = z.infer<typeof effectSchema>;

const transitionSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/, 'transition ids are lower_snake_case'),
    from: stateId,
    to: stateId,
    description: text.optional(),
    roles: z.array(roleId).min(1),
    preconditions: z.array(conditionSchema).default([]),
    effects: z.array(effectSchema).default([]),
    /**
     * Cycle guard: at most `maxCount` applied executions of this transition
     * per claim. The next attempt is denied with `limitMessage`.
     */
    maxCount: z.number().int().positive().optional(),
    limitMessage: text.optional(),
  })
  .strict();

export const workflowSchema = z
  .object({
    version: z.literal(1),
    name: text,
    initialState: stateId,
    roles: z.array(roleId).min(1),
    states: z.record(
      stateId,
      z.object({ description: text, terminal: z.boolean().default(false) }).strict(),
    ),
    transitions: z.array(transitionSchema).min(1),
  })
  .strict();

export type WorkflowConfig = z.infer<typeof workflowSchema>;
export type TransitionConfig = WorkflowConfig['transitions'][number];
