import { fileURLToPath } from 'node:url';
import {
  InMemoryAuditLog,
  InMemoryClaimRepository,
  ManualClock,
  WorkflowEngine,
  loadWorkflowFile,
  type AuditLog,
  type WorkflowConfig,
} from '../src';

export const CONFIG_PATH = fileURLToPath(new URL('../../../config/claim-workflow.yaml', import.meta.url));

/** Fixed start so every run (and every audit timestamp) is reproducible. */
export const T0 = new Date('2026-11-01T09:00:00.000Z');

export interface HarnessOptions {
  config?: WorkflowConfig;
  audit?: AuditLog;
}

export function createHarness(options: HarnessOptions = {}) {
  const clock = new ManualClock(T0);
  const logs: string[] = [];
  const audit = options.audit ?? new InMemoryAuditLog();
  const engine = new WorkflowEngine(options.config ?? loadWorkflowFile(CONFIG_PATH), {
    claims: new InMemoryClaimRepository(),
    audit,
    clock,
    log: (line) => logs.push(line),
  });
  return { engine, clock, logs, audit };
}

export type Harness = ReturnType<typeof createHarness>;
