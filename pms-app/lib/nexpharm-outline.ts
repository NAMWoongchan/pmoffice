import type { ProductionTask } from './nexpharm-production';

export type OutlinePreset = '1' | '2' | '3' | 'all' | 'custom';

export function productionOutline(tasks: readonly ProductionTask[]) {
  const ancestors = new Map<string, string[]>();
  const parents = new Set<string>();
  const stack: ProductionTask[] = [];
  for (const task of tasks) {
    while (stack.length && stack[stack.length - 1].level >= task.level) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) parents.add(parent.id);
    ancestors.set(task.id, stack.map(item => item.id));
    stack.push(task);
  }
  return { ancestors, parents };
}

export function presetBranches(tasks: readonly ProductionTask[], preset: Exclude<OutlinePreset, 'custom'>) {
  return new Set(tasks.filter(task => preset === 'all' || task.level < Number(preset)).map(task => task.id));
}
