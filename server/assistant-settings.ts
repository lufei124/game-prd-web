import { z } from "zod";
export const executorSchema = z.literal("codex");
export const effortSchema = z.enum([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);
export const modelSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/, "模型 ID 格式无效");
export const assistantDefaults = {
  executor: "codex",
  model: "gpt-5.6-terra",
  reasoningEffort: "medium",
};
export const assistantSettingsSchema = z
  .object({
    executor: executorSchema.optional(),
    model: modelSchema.optional(),
    reasoningEffort: effortSchema.optional(),
  })
  .passthrough();
export function resolveAssistant(
  system: any,
  project: any = {},
  task: any = {},
) {
  const executor = "codex" as const;
  const layers = [task, project, system];
  const model = modelSchema.parse(
    layers.find(
      (x) =>
        x.model &&
        (!x.executor || x.executor === executor) &&
        !String(x.model).startsWith("claude"),
    )?.model || assistantDefaults.model,
  );
  const reasoningEffort = effortSchema.parse(
    task.reasoningEffort ||
      project.reasoningEffort ||
      system.reasoningEffort ||
      assistantDefaults.reasoningEffort,
  );
  return { executor, model, reasoningEffort };
}
