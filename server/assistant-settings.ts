import { z } from "zod";
import { check } from "./db.ts";
export const executorSchema = z.enum(["codex", "claude"]);
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
  const executor = executorSchema.parse(
    task.executor ||
      project.executor ||
      system.executor ||
      assistantDefaults.executor,
  );
  const layers = [task, project, system];
  const model = modelSchema.parse(
    layers.find((x) => x.model && (!x.executor || x.executor === executor))
      ?.model ||
      (executor === "codex" ? assistantDefaults.model : "claude-sonnet-4-6"),
  );
  const reasoningEffort = effortSchema.parse(
    task.reasoningEffort ||
      project.reasoningEffort ||
      system.reasoningEffort ||
      assistantDefaults.reasoningEffort,
  );
  check(
    executor !== "claude" || reasoningEffort !== "ultra",
    "Claude 不支持 ultra 思考深度，请选择其他档位",
  );
  return { executor, model, reasoningEffort };
}
