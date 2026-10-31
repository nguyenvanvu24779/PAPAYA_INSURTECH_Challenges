import { fileURLToPath } from 'node:url';
import { FileAuditLog, JsonFileClaimRepository, WorkflowEngine, loadWorkflowFile, systemClock } from '@claims/engine';
import { createApp } from './app';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const configPath = process.env.WORKFLOW_CONFIG ?? `${root}config/claim-workflow.yaml`;
const dataDir = process.env.DATA_DIR ?? `${root}data`;
const port = Number(process.env.PORT ?? 3001);

const engine = new WorkflowEngine(loadWorkflowFile(configPath), {
  claims: new JsonFileClaimRepository(`${dataDir}/claims.json`),
  audit: new FileAuditLog(`${dataDir}/audit.jsonl`),
  clock: systemClock,
});

createApp(engine, { corsOrigin: process.env.CORS_ORIGIN }).listen(port, () => {
  console.log(`Claim workflow API listening on http://localhost:${port}`);
  console.log(`  config: ${configPath}`);
  console.log(`  data:   ${dataDir}`);
});
