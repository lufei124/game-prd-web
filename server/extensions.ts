import { readFile, readdir, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import yauzl from "yauzl";
import { z } from "zod";
import { Store, uid, now, check, hash } from "./db.ts";
export type Files = Record<string, string>;
const MAX = 20 * 1024 * 1024;
export function safeName(name: string) {
  check(
    name.length > 0 &&
      !name.includes("\\") &&
      !name.includes("\0") &&
      !path.posix.isAbsolute(name) &&
      !name.split("/").some((x) => x === ".." || x.startsWith(".")) &&
      !/^[a-z]:/i.test(name),
    `不安全的文件路径: ${name}`,
  );
  return name;
}
export async function directoryFiles(
  input: string,
  roots: string[],
): Promise<Files> {
  const root = await realpath(input);
  const allowed = await Promise.all(
    roots.map((x) => realpath(x).catch(() => "")),
  );
  check(
    allowed.some((x) => x && (root === x || root.startsWith(x + path.sep))),
    "目录未获授权，请在设置中添加准确的导入目录",
    403,
  );
  check(!(await lstat(input)).isSymbolicLink(), "不允许软链接");
  const files: Files = {};
  let size = 0;
  async function walk(dir: string, prefix = "") {
    for (const f of await readdir(dir, { withFileTypes: true })) {
      if (
        f.name.startsWith(".") ||
        ["node_modules", "dist", "history"].includes(f.name)
      )
        continue;
      const name = safeName(prefix + f.name);
      const file = path.join(dir, f.name);
      check(!f.isSymbolicLink(), "导入不允许软链接");
      if (f.isDirectory()) await walk(file, name + "/");
      else if (f.isFile()) {
        const stat = await lstat(file);
        size += stat.size;
        check(
          size <= MAX && Object.keys(files).length < 600,
          "导入超过 20MB 或 600 个文件",
        );
        files[name] = (await readFile(file)).toString("base64");
      }
    }
  }
  await walk(root);
  return files;
}
export function unzip(buffer: Buffer): Promise<Files> {
  check(buffer.length <= MAX, "ZIP 超过 20MB");
  return new Promise((resolve, reject) =>
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true },
      (err, zip) => {
        if (err || !zip) return reject(err);
        const files: Files = {};
        let total = 0,
          count = 0;
        let done = false;
        const fail = (e: any) => {
          if (!done) {
            done = true;
            zip.close();
            reject(e);
          }
        };
        zip.on("error", fail);
        zip.on("end", () => {
          if (!done) {
            done = true;
            resolve(files);
          }
        });
        zip.on("entry", (entry: yauzl.Entry) => {
          try {
            check(++count <= 600, "ZIP 文件数量超限");
            if (
              entry.fileName
                .split("/")
                .some((x) => x.startsWith(".") && x !== "." && x !== "..")
            ) {
              zip.readEntry();
              return;
            }
            safeName(entry.fileName);
            check((entry.generalPurposeBitFlag & 1) === 0, "不支持加密 ZIP");
            check(
              ((entry.externalFileAttributes >>> 16) & 0xf000) !== 0xa000,
              "ZIP 不允许符号链接",
            );
            total += entry.uncompressedSize;
            check(total <= MAX, "ZIP 解压体积超限");
            if (entry.fileName.endsWith("/")) return zip.readEntry();
            zip.openReadStream(entry, (error, stream) => {
              if (error || !stream) return fail(error);
              const chunks: Buffer[] = [];
              let bytes = 0;
              stream.on("data", (chunk) => {
                bytes += chunk.length;
                if (bytes > entry.uncompressedSize || bytes > MAX)
                  fail(new Error("ZIP 体积异常"));
                else chunks.push(chunk);
              });
              stream.on("error", fail);
              stream.on("end", () => {
                if (!done) {
                  if (files[entry.fileName])
                    return fail(new Error("ZIP 重复文件"));
                  files[entry.fileName] =
                    Buffer.concat(chunks).toString("base64");
                  zip.readEntry();
                }
              });
            });
          } catch (e) {
            fail(e);
          }
        });
        zip.readEntry();
      },
    ),
  );
}
export function githubLocation(url: string) {
  const u = new URL(url);
  check(
    u.protocol === "https:" &&
      u.hostname === "github.com" &&
      !u.port &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash,
    "仅支持公开 GitHub 仓库 HTTPS 链接",
  );
  const parts = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  check(
    parts.length === 2 ||
      (parts.length >= 4 && ["tree", "blob"].includes(parts[2])),
    "请输入仓库链接、tree 子目录链接或 SKILL.md 文件链接",
  );
  const [owner, rawRepo, mode, ref, ...sub] = parts;
  const repo = rawRepo.replace(/\.git$/, "");
  [owner, repo, ...(ref ? [ref] : []), ...sub].forEach(safeName);
  check(
    [owner, repo].every((x) => /^[a-zA-Z0-9_.-]+$/.test(x)),
    "无效仓库名称",
  );
  if (mode === "blob")
    check(sub.pop() === "SKILL.md", "文件链接必须指向 SKILL.md");
  return { owner, repo, ref, sub };
}
export async function githubFiles(url: string): Promise<Files> {
  const { owner, repo, ref, sub } = githubLocation(url);
  // HEAD resolves the repository default branch; explicit tree refs pin the chosen branch or commit.
  const response = await fetch(
    `https://codeload.github.com/${owner}/${repo}/zip/${encodeURIComponent(ref || "HEAD")}`,
    { redirect: "error", signal: AbortSignal.timeout(30000) },
  );
  check(
    response.ok,
    `GitHub 下载失败 ${response.status}：请检查公开仓库地址、分支和访问网络；私有仓库请用本地目录或 ZIP 导入`,
  );
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body! as any) {
    size += chunk.length;
    check(size <= MAX, "仓库 ZIP 超过 20MB，请使用本地子目录");
    chunks.push(chunk);
  }
  return githubArchiveFiles(await unzip(Buffer.concat(chunks)), sub);
}
export function githubArchiveFiles(all: Files, sub: string[]) {
  const files: Files = {};
  const prefix = sub.length ? sub.join("/") + "/" : "";
  for (const [key, val] of Object.entries(all)) {
    const tail = key.split("/").slice(1).join("/");
    if (tail && tail.startsWith(prefix)) files[tail.slice(prefix.length)] = val;
  }
  check(Object.keys(files).length, "GitHub 目录为空，请检查路径");
  const skills = Object.keys(files).filter(
    (x) => x === "SKILL.md" || x.endsWith("/SKILL.md"),
  );
  const pack = Object.keys(files).some((x) => x === "workbench-pack.json");
  check(
    pack || skills.length > 0,
    "目录中没有 SKILL.md，请粘贴包含 Skill 的子目录链接",
  );
  check(
    pack || files["SKILL.md"] || skills.length === 1,
    "仓库含多个 Skill，请指定要导入的 tree 子目录链接，或使用扩展包",
  );
  return files;
}
const metaSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["skill", "style", "template", "plugin"]),
  stages: z
    .array(z.enum(["requirement", "prototype", "prd", "review", "publish"]))
    .default([]),
  dependencies: z.array(z.string()).default([]),
  permissions: z.array(z.string()).default([]),
});
export class Extensions {
  constructor(public s: Store) {}
  install(
    files: Files,
    source: string,
    metadata: any = {},
    existingId?: string,
  ): any {
    check(Object.keys(files).length, "扩展没有文件");
    Object.keys(files).forEach(safeName);
    const bundleKey = Object.keys(files).find(
      (x) => x === "workbench-pack.json" || x.endsWith("/workbench-pack.json"),
    );
    if (bundleKey && !existingId) {
      const pack = z
        .object({
          name: z.string(),
          extensions: z
            .array(z.object({ path: z.string(), metadata: metaSchema }))
            .min(1)
            .max(30),
        })
        .parse(
          JSON.parse(Buffer.from(files[bundleKey], "base64").toString("utf8")),
        );
      const prefix =
        path.posix.dirname(bundleKey) === "."
          ? ""
          : path.posix.dirname(bundleKey) + "/";
      // Validate every entry first, then commit the entire pack atomically.
      const entries = pack.extensions.map((x) => {
        safeName(x.path);
        check(x.metadata.type !== "plugin", "扩展包不能安装可执行插件", 403);
        const start = prefix + x.path.replace(/\/$/, "") + "/";
        const subset: Files = {};
        for (const [k, v] of Object.entries(files))
          if (k.startsWith(start)) subset[k.slice(start.length)] = v;
        check(Object.keys(subset).length, "扩展包条目为空");
        return { subset, meta: x.metadata };
      });
      return this.s.tx(() => ({
        pack: pack.name,
        installed: entries.map((x) => this.install(x.subset, source, x.meta)),
      }));
    }
    let main =
      Object.keys(files).find((x) => x === "SKILL.md") ||
      Object.keys(files).find((x) => x.endsWith("/SKILL.md"));
    if (metadata.type === "template")
      main = Object.keys(files).find((x) => x.endsWith(".md"));
    check(main, "找不到 SKILL.md 或 Markdown 模板");
    const raw = Buffer.from(files[main], "base64").toString("utf8");
    const parsed = matter(raw);
    const manifest = metaSchema.parse({
      name: parsed.data.name || metadata.name,
      ...metadata,
    });
    check(
      manifest.type !== "plugin",
      "功能插件只能由开发者审查后在服务端注册，不能通过导入运行代码",
      403,
    );
    if (manifest.type !== "template")
      check(
        parsed.data.name && parsed.data.description,
        "标准 Skill 需要 name 和 description frontmatter",
      );
    const warnings: string[] = [];
    if (Object.keys(files).some((x) => /\.(sh|py|js|ts|exe)$/.test(x)))
      warnings.push("包含脚本，仅保留供检查；不会执行或安装依赖");
    const unsupported = manifest.permissions.filter(
      (x) => !["knowledge.read", "artifact.draft", "resource.read"].includes(x),
    );
    if (unsupported.length)
      warnings.push("未获授权的能力: " + unsupported.join(", "));
    const ext = existingId
      ? this.s.get("extension", existingId)
      : { id: uid(), enabled: true, projectIds: [], createdAt: now() };
    const release = {
      id: uid(),
      extensionId: ext.id,
      number:
        this.s.all("release").filter((x) => x.extensionId === ext.id).length +
        1,
      manifest,
      source,
      main,
      files,
      hash: hash(JSON.stringify(files)),
      warnings,
      compatible:
        unsupported.length === 0 && manifest.dependencies.length === 0,
      createdAt: now(),
    };
    this.s.put("release", release);
    this.s.put("extension", {
      ...ext,
      name: manifest.name,
      displayName: manifest.name,
      description: String(
        parsed.data.description || "自定义产物结构与写作要求。",
      ),
      type: manifest.type,
      currentRelease: release.id,
    });
    return { extension: this.s.get("extension", ext.id), release };
  }
  list() {
    return this.s.all("extension").map((x) => ({
      ...x,
      name: x.displayName || x.name,
      release: this.s.get("release", x.currentRelease),
      versions: this.s
        .all("release")
        .filter((r) => r.extensionId === x.id)
        .map(({ files, ...r }) => r),
    }));
  }
  select(id: string, projectId: string, stage: string) {
    const e = this.s.get("extension", id);
    check(e.enabled, "所选扩展已停用", 409);
    check(
      !e.projectIds.length || e.projectIds.includes(projectId),
      "扩展未绑定当前项目",
      403,
    );
    const r = this.s.get("release", e.currentRelease);
    check(r.compatible, "扩展依赖或权限不满足，请先检查", 409);
    check(
      !r.manifest.stages.length || r.manifest.stages.includes(stage),
      "扩展不适用于当前阶段",
    );
    return r;
  }
  rollback(id: string, releaseId: string) {
    const e = this.s.get("extension", id);
    check(
      this.s.get("release", releaseId).extensionId === id,
      "版本不属于此扩展",
      403,
    );
    e.currentRelease = releaseId;
    return this.s.put("extension", e);
  }
}
export const encoded = (text: string) => Buffer.from(text).toString("base64");
