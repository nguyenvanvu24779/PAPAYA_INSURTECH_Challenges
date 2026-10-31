import type { Workflow } from '../types';

export function Stepper({ workflow, current, visited }: { workflow: Workflow; current: string; visited: Set<string> }) {
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Claim lifecycle states">
      {Object.entries(workflow.states).map(([id, state]) => {
        const isCurrent = id === current;
        const wasVisited = visited.has(id);
        return (
          <li
            key={id}
            title={state.description}
            aria-current={isCurrent ? 'step' : undefined}
            data-state={id}
            data-current={isCurrent}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
              isCurrent
                ? 'border-indigo-600 bg-indigo-600 text-white'
                : wasVisited
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-200'
                  : 'border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400'
            }`}
          >
            {wasVisited && !isCurrent && <span aria-hidden="true">✓ </span>}
            {id}
            {isCurrent && <span className="sr-only"> (current)</span>}
          </li>
        );
      })}
    </ol>
  );
}
