import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Store, check, uid, now, hash } from "./db.ts";
import { redact } from "./tasks.ts";
const exec = promisify(execFile);
// Markdown rendering may change punctuation and whitespace, but may not omit
// the document's words, rules or ordering while retaining only the marker.
export function verifyRemoteBody(expected: string, actual: string) {
  const normalized = (s: string) =>
    s
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}]/gu, "")
      .toLowerCase();
  return normalized(actual).includes(normalized(expected));
}
export interface RemoteDoc {
  id: string;
  content: string;
  revision: number;
  url?: string;
}
export interface DeliveryPlugin {
  attach?(
    id: string,
    path: string,
    type: "image" | "file",
    caption: string,
  ): Promise<void>;
  id: string;
  name: string;
  capabilities: string[];
  permissions: string[];
  status(): Promise<any>;
  fetch(id: string): Promise<RemoteDoc>;
  create(
    title: string,
    content: string,
    target: string,
  ): Promise<{ id: string; url?: string }>;
  update(id: string, content: string, revision: number): Promise<void>;
}
export class PluginRegistry {
  private plugins = new Map<string, DeliveryPlugin>();
  register(plugin: DeliveryPlugin) {
    check(!this.plugins.has(plugin.id), "重复插件");
    this.plugins.set(plugin.id, plugin);
  }
  get(id: string) {
    const p = this.plugins.get(id);
    check(p, "插件未注册", 404);
    return p;
  }
  list() {
    return [...this.plugins.values()].map(
      ({ id, name, capabilities, permissions }) => ({
        id,
        name,
        capabilities,
        permissions,
      }),
    );
  }
}
export function docToken(s: string) {
  if (/^https:\/\//.test(s)) {
    const u = new URL(s);
    check(
      /(^|\.)(feishu\.cn|larksuite\.com)$/.test(u.hostname),
      "只允许飞书官方文档 URL",
    );
    const m = u.pathname.match(/\/(?:docx|wiki)\/([a-zA-Z0-9]+)/);
    check(m, "无效飞书文档 URL");
    return m[1];
  }
  check(/^[a-zA-Z0-9]{5,100}$/.test(s), "无效文档/文件夹 token");
  return s;
}
export class LarkPlugin implements DeliveryPlugin {
  id = "feishu";
  name = "飞书 · lark-cli";
  capabilities = ["document.import", "prd.publish", "prd.update"];
  permissions = [
    "docx:document:readonly",
    "docx:document:create",
    "docx:document:write_only",
  ];
  constructor(private root: string) {}
  async command(args: string[], cwd = this.root) {
    try {
      const { stdout } = await exec("lark-cli", args, {
        cwd,
        timeout: 90000,
        maxBuffer: 8 * 1024 * 1024,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          LANG: process.env.LANG,
        },
      });
      const data = JSON.parse(stdout);
      check(
        data.code === undefined || data.code === 0,
        data.msg || "飞书 API 错误",
      );
      return data;
    } catch (e) {
      throw new Error(redact(e instanceof Error ? e.message : "lark-cli 失败"));
    }
  }
  async status() {
    try {
      const r = await this.command([
        "auth",
        "check",
        "--scope",
        this.permissions.join(" "),
        "--json",
      ]);
      return {
        state: r.ok ? "configured" : "needs_permission",
        detail: r.ok
          ? "本机 lark-cli 已授权；远端发布待实测"
          : `缺少权限：${(r.missing || []).join(", ")}`,
        missing: r.missing || [],
      };
    } catch (e) {
      return { state: "unconfigured", detail: (e as Error).message };
    }
  }
  async fetch(id: string): Promise<RemoteDoc> {
    const r = await this.command([
      "docs",
      "+fetch",
      "--doc",
      docToken(id),
      "--doc-format",
      "markdown",
      "--detail",
      "full",
      "--scope",
      "full",
      "--format",
      "json",
    ]);
    const d = r.document || r.data?.document || r.data || r;
    const content = d.content || d.markdown;
    const revision = d.revision_id ?? d.revisionId ?? d.revision;
    check(
      typeof content === "string",
      "当前 lark-cli 响应未识别 Markdown 内容，适配待实测",
      502,
    );
    return {
      id: d.document_id || docToken(id),
      content,
      revision:
        Number.isInteger(Number(revision)) && revision !== undefined
          ? Number(revision)
          : -1,
      url: d.url || d.document_url,
    };
  }
  async payload(content: string) {
    const dir = join(this.root, "delivery", uid());
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(join(dir, "prd.md"), content, { mode: 0o600 });
    return dir;
  }
  async create(title: string, content: string, target: string) {
    const cwd = await this.payload(content);
    const args = [
      "docs",
      "+create",
      "--doc-format",
      "markdown",
      "--title",
      title,
      "--content",
      "@prd.md",
      "--format",
      "json",
    ];
    if (target === "my_library") args.push("--parent-position", "my_library");
    else args.push("--parent-token", docToken(target));
    const r = await this.command(args, cwd).finally(() =>
      rm(cwd, { recursive: true, force: true }),
    );
    const d = r.document || r.data?.document || r.data || r;
    check(
      d.document_id,
      "飞书创建结果未返回 document_id；请核验远端，勿重复创建",
      502,
    );
    return { id: d.document_id, url: d.url || d.document_url };
  }
  async attach(
    id: string,
    file: string,
    type: "image" | "file",
    caption: string,
  ) {
    await this.command([
      "docs",
      "+media-insert",
      "--doc",
      docToken(id),
      "--file",
      file,
      "--type",
      type,
      ...(type === "image" ? ["--caption", caption] : []),
      "--format",
      "json",
    ]);
  }
  async update(id: string, content: string, revision: number) {
    check(
      revision >= 0,
      "飞书未提供可校验版本号，禁止覆盖，需核对 CLI 兼容性",
      409,
    );
    const cwd = await this.payload(content);
    await this.command(
      [
        "docs",
        "+update",
        "--doc",
        docToken(id),
        "--command",
        "overwrite",
        "--doc-format",
        "markdown",
        "--content",
        "@prd.md",
        "--revision-id",
        String(revision),
        "--format",
        "json",
      ],
      cwd,
    ).finally(() => rm(cwd, { recursive: true, force: true }));
  }
}
export class Delivery {
  locks = new Set<string>();
  constructor(
    public s: Store,
    public plugins: PluginRegistry,
  ) {}
  async prepare(
    requirementId: string,
    versionId: string,
    target: string,
    attachmentIds: string[] = [],
    includePrototype = false,
  ) {
    const r = this.s.get("requirement", requirementId);
    const config = this.s.maybe("pluginConfig", "feishu");
    check(!config || config.enabled, "飞书插件已停用", 409);
    check(
      !config?.projectIds?.length || config.projectIds.includes(r.projectId),
      "飞书插件未绑定当前项目",
      403,
    );
    check(
      r.finalVersion === versionId && r.heads.prd === versionId && !r.stale,
      "只能发布当前有效终稿",
      409,
    );
    if (target !== "my_library") docToken(target);
    const plugin = this.plugins.get("feishu");
    const status = await plugin.status();
    check(status.state === "configured", status.detail, 409);
    const previous = this.s
      .all("publication")
      .filter(
        (p) =>
          p.requirementId === requirementId &&
          p.target === target &&
          p.status === "published",
      )
      .at(-1);
    const unfinished = this.s
      .all("publication")
      .find(
        (p) =>
          p.requirementId === requirementId &&
          p.target === target &&
          ["writing", "uncertain", "conflict"].includes(p.status),
      );
    check(
      !unfinished,
      "上次发布结果待核验，请先填写远端文档 ID 核验，不会重复创建",
      409,
    );
    let remote: RemoteDoc | undefined;
    if (previous) {
      remote = await plugin.fetch(previous.remoteId);
      const baseline = this.s.maybe(
        "remoteBaseline",
        hash(requirementId + "|" + target),
      );
      const expected =
        baseline?.versionId === versionId &&
        baseline?.publicationId === previous.id
          ? baseline.remoteHash
          : previous.remoteHash;
      check(
        hash(remote.content) === expected,
        "检测到飞书远端修改，请先导入远端版本并人工合并",
        409,
      );
      check(remote.revision >= 0, "缺少远端版本号，禁止静默覆盖", 409);
    }
    const v = this.s.get("version", versionId);
    check(
      !/https?:\/\/(localhost|127\.0\.0\.1)([:/]|\b)/.test(v.content),
      "PRD 含本机地址，不能作为分享链接发布",
    );
    const attachments = attachmentIds.map((id) => {
      const k = this.s.get("knowledge", id);
      check(
        k.projectId === r.projectId &&
          (!k.requirementId || k.requirementId === r.id),
        "附件不属于此项目/需求",
        403,
      );
      return {
        id: k.id,
        name: k.name,
        hash: k.hash,
        type: k.status === "image" ? "image" : "file",
      };
    });
    if (includePrototype) {
      check(v.links.prototype, "PRD 没有关联原型");
      const proto = this.s.get("version", v.links.prototype);
      attachments.push({
        id: proto.id,
        name: "prototype-v" + proto.number + ".html",
        hash: proto.hash,
        type: "prototype",
      });
    }
    const approval = {
      attachments,
      id: uid(),
      requirementId,
      versionId,
      target,
      hash: v.hash,
      remoteId: remote?.id || null,
      remoteRevision: remote?.revision,
      remoteHash: remote ? hash(remote.content) : null,
      status: "pending",
      expires: Date.now() + 10 * 60_000,
      createdAt: now(),
    };
    this.s.put("publishApproval", approval);
    return {
      ...approval,
      content: v.content,
      operation: remote
        ? "更新（整体替换文档正文，已有评论/图片可能受影响）"
        : "创建",
      previousUrl: previous?.url,
    };
  }
  async publish(approvalId: string, actor = "user") {
    check(actor === "user", "发布只能由用户确认", 403);
    const a = this.s.get("publishApproval", approvalId);
    const key = hash(a.requirementId + "|" + a.versionId + "|" + a.target);
    const existing = this.s.maybe("publication", key);
    if (existing?.status === "published") return existing;
    check(!this.locks.has(a.requirementId), "同需求正在发布", 409);
    check(
      a.status === "pending" && a.expires > Date.now(),
      "发布确认已失效，请重新预览",
      409,
    );
    const r = this.s.get("requirement", a.requirementId),
      v = this.s.get("version", a.versionId);
    check(
      r.finalVersion === a.versionId &&
        r.heads.prd === a.versionId &&
        !r.stale &&
        v.hash === a.hash,
      "成果变化，需重新确认发布",
      409,
    );
    check(
      !existing || existing.status === "failed",
      "发布结果未确认，必须先核验远端",
      409,
    );
    this.locks.add(a.requirementId);
    let writing = false;
    const record = {
      attachments: a.attachments || [],
      attachmentResults: [] as any[],
      id: key,
      requirementId: a.requirementId,
      versionId: a.versionId,
      target: a.target,
      remoteId: a.remoteId,
      status: "writing",
      marker: "WB-" + key.slice(0, 16),
      createdAt: now(),
    };
    try {
      const plugin = this.plugins.get("feishu");
      if (a.remoteId) {
        const remote = await plugin.fetch(a.remoteId);
        check(
          hash(remote.content) === a.remoteHash &&
            remote.revision === a.remoteRevision,
          "远端在确认后发生修改，已阻止覆盖",
          409,
        );
      }
      this.s.put("publication", record);
      this.s.put("publishApproval", { ...a, status: "consumed" });
      writing = true;
      const config = this.s.maybe("pluginConfig", "feishu");
      check(!config || config.enabled, "飞书插件已停用", 409);
      check(
        !config?.projectIds?.length || config.projectIds.includes(r.projectId),
        "插件项目授权已变化",
        403,
      );
      const content = v.content + `\n\n---\n交付标识：${record.marker}\n`;
      let result: { id: string; url?: string };
      if (a.remoteId) {
        await plugin.update(a.remoteId, content, a.remoteRevision);
        result = { id: a.remoteId };
      } else
        result = await plugin.create(
          r.name + " [" + record.marker + "]",
          content,
          a.target,
        );
      this.s.put("publication", {
        ...record,
        remoteId: result.id,
        url: result.url,
        status: "uncertain",
      });
      for (const attachment of record.attachments) {
        check(plugin.attach, "插件未提供附件能力");
        const dir = join(this.s.root, "delivery", key);
        await mkdir(dir, { recursive: true, mode: 0o700 });
        const file = join(
          dir,
          attachment.id +
            (attachment.type === "prototype"
              ? ".html"
              : attachment.type === "image"
                ? "." + attachment.name.split(".").at(-1)
                : ".bin"),
        );
        const bytes =
          attachment.type === "prototype"
            ? Buffer.from(this.s.get("version", attachment.id).content)
            : await readFile(join(this.s.root, "files", attachment.id));
        await writeFile(file, bytes, { mode: 0o600 });
        await plugin.attach(
          result.id,
          file,
          attachment.type === "image" ? "image" : "file",
          attachment.name,
        );
        record.attachmentResults.push({
          id: attachment.id,
          status: "attached",
        });
        this.s.put("publication", {
          ...this.s.get("publication", key),
          attachmentResults: record.attachmentResults,
        });
      }
      const remote = await plugin.fetch(result.id);
      check(
        verifyRemoteBody(v.content, remote.content),
        "远端回读内容与所选文档版本不一致，请核验；不会认定发布成功",
        502,
      );
      check(
        remote.content.includes(record.marker),
        "写入后回读未发现交付标识，需人工核验",
        502,
      );
      const published = {
        ...record,
        status: "published",
        remoteId: result.id,
        url: result.url || remote.url,
        remoteHash: hash(remote.content),
        remoteRevision: remote.revision,
        verifiedAt: now(),
      };
      this.s.put("publication", published);
      this.s.audit(actor, "feishu.publish", a.requirementId, {
        publicationId: key,
        versionId: a.versionId,
        target: a.target,
      });
      return published;
    } catch (e) {
      if (writing)
        this.s.put("publication", {
          ...this.s.get("publication", key),
          status: "uncertain",
          error: (e as Error).message,
        });
      throw e;
    } finally {
      this.locks.delete(a.requirementId);
    }
  }
  async previewRemote(publicationId: string) {
    const p = this.s.get("publication", publicationId);
    check(p.remoteId, "没有远端文档 ID");
    const remote = await this.plugins.get("feishu").fetch(p.remoteId);
    check(remote.revision >= 0, "缺少远端版本号，不能建立更新基线", 409);
    const req = this.s.get("requirement", p.requirementId);
    const ticket = {
      id: uid(),
      publicationId,
      requirementId: req.id,
      versionId: req.heads.prd,
      target: p.target,
      remoteId: remote.id,
      remoteHash: hash(remote.content),
      revision: remote.revision,
      content: remote.content,
      expires: Date.now() + 600000,
      status: "pending",
    };
    this.s.put("remoteApproval", ticket);
    return ticket;
  }
  async acceptRemote(ticketId: string) {
    const a = this.s.get("remoteApproval", ticketId);
    check(
      a.status === "pending" && a.expires > Date.now(),
      "冲突确认已过期",
      409,
    );
    const req = this.s.get("requirement", a.requirementId);
    check(
      req.finalVersion === a.versionId &&
        req.heads.prd === a.versionId &&
        !req.stale,
      "请先把合并后的当前 PRD 确认为终稿，再确认远端基线",
      409,
    );
    const remote = await this.plugins.get("feishu").fetch(a.remoteId);
    check(
      hash(remote.content) === a.remoteHash && remote.revision === a.revision,
      "远端再次变化，请重新核对",
      409,
    );
    const baseline = {
      ...a,
      id: hash(a.requirementId + "|" + a.target),
      acceptedAt: now(),
    };
    this.s.put("remoteBaseline", baseline);
    this.s.put("remoteApproval", { ...a, status: "accepted" });
    this.s.audit("user", "feishu.remote-baseline", a.requirementId, {
      publicationId: a.publicationId,
      versionId: a.versionId,
      remoteHash: a.remoteHash,
    });
    return baseline;
  }
  async reconcile(id: string, remoteId: string, attachmentsConfirmed = false) {
    const p = this.s.get("publication", id);
    check(
      attachmentsConfirmed ||
        !p.attachments?.length ||
        p.attachmentResults?.length === p.attachments.length,
      "附件写入结果不确定，请在飞书中核验附件后再处理；不会重复插入",
      409,
    );
    check(
      ["uncertain", "writing", "conflict"].includes(p.status),
      "无待核验发布",
      409,
    );
    const remote = await this.plugins.get("feishu").fetch(docToken(remoteId));
    check(
      verifyRemoteBody(
        this.s.get("version", p.versionId).content,
        remote.content,
      ),
      "远端正文与本次文档版本不一致，不能认定成功",
      409,
    );
    check(
      remote.content.includes(p.marker),
      "远端没有本次交付标识，不能认定成功",
      409,
    );
    if (attachmentsConfirmed)
      this.s.audit("user", "feishu.attachments-confirmed", id, {
        attachmentIds: p.attachments?.map((x: any) => x.id),
      });
    const result = {
      ...p,
      status: "published",
      attachmentsVerifiedByUser: attachmentsConfirmed,
      remoteId: remote.id,
      url: remote.url,
      remoteHash: hash(remote.content),
      remoteRevision: remote.revision,
      verifiedAt: now(),
    };
    this.s.put("publication", result);
    return result;
  }
}
