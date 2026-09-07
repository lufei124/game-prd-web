import { runReviewPanel, reviewRoles } from "./review-panel.ts";
import { resolveAssistant } from "./assistant-settings.ts";
import { posix, extname } from "node:path";
import { Store, check, uid, now } from "./db.ts";
import {
  Domain,
  type Requirement,
  type Version,
  type ArtifactKind,
} from "./domain.ts";
import { Extensions } from "./extensions.ts";
import { Knowledge } from "./knowledge.ts";
import { type AgentRuntime, type AgentHost } from "./agent.ts";
export function patchContent(
  base: string,
  patches: { search: string; replace: string }[],
  scope: string,
  selection?: string,
) {
  check(
    patches.length > 0 && patches.length <= 30,
    "局部修改需要 1–30 个精确 patch",
  );
  let out = base;
  if (selection)
    check(base.split(selection).length === 2, "选区不唯一或已变化", 409);
  for (const p of patches) {
    check(
      p.search && out.split(p.search).length === 2,
      "修改目标不存在或不唯一，请重新选择",
      409,
    );
    if (selection) check(selection.includes(p.search), "修改超出选区", 403);
    out = out.replace(p.search, () => p.replace);
  }
  if (scope === "visual") {
    const withoutStyles = (s: string) =>
      s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "<style></style>");
    check(
      withoutStyles(out) === withoutStyles(base),
      "仅视觉任务禁止改变 DOM、脚本或业务 metadata",
      403,
    );
  }
  return out;
}
export class Tasks {
  running = new Map<string, AbortController>();
  constructor(
    public s: Store,
    public domain: Domain,
    public ext: Extensions,
    public knowledge: Knowledge,
    public runtime: AgentRuntime,
  ) {}
  recover() {
    for (const t of this.s
      .all("task")
      .filter((t) => ["queued", "running"].includes(t.status))) {
      const v = this.s.all("version").find((v) => v.taskId === t.id);
      this.s.put("task", {
        ...t,
        status: v ? "completed" : "interrupted",
        resultId: v?.id,
        error: v ? "" : "应用停止，已保存输入和候选成果；可重试",
        updatedAt: now(),
      });
    }
  }
  create(id: string, body: any) {
    const r = this.s.get<Requirement>("requirement", id);
    if (!body.chatOnly) this.domain.gate(r, body.kind);
    check(
      !this.s
        .all("task")
        .some(
          (t) =>
            t.requirementId === id && ["queued", "running"].includes(t.status),
        ),
      "此需求已有运行任务，请等待或取消",
      409,
    );
    if (body.conversation) {
      for (const q of this.s
        .all("question")
        .filter((q) => q.requirementId === id && q.status === "open")) {
        this.s.put("question", {
          ...q,
          status: "answered",
          answer: body.prompt,
        });
        const prior = this.s.get("task", q.taskId);
        if (prior.status === "waiting")
          this.s.put("task", { ...prior, status: "completed", progress: 100 });
      }
    }
    const system = this.s.get("settings", "system");
    const p = this.s.get("project", r.projectId);
    const preferences = this.s.get("requirement", id).assistantDefaults || {};
    const defaults = { ...system.defaults, ...p.defaults, ...preferences, ...body.settings };
    const chosen = body.chatOnly ? [] : body.skillIds?.length
      ? body.skillIds
      : [
          preferences.skills?.[body.kind] || p.defaults?.skills?.[body.kind] ||
            system.defaults.skills?.[body.kind],
        ].filter(Boolean);
    if (body.kind === "prototype")
      chosen.push(body.styleId || defaults.styleId);
    if (body.kind === "prd")
      chosen.push(body.templateId || defaults.templateId);
    const releases = [...new Set(chosen)]
      .filter(Boolean)
      .map((x) => this.ext.select(x as string, r.projectId, body.kind));
    check(
      body.chatOnly || releases.some((x) => x.manifest.type === "skill"),
      "请配置此阶段的 Skill",
      409,
    );
    if (body.kind === "prototype")
      check(
        releases.some((x) => x.manifest.type === "style"),
        "请配置风格 Skill",
        409,
      );
    if (body.kind === "prd")
      check(
        releases.some((x) => x.manifest.type === "template"),
        "请配置 PRD 模板",
        409,
      );
    if (!body.chatOnly) {
      check(releases.filter((x) => x.manifest.type === "skill").length === 1, "每阶段只能选择一个执行 Skill");
      check(releases.every((x) => x.manifest.type === "skill" || (body.kind === "prototype" && x.manifest.type === "style") || (body.kind === "prd" && x.manifest.type === "template")), "所选扩展类型与阶段不匹配");
      if (body.kind === "prototype") check(releases.filter((x) => x.manifest.type === "style").length === 1, "原型只能选择一个风格");
      if (body.kind === "prd") check(releases.filter((x) => x.manifest.type === "template").length === 1, "PRD 只能选择一个模板");
    }
    const all = this.s.all("knowledge").filter((k) => !k.deletedAt);
    const linkedIds = this.s
      .all("knowledgeLink")
      .filter((l) => l.requirementId === r.id)
      .map((l) => l.knowledgeId);
    const explicit = [
      ...new Set([...(body.referenceIds || []), ...linkedIds]),
    ].map((x: string) => {
      const k = this.s.get("knowledge", x);
      check(
        !k.deletedAt &&
          k.projectId === r.projectId &&
          (!k.requirementId || k.requirementId === r.id),
        "资料不属于此需求或项目",
        403,
      );
      return k;
    });
    const relevant = this.knowledge.search(
      r.projectId,
      r.id,
      r.name + " " + body.prompt,
      all,
    );
    const knowledge = [
      ...new Map([...relevant, ...explicit].map((k) => [k.id, k])).values(),
    ];
    const snapshot = {
      releases,
      conversation: !!body.conversation,
      stage: body.stage || body.kind,
      action: body.action || "discuss",
      reviewRoles: body.kind === "review" ? reviewRoles : undefined,
      chatOnly: !!body.chatOnly,
      knowledge,
      heads: { ...r.heads },
      confirmed: { ...r.confirmed },
      waiver: r.waiver,
      scope: body.scope || "layout",
      selection: body.selection || "",
      ...resolveAssistant(system, p.defaults, body),
      requirement: { ...r },
      versions: this.domain
        .versions(id)
        .filter((v) => Object.values(r.heads).includes(v.id)),
      annotations: this.s
        .all("annotation")
        .filter((x) => x.requirementId === id),
      questions: this.s.all("question").filter((q) => q.requirementId === id),
      messages: this.s
        .all("message")
        .filter((x) => x.requirementId === id)
        .slice(-20),
    };
    const t = {
      id: uid(),
      requirementId: id,
      projectId: r.projectId,
      kind: body.kind,
      prompt: body.prompt,
      snapshot,
      base: r.heads[body.kind as ArtifactKind] || null,
      status: "queued",
      progress: 0,
      events: [],
      createdAt: now(),
      updatedAt: now(),
    };
    this.s.put("task", t);
    this.s.put("message", {
      id: uid(),
      requirementId: id,
      role: "user",
      content: body.prompt,
      createdAt: now(),
    });
    setImmediate(() => void this.run(t.id));
    return t;
  }
  event(id: string, text: string) {
    if (this.s.closed) return;
    const t = this.s.get("task", id);
    if (t.status !== "running") return;
    t.events.push({ at: now(), text: text.slice(0, 12000) });
    t.events = t.events.slice(-100);
    t.progress = Math.min(85, t.progress + 8);
    t.updatedAt = now();
    this.s.put("task", t);
  }
  async dispatch(id: string, name: string, args: any) {
    const t = this.s.get("task", id);
    check(t.status === "running", "任务已停止，不能再操作", 409);
    const snap = t.snapshot;
    if (name === "read_context")
      return {
        requirement: snap.requirement,
        versions: snap.versions,
        knowledge: snap.knowledge.map(({ text, ...k }: any) => k),
        annotations: snap.annotations,
        messages: snap.messages,
        questions: snap.questions || [],
        capabilities: [
          "read_context",
          "read_resource",
          "read_knowledge",
          "propose_artifact",
          "ask_question",
        ],
      };
    if (name === "read_resource") {
      const r = snap.releases.find((x: any) => x.id === args.releaseId);
      check(r, "资源不在任务锁定扩展内", 403);
      let p = args.path;
      if (!r.files[p])
        p = posix.normalize(posix.join(posix.dirname(r.main), p));
      check(!p.startsWith("../") && r.files[p], "资源不在此扩展内", 403);
      if (/\.(png|jpe?g|webp|gif)$/.test(p)) {
        const ext = extname(p).slice(1);
        return {
          path: p,
          image: {
            data: r.files[p],
            mimeType: "image/" + (ext === "jpg" ? "jpeg" : ext),
          },
        };
      }
      check(
        /\.(md|txt|json|yaml|yml|csv|py|sh|ts|js)$/.test(p),
        "此资源不支持读取",
      );
      return {
        path: p,
        content: Buffer.from(r.files[p], "base64").toString("utf8"),
      };
    }
    if (name === "read_knowledge") {
      const k = snap.knowledge.find((x: any) => x.id === args.id);
      check(k, "资料不在任务冻结范围内", 403);
      if (k.status === "image") {
        const ext = extname(k.name).slice(1).toLowerCase();
        const bytes = await this.knowledge.file(k.id);
        return {
          ...k,
          image: {
            data: bytes.toString("base64"),
            mimeType: "image/" + (ext === "jpg" ? "jpeg" : ext),
          },
        };
      }
      return k;
    }
    if (name === "ask_question") {
      check(!snap.chatOnly, "聊天模式不创建业务问题", 403);
      check(
        typeof args.question === "string" && args.question.trim(),
        "问题不能为空",
      );
      this.s.put("message", {
        id: uid(),
        requirementId: t.requirementId,
        role: "assistant",
        content: args.question,
        taskId: id,
        createdAt: now(),
      });
      return this.s.put("question", {
        id: uid(),
        taskId: id,
        requirementId: t.requirementId,
        question: args.question,
        status: "open",
        createdAt: now(),
      });
    }
    if (name === "propose_artifact") {
      check(!snap.chatOnly, "聊天模式不能修改成果", 403);
      check(
        t.kind === "requirement" ||
          !this.s
            .all("question")
            .some((q) => q.taskId === id && q.status === "open"),
        "请先等待用户回答未决问题",
        409,
      );
      let content = args.content;
      let metadata = args.metadata;
      if (t.base) {
        const base = snap.versions.find((v: any) => v.id === t.base);
        check(base, "基础版本缺失");
        if (t.kind === "prototype" || snap.selection) {
          content = patchContent(
            base.content,
            args.patches || [],
            snap.scope,
            snap.selection,
          );
          if (snap.scope === "visual") metadata = base.metadata;
        }
      }
      check(typeof content === "string" && content.trim(), "候选内容不能为空");
      t.candidate = {
        content,
        metadata,
        summary: args.summary || "成果已生成",
      };
      this.s.put("task", t);
      this.event(id, "候选已保存，正在核对基础版本");
      return { status: "candidate_saved", taskId: id };
    }
    check(false, "未授权业务工具", 403);
  }
  async run(id: string) {
    if (this.s.closed) return;
    const t = this.s.get("task", id);
    if (t.status !== "queued") return;
    const controller = new AbortController();
    this.running.set(id, controller);
    this.s.put("task", { ...t, status: "running", progress: 10 });
    const timeout = setTimeout(
      () => controller.abort(new Error("任务超过 10 分钟，请重试")),
      600_000,
    );
    try {
      const host: AgentHost = {
        read: (n, a) => this.dispatch(id, n, a),
        progress: (msg) => this.event(id, msg),
        session: (sessionId) => {
          const cur = this.s.get("task", id);
          this.s.put("task", { ...cur, sessionId, sessionIds: [...new Set([...(cur.sessionIds || []), sessionId])] });
        },
      };
      const execute = t.snapshot.reviewRoles ? (input: any, host: AgentHost) => runReviewPanel(this.runtime, input, host) : this.runtime.run.bind(this.runtime);
      const result = await execute(
        {
          id,
          kind: t.kind,
          prompt: t.prompt,
          snapshot: t.snapshot,
          root: this.s.root,
          signal: controller.signal,
          model: t.snapshot.model,
        },
        host,
      );
      const current = this.s.get("task", id);
      if (controller.signal.aborted || current.status === "cancelled") return;
      if (t.snapshot.chatOnly || (t.snapshot.conversation && !current.candidate && !this.s.all("question").some((q) => q.taskId === id && q.status === "open"))) {
        check(typeof result === "string" && result.trim(), "Codex 未返回回复，请重试", 422);
        this.s.tx(() => {
          this.s.put("message", { id: uid(), requirementId: t.requirementId,
            role: "assistant", content: result, taskId: id, createdAt: now() });
          this.s.put("task", { ...current, status: "completed", progress: 100, updatedAt: now() });
        });
        return;
      }
      const open = this.s
        .all("question")
        .some((q) => q.taskId === id && q.status === "open");
      if (open && !current.candidate) {
        this.s.put("task", { ...current, status: "waiting", progress: 50 });
        return;
      }
      check(
        current.candidate,
        "Agent 未返回有效成果；可查看回复后调整任务并重试",
        422,
      );
      const r = this.s.get<Requirement>("requirement", t.requirementId);
      for (const key of t.kind === "prd"
        ? ["requirement", "prototype"]
        : t.kind === "prototype"
          ? ["requirement"]
          : t.kind === "review"
            ? ["prd"]
            : [])
        check(
          r.heads[key as ArtifactKind] === t.snapshot.heads[key],
          "上游基础版本发生变化，候选已保留",
          409,
        );
      const v = this.domain.save(
        t.requirementId,
        t.kind,
        current.candidate.content,
        t.base,
        current.candidate.metadata,
        "agent",
        id,
      );
      this.s.put("task", {
        ...this.s.get("task", id),
        status: open ? "waiting" : "completed",
        progress: open ? 50 : 100,
        resultId: v.id,
        updatedAt: now(),
      });
      this.s.put("message", {
        id: uid(),
        requirementId: t.requirementId,
        role: "assistant",
        content: current.candidate.summary || result,
        taskId: id,
        createdAt: now(),
      });
    } catch (e) {
      const cur = this.s.get("task", id);
      if (cur.status !== "cancelled") {
        this.s.put("task", {
          ...cur,
          status: "failed",
          error: redact(e instanceof Error ? e.message : "任务失败"),
          updatedAt: now(),
        });
      }
    } finally {
      clearTimeout(timeout);
      this.running.delete(id);
    }
  }
  cancel(id: string) {
    const t = this.s.get("task", id);
    check(
      ["queued", "running", "waiting"].includes(t.status),
      "任务已结束",
      409,
    );
    this.s.put("task", { ...t, status: "cancelled", updatedAt: now() });
    this.running.get(id)?.abort();
    return this.s.get("task", id);
  }
  retry(id: string) {
    const t = this.s.get("task", id);
    check(
      ["failed", "cancelled", "interrupted", "waiting"].includes(t.status),
      "此任务不能重试",
      409,
    );
    check(
      !this.s
        .all("task")
        .some(
          (x) =>
            x.requirementId === t.requirementId &&
            ["queued", "running"].includes(x.status),
        ),
      "已有运行中的任务",
      409,
    );
    check(
      !this.s
        .all("question")
        .some((q) => q.taskId === id && q.status === "open"),
      "请先回答未决问题",
      409,
    );
    const answers = this.s
      .all("question")
      .filter((q) => q.taskId === id && q.answer)
      .map((q) => `${q.question}\n用户回答：${q.answer}`)
      .join("\n");
    const copy = {
      ...t,
      id: uid(),
      retryOf: id,
      status: "queued",
      progress: 0,
      error: null,
      candidate: null,
      sessionId: null,
      events: [],
      prompt: t.prompt + "\n" + answers,
      createdAt: now(),
      updatedAt: now(),
    };
    this.s.put("task", copy);
    setImmediate(() => void this.run(copy.id));
    return copy;
  }
}
export function redact(s: string) {
  for (const key of ["WORKBENCH_ANTHROPIC_API_KEY", "WORKBENCH_CODEX_API_KEY"])
    if (process.env[key]) s = s.split(process.env[key]!).join("[redacted]");
  return s.replace(/sk-[a-zA-Z0-9_-]{12,}/g, "[redacted]").slice(0, 4000);
}
