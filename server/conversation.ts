import { Store } from "./db.ts";
import { Domain } from "./domain.ts";

// The UI supplies the user's current stage. Words in chat are content, never a
// command to change workflow, grant confirmation, or select hidden extensions.
export function conversationOptions(s: Store, requirementId: string, body: any) {
  const r = s.get("requirement", requirementId);
  // Retain replay compatibility for old read-only chat requests/snapshots.
  if (body.chatOnly)
    return {
      ...body,
      kind: "requirement",
      executor: "codex",
      conversation: false,
      chatOnly: true,
    };
  const stage = body.stage || new Domain(s).conversationStage(r);
  const action = body.action || "discuss";
  const kind =
    stage === "review" && action !== "generate" && r.heads.review
      ? "prd"
      : stage;
  return {
    ...body,
    kind,
    stage,
    action,
    executor: "codex",
    conversation: true,
    // Existing prototype edits are preview-first. Initial generation still saves
    // normally so the user immediately gets a first artifact to work with.
    previewOnly:
      kind === "prototype" && Boolean(r.heads.prototype) && action === "discuss",
    scope: body.scope || "layout",
    selection: kind === "prototype" ? body.selection : "",
  };
}
