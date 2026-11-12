import { SpecrunError } from '../errors.js';
import type { Spec, SpecTask } from './specSchema.js';

/**
 * Execution order: phase first, then dependencies, ties by position in `tasks.yaml`.
 * Repeatedly takes the earliest (phase, position) task whose needs are all placed; valid specs
 * never need a later phase, so this never pulls a task ahead of its phase.
 */
export function topologicalOrder(spec: Spec): SpecTask[] {
  const known = new Set(spec.tasks.map((task) => task.id));
  const placed = new Set<string>();
  const remaining = [...spec.tasks];
  const order: SpecTask[] = [];

  while (remaining.length > 0) {
    let next = -1;
    for (const [index, task] of remaining.entries()) {
      const ready = task.needs.every((need) => placed.has(need) || !known.has(need));
      if (!ready) continue;
      if (next === -1 || task.phase < (remaining[next]?.phase ?? Infinity)) next = index;
    }
    const [task] = next === -1 ? [] : remaining.splice(next, 1);
    if (task === undefined) {
      throw new SpecrunError('spec-invalid', 'Task dependencies contain a cycle', [
        `unordered tasks: ${remaining.map((t) => t.id).join(', ')}`,
      ]);
    }
    placed.add(task.id);
    order.push(task);
  }
  return order;
}
