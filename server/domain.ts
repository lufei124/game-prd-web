import { z } from "zod";
import { Store, check, uid, now, hash } from "./db.ts";

export const kindSchema = z.enum(["requirement", "prototype", "prd", "review"]);
export type ArtifactKind = z.infer<typeof kindSchema>;

export const prototypeSchema = z.object({
  schemaVersion: z.literal("1.0"),
  requirementName: z.string().min(1),
  module: z.string().min(1),
  prototypeVersion: z.string().regex(/^v\d+(?:\.\d+)+$/),
  prototypeStatus: z.enum(["Draft", "Confirmed"]),
  device: z.object({
    orientation: z.enum(["portrait", "landscape"]),
    platform: z.array(z.string().min(1)).min(1),
  }),
  scope: z.object({
    included: z.array(z.string()).min(1),
    excluded: z.array(z.string()),
  }),
  pages: z
    .array(z.object({ id: z.string().min(1), name: z.string().min(1) }))
    .min(1),
  scenarios: z
    .array(
      z.object({
        id: z.string().min(1),
        entry: z.string().min(1),
        flow: z.array(z.string()).min(1),
        result: z.string().min(1),
      }),
    )
    .min(1),
  states: z
    .array(z.object({ id: z.string().min(1), description: z.string().min(1) }))
    .min(1),
  decisions: z.array(
    z.object({
      id: z.string().regex(/^D-\d{3}$/),
      summary: z.string().min(1),
      status: z.enum(["待确认", "已确认", "已排除", "已替代"]),
    }),
  ),
});

export const reviewSchema = z.object({
  issues: z.array(
    z.object({
      id: z.string(),
      severity: z.enum(["critical", "major", "minor"]),
      description: z.string(),
      suggestion: z.string(),
      sourceRole: z.string().min(1).optional(),
    }),
  ),
  summary: z.string(),
});

export type Version = {
  id: string;
  requirementId: string;
  kind: ArtifactKind;
  number: number;
  content: string;
  metadata: any;
  parentId: string | null;
  links: any;
  createdAt: string;
  actor: string;
  hash: string;
  taskId?: string;
};

export type Requirement = {
  id: string;
  projectId: string;
  name: string;
  mode: "full" | "prototype" | "review" | "publish";
  heads: Partial<Record<ArtifactKind, string>>;
  confirmed: Partial<Record<ArtifactKind, string>>;
  waiver?: { requirementVersion: string; reason: string; at: string };
  finalVersion?: string;
  stale: boolean;
  createdAt: string;
};

export class Domain {
  constructor(public s: Store) {}

  project(name: string) {
    check(name.trim(), "请输入项目名称");
    return this.s.put("project", {
      id: uid(),
      name: name.trim(),
      defaults: {},
      createdAt: now(),
    });
  }

  deleteProject(id: string, confirmedName: string, actor = "user") {
    check(actor === "user", "只有用户可以删除项目", 403);
    return this.s.tx(() => {
      const project = this.s.get("project", id);
      check(confirmedName === project.name, "请输入完整项目名称确认删除", 409);
      check(
        !this.s
          .all("task")
          .some(
            (t) =>
              t.projectId === id &&
              ["queued", "running", "waiting"].includes(t.status),
          ),
        "项目有未结束的任务，请先取消任务",
        409,
      );
      const ids = new Set(
        this.s
          .all("requirement")
          .filter((x) => x.projectId === id)
          .map((x) => x.id),
      );
      check(
        !this.s
          .all("publication")
          .some((x) => ids.has(x.requirementId) && x.status === "writing"),
        "项目正在发布，请等待发布结束",
        409,
      );
      const entries = (
        this.s.db.prepare("SELECT kind,data FROM entities").all() as any[]
      )
        .map((x) => ({ kind: x.kind, data: JSON.parse(x.data) }))
        .filter(
          (x) =>
            (x.kind === "project" && x.data.id === id) ||
            x.data.projectId === id ||
            ids.has(x.data.requirementId),
        );
      this.s.put("projectTrash", {
        id,
        name: project.name,
        deletedAt: now(),
        entries,
      });
      for (const x of entries) this.s.remove(x.kind, x.data.id);
      this.s.audit(actor, "project.delete", id, {
        name: project.name,
        entries: entries.length,
      });
      return { id, deleted: true };
    });
  }

  restoreProject(id: string, actor = "user") {
    check(actor === "user", "只有用户可以恢复项目", 403);
    return this.s.tx(() => {
      const trash = this.s.get("projectTrash", id);
      check(!trash.purging, "项目正在永久删除，请重试清理，不能恢复", 409);
      for (const x of trash.entries) {
        check(
          !this.s.maybe(x.kind, x.data.id),
          "恢复目标已存在，不能覆盖",
          409,
        );
        this.s.put(x.kind, x.data);
      }
      this.s.remove("projectTrash", id);
      this.s.audit(actor, "project.restore", id);
      return this.s.get("project", id);
    });
  }

  requirement(
    projectId: string,
    name: string,
    mode: Requirement["mode"] = "full",
  ) {
    this.s.get("project", projectId);
    check(name.trim(), "请输入需求名称");
    return this.s.put("requirement", {
      id: uid(),
      projectId,
      name,
      mode,
      heads: {},
      confirmed: {},
      stale: false,
      createdAt: now(),
    });
  }

  versions(id: string) {
    return this.s.all<Version>("version").filter((v) => v.requirementId === id);
  }

  conversationStage(r: Requirement) {
    if (r.mode === "prototype") return "prototype";
    if (r.mode === "review") return r.heads.prd ? "review" : "prd";
    if (r.mode === "publish") return "prd";
    if (!r.heads.requirement || r.confirmed.requirement !== r.heads.requirement)
      return "requirement";
    if (!r.heads.prototype || r.confirmed.prototype !== r.heads.prototype) {
      if (r.waiver?.requirementVersion !== r.heads.requirement)
        return "prototype";
    }
    return "prd";
  }

  stage(r: Requirement) {
    if (r.mode === "prototype")
      return r.heads.prototype && r.heads.prototype === r.confirmed.prototype
        ? "原型任务完成"
        : "原型生成与迭代";
    if (r.finalVersion && r.finalVersion === r.heads.prd && !r.stale)
      return "终稿 / 飞书交付";
    if (r.stale) return "PRD 待同步";
    if (r.heads.prd) return "PRD 编写与评审";
    if (
      (r.confirmed.prototype === r.heads.prototype && r.heads.prototype) ||
      r.waiver
    )
      return "原型已确认 / 编写 PRD";
    if (r.heads.prototype) return "原型生成与迭代";
    if (r.confirmed.requirement === r.heads.requirement && r.heads.requirement)
      return "需求已确认 / 生成原型";
    return "需求整理与确认";
  }

  gate(r: Requirement, kind: ArtifactKind) {
    if (r.mode === "prototype") {
      check(kind === "prototype", "仅原型任务不创建无关成果");
      return;
    }
    if (r.mode === "review" || r.mode === "publish") {
      check(kind === "prd" || kind === "review", "独立评审/发布任务只接受 PRD");
      return;
    }
    if (kind === "prototype" && r.mode === "full")
      check(
        r.heads.requirement && r.heads.requirement === r.confirmed.requirement,
        "请先确认当前需求版本",
        409,
      );
    if (kind === "prd") {
      check(
        r.heads.requirement && r.heads.requirement === r.confirmed.requirement,
        "请先确认当前需求版本",
        409,
      );
      check(
        (r.heads.prototype && r.heads.prototype === r.confirmed.prototype) ||
          r.waiver?.requirementVersion === r.heads.requirement,
        "请确认当前原型，或由用户确认本需求无 UI 变化并豁免",
        409,
      );
    }
    if (kind === "review") check(r.heads.prd, "请先提供 PRD", 409);
  }

  save(
    id: string,
    kind: ArtifactKind,
    content: string,
    base: string | null,
    metadata: any = {},
    actor = "user",
    taskId?: string,
    linksOverride?: any,
  ): Version {
    check(content.trim(), "内容不能为空");
    check(content.length <= 2_000_000, "成果超过 2MB");
    return this.s.tx(() => {
      const r = this.s.get<Requirement>("requirement", id);
      check(
        (r.heads[kind] || null) === base,
        "基础版本已变化，内容已保留在任务候选中，请比较后重新提交",
        409,
      );
      this.gate(r, kind);
      if (kind === "prototype") {
        metadata = prototypeSchema.parse(metadata);
        const embedded = content.match(
          /<script[^>]*id=["']prototype-meta["'][^>]*>([\s\S]*?)<\/script>/i,
        );
        check(embedded, "HTML 缺少 prototype-meta");
        check(
          JSON.stringify(prototypeSchema.parse(JSON.parse(embedded[1]))) ===
            JSON.stringify(metadata),
          "HTML metadata 与结构化产物不一致",
        );
        for (const key of ["pages", "scenarios", "states", "decisions"])
          check(
            new Set(metadata[key].map((x: any) => x.id)).size ===
              metadata[key].length,
            `${key} ID 重复`,
          );
        check(
          /<html[\s>]/i.test(content) && /<script[\s>]/i.test(content),
          "原型必须是带交互脚本的自包含 HTML",
        );
        check(
          !/<(?:iframe|object|embed|base)\b/i.test(content),
          "原型不允许嵌套框架或外部对象",
        );
        check(
          !/(?:src|href|action)\s*=\s*["']\s*(?:https?:)?\/\//i.test(content),
          "原型不允许外部网络资源",
        );
      }
      if (kind === "review") {
        metadata = reviewSchema.parse(metadata);
        const prd = this.s.get<Version>("version", r.heads.prd!);
        metadata.issues.push(
          ...completeness(prd.content).filter(
            (x) => !metadata.issues.some((i: any) => i.id === x.id),
          ),
        );
      }
      if (kind === "prd" && actor === "user" && base && !linksOverride)
        linksOverride = this.s.get<Version>("version", base).links;
      const v: Version = {
        id: uid(),
        requirementId: id,
        kind,
        number: this.versions(id).filter((v) => v.kind === kind).length + 1,
        content,
        metadata,
        parentId: base,
        links: linksOverride || {
          requirement: r.heads.requirement || null,
          prototype: r.heads.prototype || null,
          prd: r.heads.prd || null,
        },
        createdAt: now(),
        actor,
        hash: hash(content + JSON.stringify(metadata)),
        taskId,
      };
      this.s.put("version", v);
      r.heads[kind] = v.id;
      delete r.confirmed[kind];
      if (kind === "requirement") {
        delete r.confirmed.prototype;
        delete r.waiver;
      }
      if ((kind === "prototype" || kind === "requirement") && r.heads.prd)
        r.stale = true;
      if (kind === "prd") {
        r.stale =
          r.mode === "full" &&
          (v.links.requirement !== (r.heads.requirement || null) ||
            v.links.prototype !== (r.heads.prototype || null));
        delete r.confirmed.review;
      }
      this.s.put("requirement", r);
      this.s.audit(actor, "version.create", id, {
        versionId: v.id,
        kind,
        base,
      });
      return v;
    });
  }

  confirm(id: string, kind: ArtifactKind, versionId: string, actor = "user") {
    check(actor === "user", "Agent 无权确认成果", 403);
    return this.s.tx(() => {
      const r = this.s.get<Requirement>("requirement", id);
      check(r.heads[kind] === versionId, "只能确认当前成果版本", 409);
      const v = this.s.get<Version>("version", versionId);
      this.gate(r, kind);
      if (kind === "prototype" && r.mode === "full")
        check(
          v.links.requirement === r.heads.requirement,
          "原型关联的是旧需求版本，请先同步原型",
          409,
        );
      if (kind === "prototype")
        check(
          !v.metadata.decisions.some((d: any) => d.status === "待确认"),
          "原型仍有待确认的业务决策，请先解决",
          409,
        );
      r.confirmed[kind] = versionId;
      this.s.put("requirement", r);
      this.s.put("confirmation", {
        id: uid(),
        requirementId: id,
        kind,
        versionId,
        actor,
        createdAt: now(),
      });
      this.s.audit(actor, "confirm", id, { kind, versionId });
      return r;
    });
  }

  waive(id: string, versionId: string, reason: string, actor = "user") {
    check(actor === "user", "Agent 无权豁免原型", 403);
    check(reason.trim(), "请说明无 UI/交互变化的依据");
    const r = this.s.get<Requirement>("requirement", id);
    check(
      r.heads.requirement === versionId &&
        r.confirmed.requirement === versionId,
      "请先确认当前需求",
      409,
    );
    r.waiver = { requirementVersion: versionId, reason, at: now() };
    this.s.put("requirement", r);
    this.s.audit(actor, "prototype.waive", id, r.waiver);
    return r;
  }

  private prdLineage(versionId: string) {
    const ids = new Set<string>();
    let current: Version | undefined = this.s.get<Version>(
      "version",
      versionId,
    );
    while (current && current.kind === "prd" && !ids.has(current.id)) {
      ids.add(current.id);
      if (!current.parentId) break;
      const parentVersion: Version | undefined = this.s.maybe<Version>(
        "version",
        current.parentId,
      );
      if (!parentVersion || parentVersion.kind !== "prd") break;
      current = parentVersion;
    }
    return ids;
  }

  finalize(id: string, versionId: string, actor = "user") {
    check(actor === "user", "Agent 无权确认终稿", 403);
    const r = this.s.get<Requirement>("requirement", id);
    check(r.heads.prd === versionId && !r.stale, "PRD 版本已变化或待同步", 409);
    this.gate(r, "prd");

    const lineage = this.prdLineage(versionId);
    const relevantReviews = this.versions(id)
      .filter(
        (v) =>
          v.kind === "review" &&
          typeof v.links?.prd === "string" &&
          lineage.has(v.links.prd),
      )
      .sort((a, b) => b.number - a.number);
    const review = relevantReviews[0] || null;
    if (review) {
      const resolutions = this.s
        .all("resolution")
        .filter((x) => x.reviewId === review.id);
      check(
        review.metadata.issues.every((issue: any) =>
          resolutions.some((decision) => decision.issueId === issue.id),
        ),
        "评审问题需逐项选择采纳、不采纳或稍后处理",
        409,
      );
    }

    const reviewStatus = !review
      ? "skipped"
      : review.links.prd === versionId
        ? "reviewed"
        : "reviewed_then_modified";

    r.finalVersion = versionId;
    this.s.put("requirement", r);
    this.s.put("confirmation", {
      id: uid(),
      requirementId: id,
      kind: "final",
      versionId,
      actor,
      reviewStatus,
      reviewVersionId: review?.id || null,
      reviewedPrdVersionId: review?.links?.prd || null,
      createdAt: now(),
    });
    this.s.audit(actor, "prd.finalize", id, {
      versionId,
      reviewStatus,
      reviewVersionId: review?.id || null,
      reviewedPrdVersionId: review?.links?.prd || null,
    });
    return r;
  }

  restore(id: string, versionId: string, base: string | null) {
    const v = this.s.get<Version>("version", versionId);
    check(v.requirementId === id, "不能恢复其他需求的版本", 403);
    return this.save(
      id,
      v.kind,
      v.content,
      base,
      v.metadata,
      "user",
      undefined,
      { ...v.links, restoredFrom: v.id },
    );
  }

  annotate(id: string, versionId: string, pageId: string, text: string) {
    const v = this.s.get<Version>("version", versionId);
    check(
      v.requirementId === id && v.kind === "prototype",
      "原型归属不匹配",
      403,
    );
    check(
      v.metadata.pages.some((x: any) => x.id === pageId),
      "页面不存在",
    );
    check(text.trim(), "批注不能为空");
    return this.s.put("annotation", {
      id: uid(),
      requirementId: id,
      versionId,
      pageId,
      text,
      createdAt: now(),
    });
  }
}

export function completeness(content: string) {
  const issues: any[] = [];
  const add = (id: string, description: string) =>
    issues.push({
      id,
      severity: "major",
      description,
      suggestion: "补充具体规则与可观察的验收依据，或记录用户裁决。",
    });
  if (!/R-\d{3}/.test(content)) add("CHECK-RULES", "未发现稳定的业务规则编号");
  if (!/AC-\d{3}/.test(content)) add("CHECK-AC", "未发现可追溯的验收标准编号");
  if (!/异常|失败|错误|边界|exception|failure|boundary/i.test(content))
    add("CHECK-BOUNDARY", "未识别异常或边界处理内容");
  if (/待确认|待补充|\bTODO\b|\bTBD\b/i.test(content))
    add("CHECK-PENDING", "文档仍有未确认或未补充内容");
  return issues;
}
