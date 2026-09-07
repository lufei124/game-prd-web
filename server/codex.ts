import { Codex, type UserInput } from "@openai/codex-sdk";
import { mkdir, writeFile, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { posix } from "node:path";
import type { ThreadOptions } from "@openai/codex-sdk";
import { check } from "./db.ts";
import {
  agentPrompt,
  type AgentHost,
  type AgentInput,
  type AgentRuntime,
} from "./agent.ts";
import {
  codexStatus,
  codexBinary,
  codexAuthMode,
  withCodexAuth,
} from "./codex-auth.ts";
export { codexStatus } from "./codex-auth.ts";
const shellQuote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
export function seatbeltProfile(work: string, home: string, binary: string) {
  const q = (s: string) => JSON.stringify(s);
  return `(version 1)
(deny default)
(allow process* sysctl-read mach-lookup signal)
(allow file-read-metadata)
; The loader opens the root directory. This conjunction permits only that
; directory object, never regular files or descendants (not a subpath rule).
(allow file-read-data (require-all (literal "/") (vnode-type DIRECTORY)))
(allow file-read* file-map-executable (subpath "/System") (subpath "/usr/lib") (subpath "/usr/share") (subpath "/Library/Apple") (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random") (literal "/private/etc/resolv.conf") (literal "/private/etc/hosts") (literal "/private/etc/ssl/cert.pem") (subpath ${q(work)}) (subpath ${q(home)}) (literal ${q(binary)}))
(allow file-write* (subpath ${q(work)}) (subpath ${q(home)}) (literal "/dev/null"))
(allow network-outbound (remote tcp "*:443"))
(deny network-outbound (remote ip "localhost:*"))
`;
}
export class CodexExecutor implements AgentRuntime {
  constructor(
    private client = (options: ConstructorParameters<typeof Codex>[0]) =>
      new Codex(options),
  ) {}
  async run(input: AgentInput, host: AgentHost) {
    const status = await codexStatus(input.root);
    check(status.state === "configured", status.detail, 409);
    return withCodexAuth(
      input.root,
      resolve(input.root, "codex-home", input.id),
      input.signal,
      () => this.runTask(input, host),
    );
  }
  private async runTask(input: AgentInput, host: AgentHost) {
    const status = await codexStatus(input.root);
    check(status.state === "configured", status.detail, 409);
    const work = resolve(input.root, "codex-work", input.id);
    const home = resolve(input.root, "codex-home", input.id);
    await mkdir(work, { recursive: true, mode: 0o700 });
    await mkdir(home, { recursive: true, mode: 0o700 });
    const binary = await realpath(codexBinary()!);
    const wrapper = join(work, "codex-sandbox.sh");
    const profile = seatbeltProfile(
      await realpath(work),
      await realpath(home),
      binary,
    );
    await writeFile(
      wrapper,
      `#!/bin/sh\nexec /usr/bin/sandbox-exec -p ${shellQuote(profile)} ${shellQuote(binary)} "$@"\n`,
      { mode: 0o700 },
    );
    const codex = this.client({
      codexPathOverride: wrapper,
      apiKey:
        codexAuthMode() === "api-key"
          ? process.env.WORKBENCH_CODEX_API_KEY
          : undefined,
      env: {
        PATH: "/usr/bin:/bin",
        HOME: home,
        CODEX_HOME: home,
        TMPDIR: work,
      },
      config: {
        cli_auth_credentials_store: "file",
        features: { shell_tool: false },
        mcp_servers: {},
      },
    });
    const thread = codex.startThread({
      ...codexThreadOptions(input, work),
      skipGitRepoCheck: true,
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
    });
    const context = await host.read("read_context", {});
    const resources = [];
    // Only the selected releases' directly linked text references enter this task.
    // Scripts remain inert resources; no imported code is executed.
    for (const release of input.snapshot.releases) {
      const main = Buffer.from(release.files[release.main], "base64").toString(
        "utf8",
      );
      const paths = new Set<string>();
      for (const m of main.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
        const path = posix.normalize(
          posix.join(posix.dirname(release.main), m[1]),
        );
        if (/\.(md|txt|json|yaml|yml|csv)$/.test(path) && release.files[path])
          paths.add(path);
      }
      for (const path of paths)
        resources.push({
          releaseId: release.id,
          ...(await host.read("read_resource", {
            releaseId: release.id,
            path,
          })),
        });
    }
    const prompt =
      agentPrompt(input) +
      `\n本次使用 Codex 结构化输出传输，以上工具由宿主预读，下方是读取结果。不要尝试调用 MCP、Shell 或文件工具。输出 {content,metadataJson,summary,patches,question}：metadataJson 是 metadata 的 JSON 字符串；无需提问时 question 为空字符串；需要澄清时填写 question 并将 content 留空。宿主仅会提交候选或记录问题，不能确认、删除、入库或发布。\n上下文：${JSON.stringify(context)}\n选定 Skill 的直接引用：${JSON.stringify(resources)}\n冻结知识：${JSON.stringify(input.snapshot.knowledge.filter((x: any) => x.status === "parsed"))}`;
    const request: UserInput[] = [{ type: "text", text: prompt }];
    for (const k of input.snapshot.knowledge.filter(
      (k: any) => k.status === "image",
    )) {
      const ref = join(work, k.id + "." + k.name.split(".").at(-1));
      await writeFile(ref, await readFile(join(input.root, "files", k.id)), {
        mode: 0o600,
      });
      request.push({ type: "local_image", path: ref });
    }
    host.progress(
      `Codex 正在处理${input.kind}任务 · ${input.model} · ${input.snapshot.reasoningEffort}`,
    );
    const result = await thread.runStreamed(request, {
      signal: input.signal,
      outputSchema: {
        type: "object",
        properties: {
          content: { type: "string" },
          metadataJson: { type: "string" },
          question: { type: "string" },
          summary: { type: "string" },
          patches: {
            type: "array",
            items: {
              type: "object",
              properties: {
                search: { type: "string" },
                replace: { type: "string" },
              },
              required: ["search", "replace"],
              additionalProperties: false,
            },
          },
        },
        required: ["content", "metadataJson", "summary", "patches", "question"],
        additionalProperties: false,
      },
    });
    let output = "";
    for await (const event of result.events) {
      if (event.type === "thread.started") host.session(event.thread_id);
      if (
        event.type === "item.completed" &&
        event.item.type === "agent_message"
      )
        output = event.item.text;
      if (event.type === "turn.failed") throw new Error(event.error.message);
      if (event.type === "error") throw new Error(event.message);
    }
    input.signal.throwIfAborted();
    return submitCodexOutput(output, host);
  }
}
export class RuntimeRouter implements AgentRuntime {
  constructor(
    private claude: AgentRuntime,
    private executor = new CodexExecutor(),
  ) {}
  async run(input: AgentInput, host: AgentHost) {
    if ((input.snapshot.executor || "codex") === "codex")
      return this.executor.run(input, host);
    return this.claude.run(input, host);
  }
}
export function codexThreadOptions(
  input: AgentInput,
  work: string,
): ThreadOptions {
  return {
    workingDirectory: work,
    model: input.model,
    modelReasoningEffort: input.snapshot.reasoningEffort,
  };
}
export async function submitCodexOutput(raw: string, host: AgentHost) {
  const output = z
    .object({
      content: z.string(),
      metadataJson: z.string(),
      summary: z.string(),
      patches: z.array(z.object({ search: z.string(), replace: z.string() })),
      question: z.string(),
    })
    .strict()
    .parse(JSON.parse(raw));
  if (output.question.trim())
    await host.read("ask_question", { question: output.question });
  else
    await host.read("propose_artifact", {
      content: output.content,
      metadata: JSON.parse(output.metadataJson),
      summary: output.summary,
      patches: output.patches,
    });
  return output.summary;
}
