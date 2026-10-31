import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHarness } from '../packages/engine/scenarios/harness';
import { SCENARIOS, runScenario } from '../packages/engine/scenarios/scenarios';

const docsDir = fileURLToPath(new URL('../docs/', import.meta.url));
mkdirSync(docsDir, { recursive: true });

const lines: string[] = [];
const out = (line = '') => lines.push(line);
const audits: Record<string, unknown> = {};
let allPassed = true;

for (const scenario of SCENARIOS) {
  const harness = createHarness();
  const report = runScenario(harness, scenario);
  allPassed &&= report.passed;

  out('='.repeat(100));
  out(`Scenario ${scenario.id}: ${scenario.name}  [${report.passed ? 'PASS' : 'FAIL'}]`);
  out(scenario.description);
  out(`Claim: ${report.claimId}   Final state: ${report.finalState} (expected ${scenario.finalState})`);
  out('-'.repeat(100));
  out('Steps');
  report.steps.forEach((s, i) => {
    const verdict = s.expected === null ? 'time' : s.passed ? 'ok  ' : 'FAIL';
    const result = s.expected === null ? '' : ` -> ${s.actual}`;
    out(`  ${String(i + 1).padStart(2)}. [${verdict}] ${s.label}${result}`);
    if (s.message) out(`        ${s.message}`);
  });
  out();
  out('Audit trail (immutable, hash-chained)');
  for (const e of report.audit) {
    const move = `${e.fromState ?? '(new)'} -> ${e.toState}`;
    out(`  #${e.seq} ${e.timestamp} ${e.outcome.padEnd(7)} ${e.kind.padEnd(11)} ${move}`);
    out(`      by ${e.triggeredBy.userId} (${e.triggeredBy.role}) — "${e.reason}"`);
    if (e.errorCode) out(`      DENIED ${e.errorCode}: ${e.errorMessage}`);
    for (const c of e.dataChanges) out(`      data ${c.field}: ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`);
  }
  out();
  out('Side effects (mock, console)');
  harness.logs.forEach((l) => out(`  ${l}`));
  out();

  audits[`scenario_${scenario.id}`] = { name: scenario.name, claimId: report.claimId, entries: report.audit };
  console.log(`Scenario ${scenario.id} ${scenario.name}: ${report.passed ? 'PASS' : 'FAIL'}`);
}

out('='.repeat(100));
out(allPassed ? 'ALL SCENARIOS PASSED' : 'SOME SCENARIOS FAILED');

writeFileSync(`${docsDir}scenario-output.txt`, lines.join('\n') + '\n');
writeFileSync(`${docsDir}audit-output.json`, JSON.stringify(audits, null, 2) + '\n');
console.log(allPassed ? 'ALL SCENARIOS PASSED' : 'SOME SCENARIOS FAILED');
console.log('Wrote docs/scenario-output.txt and docs/audit-output.json');
process.exit(allPassed ? 0 : 1);
