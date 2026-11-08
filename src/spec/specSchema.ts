import { z } from 'zod';

export const TASK_ID_PATTERN = /^[A-Z][A-Z0-9]*-[0-9]+$/;

const TaskIdSchema = z.string().regex(TASK_ID_PATTERN, {
  message: 'task id must match ^[A-Z][A-Z0-9]*-[0-9]+$ (e.g. SR-1)',
});

export const TaskSchema = z.strictObject({
  id: TaskIdSchema,
  title: z.string().min(1),
  phase: z.number().int().min(1),
  needs: z.array(TaskIdSchema),
  model: z.enum(['default', 'strong']),
  size: z.enum(['S', 'M', 'L']),
});
export type SpecTask = z.infer<typeof TaskSchema>;

export const SpecSchema = z.strictObject({
  title: z.string().min(1),
  branch: z.string().min(1).optional(),
  tasks: z.array(TaskSchema).min(1),
});
export type Spec = z.infer<typeof SpecSchema>;
