import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { workflowSchema, type WorkflowConfig } from './schema';
import { validateWorkflow } from './validate';

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid workflow config:\n- ${problems.join('\n- ')}`);
    this.name = 'ConfigError';
  }
}

/** Validates an already-parsed config object. Throws ConfigError listing every problem. */
export function parseWorkflowObject(raw: unknown): WorkflowConfig {
  const result = workflowSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  const problems = validateWorkflow(result.data);
  if (problems.length > 0) throw new ConfigError(problems);
  return result.data;
}

export function parseWorkflowYaml(source: string): WorkflowConfig {
  let raw: unknown;
  try {
    raw = parse(source);
  } catch (err) {
    throw new ConfigError([`YAML syntax: ${err instanceof Error ? err.message : String(err)}`]);
  }
  return parseWorkflowObject(raw);
}

export function loadWorkflowFile(path: string): WorkflowConfig {
  return parseWorkflowYaml(readFileSync(path, 'utf8'));
}
