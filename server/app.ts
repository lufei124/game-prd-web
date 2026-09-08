import {
  executorSchema,
  effortSchema,
  modelSchema,
  assistantSettingsSchema,
} from "./assistant-settings.ts";
import express from "express";
import multer from "multer";
import { randomBytes } from "node:crypto";
import { realpath } from "node:fs/promises";
import { z } from "zod";
import { Store, check, uid, now, Fault } from "./db.ts";
import { Domain, kindSchema, reviewSchema } from "./domain.ts";
import {
  Extensions,
  directoryFiles,
  githubFiles,
  unzip,
  encoded,
} from "./extensions.ts";
import { conversationOptions } from "./conversation.ts";
import { KnowledgeTree } from "./knowledge-tree.ts";
import { Knowledge } from "./knowledge.ts";
import { Tasks, redact } from "./tasks.ts";
import { type AgentRuntime } from "./agent.ts";
import { startCodexLogin, logoutCodex } from "./codex-auth.ts";
import { CodexExecutor, codexStatus } from "./codex.ts";
import {
  PluginRegistry,
  LarkPlugin,
  Delivery,
  type DeliveryPlugin,
} from "./plugins.ts";
import { purgeProject } from "./project-purge.ts";
import { bootstrap } from "./bootstrap.ts";
const text = z.string().trim().min(1).max(500_000),
  id = z.string().min(1).max(100);
export async function createApp(
  root: string,
  options: {
    runtime?: AgentRuntime;
    plugin?: DeliveryPlugin;
    test?: boolean;
  } = {},
) {
  const s = new Store(root);
  await bootstrap(s);
  for (const trash of s.all("projectTrash").filter((x) => x.purging)) {
    try {
      await purgeProject(s, trash.id, trash.name);
    } catch {
      /* Retain tombstone for an explicit retry. */
    }
  }
  const domain = new Domain(s),
    extensions = new Extensions(s),
    knowledge = new Knowledge(s),
    registry = new PluginRegistry();
  registry.register(options.plugin || new LarkPlugin(root));
  const delivery = new Delivery(s, registry);
  const tasks = new Tasks(
    s,
    domain,
    extensions,
    knowledge,
    options.runtime || new CodexExecutor(),
  );
  tasks.recover();
  const app = express();
  app.disable("x-powered-by");
  const token = randomBytes(32).toString("hex");
  const cookie = randomBytes(32).toString("hex");
  app.use((req, res, next) => {
    const host = req.hostname;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host))
      return res
        .status(403)
        .json({ error: "只允许本机 Host，已阻止 DNS rebinding" });
    const origin = req.headers.origin;
    if (origin) {
      try {
        const u = new URL(origin);
        if (u.host !== req.headers.host)
          return res.status(403).json({ error: "禁止跨站或原型来源访问" });
      } catch {
        return res.status(403).json({ error: "无效来源" });
      }
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (req.path.startsWith("/api")) {
      res.setHeader("Cache-Control", "no-store");
      if (req.path === "/api/bootstrap" && req.method === "GET") {
        res.cookie("forge_session", cookie, {
          httpOnly: true,
          sameSite: "strict",
          path: "/",
        });
        return next();
      }
      if (
        !req.headers.cookie
          ?.split(";")
          .some((x) => x.trim() === `forge_session=${cookie}`)
      )
        return res.status(401).json({ error: "本机会话失效，请刷新" });
      if (
        !["GET", "HEAD"].includes(req.method) &&
        (req.headers["x-forge-csrf"] !== token || !origin)
      )
        return res
          .status(403)
          .json({ error: "需要可信界面操作，缺少 CSRF/Origin" });
    }
    next();
  });
  app.use(express.json({ limit: "3mb" }));
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  });
  const route = (
    method: "get" | "post" | "patch" | "delete",
    path: string,
    fn: (req: any) => any,
  ) =>
    app[method](path, async (req, res, next) => {
      try {
        res.json(await fn(req));
      } catch (e) {
        next(e);
      }
    });
  route("get", "/api/bootstrap", () => ({
    csrf: token,
    projects: s.all("project"),
    projectTrash: s.all("projectTrash").map(({ entries, ...x }) => x),
    draftRequirementIds: [
      ...s.all("requirement").map((x) => x.id),
      ...s
        .all("projectTrash")
        .filter((x) => !x.purging)
        .flatMap((x) =>
          x.entries
            .filter((e: any) => e.kind === "requirement")
            .map((e: any) => e.data.id),
        ),
    ],
    requirements: s.all("requirement").map((r) => ({
      ...r,
      stage: domain.stage(r),
      conversationStage: domain.conversationStage(r),
    })),
    extensions: extensions.list().map((e) => ({
      ...e,
      release: {
        ...e.release,
        files: undefined,
        content: Buffer.from(
          e.release.files[e.release.main],
          "base64",
        ).toString("utf8"),
        resources: Object.keys(e.release.files),
      },
    })),
    settings: s.get("settings", "system"),
    plugins: registry.list().map((p) => ({
      ...p,
      config: s.maybe("pluginConfig", p.id) || {
        id: p.id,
        enabled: true,
        projectIds: [],
      },
      version: "1.0.0",
    })),
    runtime: options.test ? "test-mock" : "live",
    onlineNotice:
      "AI 执行会将本次需求、选中的 Skills 与相关资料发送给在线模型；资料默认保存在本机。",
  }));
  route("post", "/api/projects", (r) =>
    domain.project(text.max(100).parse(r.body.name)),
  );
  route("patch", "/api/projects/:id", (r) => {
    const p = s.get("project", r.params.id);
    const b = z
      .object({
        name: text.max(100).optional(),
        defaults: assistantSettingsSchema.optional(),
      })
      .strict()
      .parse(r.body);
    return s.put("project", { ...p, ...b });
  });
  route("delete", "/api/projects/:id", (r) => {
    const b = z
      .object({ confirmedName: text.max(100) })
      .strict()
      .parse(r.body);
    const requirementIds = new Set(
      s
        .all("requirement")
        .filter((x) => x.projectId === r.params.id)
        .map((x) => x.id),
    );
    check(
      ![...delivery.locks].some((id) => requirementIds.has(id)),
      "项目正在发布，请等待结束",
      409,
    );
    check(
      ![...tasks.running.keys()].some(
        (id) => s.get("task", id).projectId === r.params.id,
      ),
      "任务正在停止，请稍后删除",
      409,
    );
    return domain.deleteProject(r.params.id, b.confirmedName);
  });
  route("delete", "/api/projects/:id/permanent", (r) => {
    const b = z
      .object({ confirmedName: text.max(100) })
      .strict()
      .parse(r.body);
    return purgeProject(s, r.params.id, b.confirmedName);
  });
  route("post", "/api/projects/:id/restore", (r) =>
    domain.restoreProject(r.params.id),
  );
  route("post", "/api/requirements", (r) => {
    const b = z
      .object({
        projectId: id,
        name: text.max(120),
        mode: z
          .enum(["full", "prototype", "review", "publish"])
          .default("full"),
      })
      .parse(r.body);
    return domain.requirement(b.projectId, b.name, b.mode);
  });
  route("get", "/api/requirements/:id", (r) => {
    const req = s.get("requirement", r.params.id);
    return {
      requirement: {
        ...req,
        stage: domain.stage(req),
        conversationStage: domain.conversationStage(req),
      },
      versions: domain.versions(req.id),
      tasks: s
        .all("task")
        .filter((t) => t.requirementId === req.id)
        .map(({ snapshot, ...t }) => ({
          ...t,
          snapshot: {
            releases: (snapshot.releases || []).map(
              ({ files, ...x }: any) => x,
            ),
            knowledge: (snapshot.knowledge || []).map(
              ({ text, ...x }: any) => x,
            ),
            contextPack: snapshot.contextPack
              ? {
                  ...snapshot.contextPack,
                  items: snapshot.contextPack.items.map(
                    ({ content, ...item }: any) => item,
                  ),
                }
              : undefined,
            scope: snapshot.scope,
            conversation: !!snapshot.conversation,
            chatOnly: !!snapshot.chatOnly,
            stage: snapshot.stage,
            action: snapshot.action,
            model: snapshot.model,
            executor: snapshot.executor,
            reasoningEffort: snapshot.reasoningEffort,
          },
        })),
      messages: s.all("message").filter((x) => x.requirementId === req.id),
      questions: s.all("question").filter((x) => x.requirementId === req.id),
      annotations: s
        .all("annotation")
        .filter((x) => x.requirementId === req.id),
      publications: s
        .all("publication")
        .filter((x) => x.requirementId === req.id),
      resolutions: s
        .all("resolution")
        .filter((x) => x.requirementId === req.id),
      confirmations: s
        .all("confirmation")
        .filter((x) => x.requirementId === req.id),
      reviewBriefs: s
        .all("reviewBrief")
        .filter((x) => x.requirementId === req.id),
    };
  });
  route("post", "/api/requirements/:id/versions", (r) => {
    const b = z
      .object({
        kind: kindSchema,
        content: text,
        base: id.nullable(),
        metadata: z.any().default({}),
      })
      .parse(r.body);
    return domain.save(r.params.id, b.kind, b.content, b.base, b.metadata);
  });
  route("post", "/api/requirements/:id/confirm", (r) => {
    const b = z.object({ kind: kindSchema, versionId: id }).parse(r.body);
    return domain.confirm(r.params.id, b.kind, b.versionId);
  });
  route("post", "/api/requirements/:id/waive", (r) =>
    domain.waive(
      r.params.id,
      id.parse(r.body.versionId),
      text.parse(r.body.reason),
    ),
  );
  route("post", "/api/requirements/:id/sync-prd", (r) => {
    const req = s.get("requirement", r.params.id);
    check(req.heads.prd === r.body.versionId, "PRD 已变化", 409);
    const v = s.get("version", req.heads.prd);
    return domain.save(
      req.id,
      "prd",
      v.content,
      v.id,
      v.metadata,
      "user",
      undefined,
      {
        requirement: req.heads.requirement || null,
        prototype: req.heads.prototype || null,
        prd: v.id,
        syncConfirmedAt: now(),
      },
    );
  });
  route("post", "/api/requirements/:id/finalize", (r) =>
    domain.finalize(r.params.id, id.parse(r.body.versionId)),
  );
  route("post", "/api/requirements/:id/restore", (r) =>
    domain.restore(
      r.params.id,
      id.parse(r.body.versionId),
      id.nullable().parse(r.body.base),
    ),
  );
  route("post", "/api/requirements/:id/annotations", (r) =>
    domain.annotate(
      r.params.id,
      id.parse(r.body.versionId),
      id.parse(r.body.pageId),
      text.parse(r.body.text),
    ),
  );
  route("post", "/api/requirements/:id/tasks", (r) => {
    const b = z
      .object({
        kind: kindSchema,
        prompt: text,
        skillIds: z.array(id).optional(),
        styleId: id.optional(),
        templateId: id.optional(),
        referenceIds: z.array(id).default([]),
        scope: z.enum(["visual", "layout", "reorganize"]).default("layout"),
        selection: z.string().max(100000).optional(),
        executor: executorSchema.optional(),
        model: modelSchema.optional(),
        reasoningEffort: effortSchema.optional(),
      })
      .parse(r.body);
    return tasks.create(r.params.id, b);
  });
  route("patch", "/api/requirements/:id/assistant", (r) => {
    const requirement = s.get("requirement", r.params.id);
    const choices = z
      .object({
        skills: z
          .object({
            requirement: id.optional(),
            prototype: id.optional(),
            prd: id.optional(),
            review: id.optional(),
          })
          .strict()
          .default({}),
        styleId: id.optional(),
        templateId: id.optional(),
      })
      .strict()
      .parse(r.body);
    for (const [stage, extensionId] of Object.entries(choices.skills)) {
      check(
        extensions.select(extensionId, requirement.projectId, stage).manifest
          .type === "skill",
        "请选择对应阶段的 Skill",
      );
    }
    for (const [key, stage, type] of [
      ["styleId", "prototype", "style"],
      ["templateId", "prd", "template"],
    ] as const) {
      if (choices[key])
        check(
          extensions.select(choices[key], requirement.projectId, stage).manifest
            .type === type,
          "扩展类型不匹配",
        );
    }
    return s.put("requirement", { ...requirement, assistantDefaults: choices });
  });
  route("post", "/api/requirements/:id/chat", (r) => {
    const b = z
      .object({
        prompt: text,
        stage: kindSchema.optional(),
        action: z.enum(["discuss", "generate"]).default("discuss"),
        scope: z.enum(["visual", "layout"]).default("layout"),
        chatOnly: z.boolean().default(false),
        referenceIds: z.array(id).default([]),
        executor: executorSchema.optional(),
        model: modelSchema.optional(),
        reasoningEffort: effortSchema.optional(),
        selection: z.string().max(100000).optional(),
      })
      .parse(r.body);
    return s.tx(() =>
      tasks.create(r.params.id, conversationOptions(s, r.params.id, b)),
    );
  });
  route("post", "/api/tasks/:id/cancel", (r) => tasks.cancel(r.params.id));
  route("post", "/api/tasks/:id/retry", (r) => tasks.retry(r.params.id));
  route("post", "/api/tasks/:id/apply-candidate", (r) =>
    tasks.applyCandidate(r.params.id),
  );
  route("post", "/api/tasks/:id/discard-candidate", (r) =>
    tasks.discardCandidate(r.params.id),
  );
  route("post", "/api/tasks/:id/recover", (r) => {
    const t = s.get("task", r.params.id);
    check(
      !["running", "queued"].includes(t.status) && t.candidate,
      "没有可恢复候选",
      409,
    );
    const v = domain.save(
      t.requirementId,
      t.kind,
      t.candidate.content,
      id.nullable().parse(r.body.base),
      t.candidate.metadata,
      "user",
    );
    s.audit("user", "task.recover", t.id, { versionId: v.id });
    return v;
  });
  route("post", "/api/questions/:id/answer", (r) => {
    const q = s.get("question", r.params.id);
    check(q.status === "open", "问题已回答", 409);
    q.answer = text.parse(r.body.answer);
    q.status = "answered";
    s.put("message", {
      id: uid(),
      requirementId: q.requirementId,
      role: "user",
      content: q.answer,
      createdAt: now(),
    });
    return s.put("question", q);
  });
  route("post", "/api/reviews/:id/resolve", (r) => {
    const v = s.get("version", r.params.id);
    const b = z
      .object({
        issueId: id,
        decision: z.enum(["采纳", "不采纳", "稍后处理"]),
      })
      .parse(r.body);
    check(
      v.kind === "review" &&
        v.metadata.issues.some((x: any) => x.id === b.issueId),
      "问题不存在",
    );
    return s.put("resolution", {
      id: uid(),
      reviewId: v.id,
      requirementId: v.requirementId,
      ...b,
      actor: "user",
      createdAt: now(),
    });
  });
  route("post", "/api/requirements/:id/review-briefs", (r) => {
    const req = s.get("requirement", r.params.id);
    const b = z
      .object({ prdVersionId: id, html: text.max(2_000_000) })
      .strict()
      .parse(r.body);
    check(req.heads.prd === b.prdVersionId, "PRD 版本已变化", 409);
    check(/<html[\s>]/i.test(b.html), "评审讲解必须是完整 HTML");
    check(
      !/<(?:iframe|object|embed|base)\b/i.test(b.html) &&
        !/(?:src|href|action)\s*=\s*["']\s*(?:https?:)?\/\//i.test(b.html),
      "评审讲解不允许外部网络资源",
    );
    const previous = s
      .all("reviewBrief")
      .filter((x) => x.requirementId === req.id);
    return s.put("reviewBrief", {
      id: uid(),
      requirementId: req.id,
      number: previous.length + 1,
      prdVersionId: b.prdVersionId,
      html: b.html,
      createdAt: now(),
    });
  });
  app.get("/api/versions/:id/preview", (req, res, next) => {
    try {
      const v = s.get("version", req.params.id);
      check(v.kind === "prototype", "不是原型");
      res.setHeader(
        "Content-Security-Policy",
        "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'",
      );
      res.type("html").send(v.content);
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/versions/:id/export", (req, res, next) => {
    try {
      const v = s.get("version", req.params.id);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${v.kind}-v${v.number}.${v.kind === "prototype" ? "html" : "md"}"`,
      );
      res.type("application/octet-stream").send(v.content);
    } catch (e) {
      next(e);
    }
  });
  route("get", "/api/knowledge", (r) => {
    const projectId = id.parse(r.query.projectId);
    return {
      items: s
        .all("knowledge")
        .filter((x) => x.projectId === projectId && !x.deletedAt)
        .map((x) => {
          const document = x.documentId
            ? s.maybe("knowledgeDocument", x.documentId)
            : undefined;
          return {
            ...x,
            text: undefined,
            externalId: document?.externalId,
            documentStatus: document?.status,
          };
        }),
      folders: s
        .all("knowledgeFolder")
        .filter((x) => x.projectId === projectId),
      links: s.all("knowledgeLink").filter((x) => x.projectId === projectId),
      sources: s
        .all("knowledgeSource")
        .filter((x) => x.projectId === projectId && !x.removedAt)
        .map((x) => ({
          ...x,
          documentCount: s
            .all("knowledgeDocument")
            .filter((d) => d.sourceId === x.id).length,
        })),
      documents: s
        .all("knowledgeDocument")
        .filter((x) => x.projectId === projectId),
      conflicts: knowledge.conflicts(projectId),
    };
  });
  route("post", "/api/knowledge/sources", async (r) => {
    const body = z
      .object({
        projectId: id,
        type: z.enum(["directory", "feishu"]),
        name: text.max(150),
        locator: text.max(2000),
      })
      .strict()
      .parse(r.body);
    s.get("project", body.projectId);
    let locator = body.locator;
    if (body.type === "directory") {
      locator = await realpath(locator);
      const settings = s.get("settings", "system");
      s.put("settings", {
        ...settings,
        authorizedRoots: [
          ...new Set([...(settings.authorizedRoots || []), locator]),
        ],
      });
    }
    return knowledge.sources.ensure(body.projectId, { ...body, locator });
  });
  route("delete", "/api/knowledge/sources/:id", (r) => {
    const source = s.get("knowledgeSource", r.params.id);
    s.put("knowledgeSource", { ...source, removedAt: now(), updatedAt: now() });
    s.audit("user", "knowledgeSource.unlink", source.id);
    return { removed: true };
  });
  route("post", "/api/knowledge/sources/:id/sync", async (r) => {
    const source = s.get("knowledgeSource", r.params.id);
    check(!source.removedAt, "资料源已解除", 409);
    check(source.type !== "upload", "项目上传资料无需同步", 409);
    const results: any[] = [];
    let reconciled = 0;
    try {
      if (source.type === "directory") {
        const files = await directoryFiles(
          source.locator,
          s.get("settings", "system").authorizedRoots,
        );
        const observed = Object.keys(files).map((path) =>
          path.replaceAll("\\", "/"),
        );
        for (const [relativePath, data] of Object.entries(files)) {
          let folderId: string | null = null;
          for (const segment of relativePath.split("/").slice(0, -1)) {
            const existing = s
              .all("knowledgeFolder")
              .find(
                (x) =>
                  x.projectId === source.projectId &&
                  x.parentId === folderId &&
                  x.name === segment,
              );
            folderId =
              existing?.id ||
              new KnowledgeTree(s).create(source.projectId, segment, folderId)
                .id;
          }
          results.push(
            await knowledge.import(
              source.projectId,
              folderId,
              relativePath,
              Buffer.from(data, "base64"),
              `directory:${source.locator}/${relativePath}`,
              "general",
              "pending",
              null,
              {
                sourceId: source.id,
                sourceType: "directory",
                locator: source.locator,
                externalId: relativePath.replaceAll("\\", "/"),
                syncedAt: now(),
              },
            ),
          );
        }
        reconciled = knowledge.sources.reconcileDirectory(
          source.id,
          observed,
        ).deprecated;
      } else {
        const remote = await registry.get("feishu").fetch(source.locator);
        results.push(
          await knowledge.import(
            source.projectId,
            null,
            `${source.name || remote.id}.md`,
            Buffer.from(remote.content),
            `feishu:${remote.id}`,
            "general",
            "pending",
            null,
            {
              sourceId: source.id,
              sourceType: "feishu",
              locator: source.locator,
              externalId: remote.id,
              sourceRevision: remote.revision,
              sourceUpdatedAt: remote.updatedAt,
              sourceUrl: remote.url,
              syncedAt: now(),
            },
          ),
        );
      }
      knowledge.sources.synced(
        source.id,
        "success",
        "",
        results.filter((x) => !x.unchanged || x.reactivated).length +
          reconciled,
      );
      return results;
    } catch (error) {
      knowledge.sources.synced(
        source.id,
        "failed",
        redact(error instanceof Error ? error.message : "同步失败"),
      );
      throw error;
    }
  });
  app.post(
    "/api/knowledge/upload",
    upload.single("file"),
    async (req, res, next) => {
      try {
        check(req.file, "请选择资料");
        res.json(
          await knowledge.import(
            id.parse(req.body.projectId),
            req.body.requirementId || null,
            req.file.originalname,
            req.file.buffer,
            "upload:" + req.file.originalname,
            req.body.module || "general",
            req.body.state || "pending",
            req.body.folderId || null,
            {
              sourceType: "upload",
              externalId: req.file.originalname,
              syncedAt: now(),
            },
          ),
        );
      } catch (e) {
        next(e);
      }
    },
  );
  route("post", "/api/knowledge/text", (r) => {
    const b = z
      .object({
        projectId: id,
        requirementId: id.nullable().default(null),
        name: text.max(150),
        content: text,
        module: z.string().default("general"),
        folderId: id.nullable().default(null),
        state: z
          .enum(["pending", "confirmed", "live", "historical"])
          .default("pending"),
      })
      .parse(r.body);
    return knowledge.import(
      b.projectId,
      b.requirementId,
      b.name.endsWith(".md") ? b.name : b.name + ".md",
      Buffer.from(b.content),
      "manual:" + b.name,
      b.module,
      b.state,
      b.folderId,
      {
        sourceType: "upload",
        externalId: b.name.endsWith(".md") ? b.name : b.name + ".md",
        syncedAt: now(),
      },
    );
  });
  route("post", "/api/knowledge/directory", async (r) => {
    const files = await directoryFiles(
      text.parse(r.body.path),
      s.get("settings", "system").authorizedRoots,
    );
    const results = [];
    const projectId = id.parse(r.body.projectId);
    for (const [name, data] of Object.entries(files)) {
      let folderId = r.body.folderId || null;
      new KnowledgeTree(s).folder(projectId, folderId);
      for (const segment of name.split("/").slice(0, -1)) {
        const existing = s
          .all("knowledgeFolder")
          .find(
            (x) =>
              x.projectId === projectId &&
              x.parentId === folderId &&
              x.name === segment,
          );
        folderId =
          existing?.id ||
          new KnowledgeTree(s).create(projectId, segment, folderId).id;
      }
      results.push(
        await knowledge.import(
          id.parse(r.body.projectId),
          r.body.requirementId || null,
          name,
          Buffer.from(data, "base64"),
          "directory:" + r.body.path + "/" + name,
          r.body.module || "general",
          "pending",
          folderId,
          {
            sourceType: "directory",
            locator: r.body.path,
            externalId: name.replaceAll("\\", "/"),
            syncedAt: now(),
          },
        ),
      );
    }
    return results;
  });
  route("post", "/api/knowledge/feishu", async (r) => {
    const remote = await registry.get("feishu").fetch(text.parse(r.body.doc));
    return knowledge.import(
      id.parse(r.body.projectId),
      r.body.requirementId || null,
      (r.body.name || remote.id) + ".md",
      Buffer.from(remote.content),
      "feishu:" + remote.id,
      r.body.module || "general",
      "pending",
      r.body.folderId || null,
      {
        sourceType: "feishu",
        locator: text.parse(r.body.doc),
        externalId: remote.id,
        sourceRevision: remote.revision,
        sourceUpdatedAt: remote.updatedAt,
        sourceUrl: remote.url,
        syncedAt: now(),
      },
    );
  });
  const tree = new KnowledgeTree(s);
  route("post", "/api/knowledge/folders", (r) =>
    tree.create(
      id.parse(r.body.projectId),
      text.max(100).parse(r.body.name),
      r.body.parentId || null,
    ),
  );
  route("delete", "/api/knowledge/folders/:id", (r) =>
    tree.removeFolder(r.params.id),
  );
  route("delete", "/api/knowledge/:id", (r) => tree.removeFile(r.params.id));
  route("patch", "/api/knowledge/:id", (r) =>
    tree.moveFile(r.params.id, r.body.folderId || null),
  );
  route("post", "/api/requirements/:id/materials", (r) =>
    tree.link(r.params.id, id.parse(r.body.knowledgeId)),
  );
  route("delete", "/api/requirements/:id/materials/:knowledgeId", (r) =>
    tree.unlink(r.params.id, r.params.knowledgeId),
  );
  app.get("/api/knowledge/:id/file", async (req, res, next) => {
    try {
      res
        .type("application/octet-stream")
        .setHeader("Content-Disposition", 'attachment; filename="reference"');
      res.send(await knowledge.file(req.params.id));
    } catch (e) {
      next(e);
    }
  });
  route("get", "/api/knowledge/search", (r) =>
    knowledge.search(
      id.parse(r.query.projectId),
      r.query.requirementId || null,
      text.parse(r.query.q),
    ),
  );
  route("get", "/api/tasks/:id/recall-trace", (r) => {
    s.get("task", r.params.id);
    return s.all("recallTrace").find((x) => x.taskId === r.params.id) || null;
  });
  route("post", "/api/extensions/simple", (r) => {
    const b = z
      .object({
        name: text.max(100),
        type: z.enum(["skill", "style", "template"]),
        content: text,
        stages: z.array(
          z.enum(["requirement", "prototype", "prd", "review", "publish"]),
        ),
        existingId: id.optional(),
      })
      .parse(r.body);
    const old = b.existingId
      ? s.get("release", s.get("extension", b.existingId).currentRelease)
      : null;
    if (old) check(old.manifest.type === b.type, "更新不能改变扩展类型");
    return extensions.install(
      {
        ...old?.files,
        [old?.main || (b.type === "template" ? "template.md" : "SKILL.md")]:
          encoded(b.content),
      },
      "local-editor",
      {
        name: b.name,
        type: b.type,
        stages: b.stages,
        permissions:
          b.type === "template"
            ? []
            : ["artifact.draft", "knowledge.read", "resource.read"],
      },
      b.existingId,
    );
  });
  route("post", "/api/extensions/import", async (r) => {
    const b = z
      .object({
        source: z.enum(["directory", "github"]),
        location: text,
        metadata: z.any(),
        existingId: id.optional(),
      })
      .parse(r.body);
    const files =
      b.source === "directory"
        ? await directoryFiles(
            b.location,
            s.get("settings", "system").authorizedRoots,
          )
        : await githubFiles(b.location);
    return extensions.install(files, b.location, b.metadata, b.existingId);
  });
  app.post(
    "/api/extensions/zip",
    upload.single("file"),
    async (req, res, next) => {
      try {
        check(req.file, "请选择 ZIP");
        res.json(
          extensions.install(
            await unzip(req.file.buffer),
            "zip:" + req.file.originalname,
            JSON.parse(req.body.metadata),
            req.body.existingId || undefined,
          ),
        );
      } catch (e) {
        next(e);
      }
    },
  );
  route("patch", "/api/extensions/:id", (r) => {
    const e = s.get("extension", r.params.id);
    const b = z
      .object({
        enabled: z.boolean().optional(),
        projectIds: z.array(id).optional(),
      })
      .strict()
      .parse(r.body);
    b.projectIds?.forEach((p) => s.get("project", p));
    return s.put("extension", { ...e, ...b });
  });
  route("post", "/api/extensions/:id/rollback", (r) =>
    extensions.rollback(r.params.id, id.parse(r.body.releaseId)),
  );
  route("post", "/api/templates/extract", (r) => {
    const content = text.parse(r.body.content);
    const lines = content.split("\n");
    const template = lines
      .filter((line) => /^#{1,6}\s/.test(line) || /^\|.*\|$/.test(line))
      .join("\n\n");
    check(template, "没有找到章节标题或表头，请粘贴 Markdown PRD");
    return {
      content:
        template +
        "\n\n<!-- 请编辑字段、条件、写作要求和示例，确认后保存。 -->",
      status: "proposal",
    };
  });
  route("patch", "/api/plugins/:id", (r) => {
    registry.get(r.params.id);
    const b = z
      .object({ enabled: z.boolean(), projectIds: z.array(id) })
      .strict()
      .parse(r.body);
    b.projectIds.forEach((p) => s.get("project", p));
    return s.put("pluginConfig", { id: r.params.id, ...b });
  });
  route("patch", "/api/settings", (r) => {
    const b = z
      .object({
        model: modelSchema.optional(),
        executor: executorSchema.optional(),
        reasoningEffort: effortSchema.optional(),
        codexEnabled: z.boolean().optional(),
        authorizedRoots: z.array(z.string().min(1)).max(20).optional(),
        defaults: assistantSettingsSchema.optional(),
      })
      .strict()
      .parse(r.body);
    return s.put("settings", { ...s.get("settings", "system"), ...b });
  });
  route("post", "/api/codex/login", () => startCodexLogin(root));
  route("post", "/api/codex/logout", () => logoutCodex(root));
  route("get", "/api/status", async () => ({
    codex: await codexStatus(root),
    feishu: await registry.get("feishu").status(),
    storage: root,
    realCallsVerified: false,
  }));
  route("post", "/api/publish/prepare", (r) =>
    delivery.prepare(
      id.parse(r.body.requirementId),
      id.parse(r.body.versionId),
      text.parse(r.body.target),
      z.array(id).default([]).parse(r.body.attachmentIds),
      z.boolean().default(false).parse(r.body.includePrototype),
    ),
  );
  route("post", "/api/publish/confirm", (r) =>
    delivery.publish(id.parse(r.body.approvalId)),
  );
  route("post", "/api/publications/:id/reconcile", (r) =>
    delivery.reconcile(
      r.params.id,
      text.parse(r.body.remoteId),
      z.boolean().default(false).parse(r.body.attachmentsConfirmed),
    ),
  );
  route("post", "/api/publications/:id/remote-preview", (r) =>
    delivery.previewRemote(r.params.id),
  );
  route("post", "/api/publish/accept-remote", (r) =>
    delivery.acceptRemote(id.parse(r.body.ticketId)),
  );
  route("get", "/api/audit", () =>
    s.db.prepare("SELECT * FROM audit ORDER BY at DESC LIMIT 100").all(),
  );
  app.use("/api", (_req, res) => res.status(404).json({ error: "接口不存在" }));
  app.use((err: any, _req: any, res: any, _next: any) =>
    res
      .status(
        err instanceof Fault
          ? err.status
          : err instanceof z.ZodError
            ? 400
            : 500,
      )
      .json({
        error: redact(
          err instanceof z.ZodError
            ? err.issues
                .map((i) => i.path.join(".") + ": " + i.message)
                .join("; ")
            : err.message || "内部错误",
        ),
      }),
  );
  return { app, s, domain, extensions, knowledge, tasks, delivery, registry };
}
