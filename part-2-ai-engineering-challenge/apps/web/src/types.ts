export type FieldKind = 'string' | 'boolean' | 'integer' | 'datetime' | 'stringArray';

export interface Workflow {
  name: string;
  initialState: string;
  roles: string[];
  states: Record<string, { description: string; terminal: boolean }>;
  intake: { roles: string[] };
  dataAccess: Record<string, { roles: string[]; states: string[] }>;
  transitions: {
    id: string;
    from: string;
    to: string;
    description?: string;
    roles: string[];
    maxCount?: number;
  }[];
}

export interface Claim {
  id: string;
  state: string;
  data: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEntry {
  id: string;
  seq: number;
  timestamp: string;
  kind: 'CREATE' | 'TRANSITION' | 'DATA_UPDATE';
  claimId: string;
  fromState: string | null;
  toState: string;
  triggeredBy: { userId: string; role: string };
  reason: string;
  outcome: 'APPLIED' | 'DENIED';
  errorCode: string | null;
  errorMessage: string | null;
  dataChanges: { field: string; before: unknown; after: unknown }[];
  effects: { type: string; status: 'OK' | 'FAILED'; detail: string }[];
}

export interface AvailableTransition {
  id: string;
  to: string;
  description: string | null;
  roles: string[];
  preconditions: { message: string; satisfied: boolean }[];
  limit: { max: number; used: number; message: string } | null;
}

export interface ApiError {
  code: string;
  message: string;
  details: string[];
}

export interface Actor {
  userId: string;
  role: string;
}
