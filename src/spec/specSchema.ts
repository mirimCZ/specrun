import { z } from 'zod';

export const TASK_ID_PATTERN = /^[A-Z][A-Z0-9]*-[0-9]+$/;

const TaskIdSchema = z.string().regex(TASK_ID_PATTERN, {
  message: 'task id must match ^[A-Z][A-Z0-9]*-[0-9]+$ (e.g. SR-1)',
});

/**
 * `opus` / `sonnet` are the names specs of the old bash runner use (spec-run.sh, rebel-industry); they
 * stand for the strong and the default model, so the config's `models` still decides.
 */
const ModelSchema = z
  .enum(['default', 'strong', 'opus', 'sonnet'])
  .default('default')
  .transform((model) => (model === 'opus' ? 'strong' : model === 'sonnet' ? 'default' : model));

/** Task state written by spec-run.sh runs: accepted so those specs load; the runner
 * ignores it, `specrun archive` counts `status: done`. */
const IgnoredStateFields = {
  status: z.enum(['todo', 'in progress', 'done', 'blocked']).optional(),
  note: z.string().optional(),
  commit: z.string().optional(),
};

export const TaskSchema = z.strictObject({
  id: TaskIdSchema,
  title: z.string().min(1),
  phase: z.number().int().min(0),
  /** `all` = every other task of the spec. */
  needs: z.union([z.array(TaskIdSchema), z.literal('all')]).default([]),
  model: ModelSchema,
  size: z.enum(['S', 'M', 'L']).default('M'),
  ...IgnoredStateFields,
});

/** The file as authored, task state fields included (`specrun archive` reads `status`). */
export const SpecFileSchema = z.strictObject({
  title: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  tasks: z.array(TaskSchema).min(1),
});

export const SpecSchema = SpecFileSchema.transform(({ tasks, ...spec }) => ({
  ...spec,
  tasks: tasks.map(({ id, title, phase, needs, model, size }) => ({
    id,
    title,
    phase,
    needs: needs === 'all' ? tasks.map((t) => t.id).filter((other) => other !== id) : needs,
    model,
    size,
  })),
}));
/** A loaded spec; `loadSpec` falls back to the spec name for the title. */
export type Spec = Omit<z.output<typeof SpecSchema>, 'title'> & { title: string };
export type SpecTask = Spec['tasks'][number];
