import { z } from 'zod';

export type FieldKind = 'string' | 'boolean' | 'integer' | 'datetime' | 'stringArray';

/**
 * The only fields a claim may carry. Single source of truth: the workflow
 * config is checked against it at load time, and claim data is validated
 * against it at runtime. Money is an integer in minor units (e.g. cents).
 */
export const CLAIM_FIELD_KINDS = {
  documents: 'stringArray',
  assessorId: 'string',
  assessmentReportComplete: 'boolean',
  claimAmount: 'integer',
  coverageLimit: 'integer',
  rejectionReason: 'string',
  missingInfoDescription: 'string',
  newInfoReceived: 'boolean',
  assessmentStartedAt: 'datetime',
  paymentRequestId: 'string',
  paymentConfirmed: 'boolean',
  paymentReference: 'string',
  appealDeadline: 'datetime',
  memberAcknowledged: 'boolean',
} as const satisfies Record<string, FieldKind>;

export type ClaimField = keyof typeof CLAIM_FIELD_KINDS;

interface KindTypes {
  string: string;
  boolean: boolean;
  integer: number;
  datetime: string;
  stringArray: string[];
}

export type ClaimData = {
  [K in ClaimField]?: KindTypes[(typeof CLAIM_FIELD_KINDS)[K]];
};

export function claimFieldKind(name: string): FieldKind | undefined {
  return Object.hasOwn(CLAIM_FIELD_KINDS, name) ? CLAIM_FIELD_KINDS[name as ClaimField] : undefined;
}

const kindSchemas = {
  string: z.string(),
  boolean: z.boolean(),
  integer: z.number().int().safe().nonnegative(),
  // UTC only (trailing "Z"), ISO 8601.
  datetime: z.string().datetime(),
  stringArray: z.array(z.string().min(1)),
} satisfies Record<FieldKind, z.ZodTypeAny>;

/** Strict: unknown fields are rejected, never silently stored. */
export const claimDataSchema = z
  .object(
    Object.fromEntries(
      Object.entries(CLAIM_FIELD_KINDS).map(([name, kind]) => [name, kindSchemas[kind].optional()]),
    ),
  )
  .strict() as unknown as z.ZodType<ClaimData>;
