import { describe, expect, it } from 'vitest';
import type { Spec, SpecTask } from './specSchema.js';
import { topologicalOrder } from './taskOrder.js';

function task(id: string, phase: number, needs: string[] = []): SpecTask {
  return { id, title: id, phase, needs, model: 'default', size: 'S' };
}

function order(...tasks: SpecTask[]): string[] {
  const spec: Spec = { title: 'Demo', tasks };
  return topologicalOrder(spec).map((t) => t.id);
}

describe('topologicalOrder', () => {
  it('orders by phase first', () => {
    const ids = order(task('A-1', 2), task('A-2', 1), task('A-3', 3), task('A-4', 1));
    expect(ids).toEqual(['A-2', 'A-4', 'A-1', 'A-3']);
  });

  it('places dependencies before their dependents within a phase', () => {
    const ids = order(task('A-1', 1, ['A-3']), task('A-2', 1, ['A-1']), task('A-3', 1));
    expect(ids).toEqual(['A-3', 'A-1', 'A-2']);
  });

  it('keeps spec.json order for independent tasks', () => {
    const ids = order(task('B-2', 1), task('A-1', 1), task('C-3', 1, ['B-2']), task('A-9', 1));
    expect(ids).toEqual(['B-2', 'A-1', 'C-3', 'A-9']);
  });

  it('throws on a cycle instead of dropping tasks', () => {
    expect(() => order(task('A-1', 1, ['A-2']), task('A-2', 1, ['A-1']))).toThrow(/cycle/);
  });
});
