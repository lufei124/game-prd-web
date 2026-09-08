import type { AgentInput, AgentHost, AgentRuntime } from "../server/agent.ts";
import type { DeliveryPlugin, RemoteDoc } from "../server/plugins.ts";

export const metadata = {
  schemaVersion: "1.0",
  requirementName: "每日奖励",
  module: "rewards",
  prototypeVersion: "v0.1",
  prototypeStatus: "Draft",
  device: { orientation: "portrait", platform: ["web"] },
  scope: { included: ["领取奖励"], excluded: ["支付"] },
  pages: [{ id: "reward", name: "每日奖励" }],
  scenarios: [
    {
      id: "claim",
      entry: "奖励页面",
      flow: ["点击领取", "显示领取成功"],
      result: "奖励已领取",
    },
  ],
  states: [
    { id: "ready", description: "可领取" },
    { id: "claimed", description: "已领取" },
    { id: "error", description: "网络异常，可重试" },
  ],
  decisions: [{ id: "D-001", summary: "每日仅能领取一次", status: "已确认" }],
};

export const html = (ink = false) =>
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>body{background:${ink ? "#202521" : "#f6f8f5"};color:${ink ? "#f4eee3" : "#163d32"};font-family:${ink ? "Georgia" : "sans-serif"};padding:35px}button{background:${ink ? "#e4a55f" : "#397e68"};color:white;border:0;border-radius:${ink ? "3px" : "10px"};padding:14px;margin:5px}section{max-width:420px;margin:30px auto}h1{font-size:30px}</style></head><body><section><p>DAILY REWARDS</p><h1>每日奖励</h1><p id="status">可领取</p><button id="claim">领取奖励</button><button id="error">模拟网络异常</button><button id="reset">重试</button></section><script id="prototype-meta" type="application/json">${JSON.stringify(metadata)}</script><script>let claimed=false;document.querySelector('#claim').onclick=()=>{if(!claimed){claimed=true;document.querySelector('#status').textContent='领取成功';document.querySelector('#claim').disabled=true}};document.querySelector('#error').onclick=()=>document.querySelector('#status').textContent='网络异常';document.querySelector('#reset').onclick=()=>{claimed=false;document.querySelector('#status').textContent='可领取';document.querySelector('#claim').disabled=false};</script></body></html>`;

export const prd =
  "# 每日奖励\n\n## 功能说明\n用户每天领取一次奖励。\n\n## 功能规则\nR-001 用户每天只可领取一次，服务端事务发奖。\n\n## 异常与边界\n网络失败允许重试，服务端幂等防止重复。\n\n## 验收标准\nAC-001 对应 R-001：重复领取时不重复发奖。";

export class MockRuntime implements AgentRuntime {
  calls: any[] = [];
  delay = 0;
  fail = false;

  async run(input: AgentInput, host: AgentHost) {
    this.calls.push(input);
    if (input.snapshot.chatOnly) {
      if (input.prompt.includes("产品需求评审会议"))
        return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>body{font-family:sans-serif}main{max-width:900px;margin:auto}</style></head><body><main><h1>每日奖励需求评审</h1><h2>背景与目标</h2><p>提升每日活跃。</p><h2>主流程</h2><p>进入 → 领取 → 成功反馈</p><h2>关键规则</h2><p>每日一次，重复请求幂等。</p><h2>异常边界</h2><p>网络失败可重试。</p><h2>评审关注点</h2><p>服务端幂等与跨日边界。</p></main><script>document.body.dataset.ready="yes"</script></body></html>';
      return "Mock Codex 回复：" + input.prompt;
    }
    await host.read("read_context", {});
    if (input.snapshot.conversation && input.prompt === "你好 Codex")
      return "Mock 产品助手：你好，有什么想法？";
    if (input.snapshot.conversation && input.prompt === "我想做一个奖励功能") {
      await host.read("ask_question", { question: "奖励面向哪些用户？" });
      return "奖励面向哪些用户？";
    }
    if (this.delay)
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, this.delay);
        input.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            reject(new Error("cancelled"));
          },
          { once: true },
        );
      });
    if (this.fail) throw new Error("TEST MOCK injected failure");

    const snap = input.snapshot;
    let content = "",
      meta: any = {},
      patches: any[] = [];
    if (input.kind === "requirement")
      content =
        "# 需求说明\n用户每天领取一次奖励。\n\n## 规则\n重复领取时不重复发奖。";
    if (input.kind === "prototype") {
      const style = snap.releases.find((r: any) => r.manifest.type === "style");
      const instruction = style
        ? Buffer.from(style.files[style.main], "base64").toString()
        : "";
      const ink = instruction.includes("#202521");
      content = html(ink);
      meta = metadata;
      const base = snap.versions.find(
        (v: any) => v.id === snap.heads.prototype,
      );
      if (base) {
        if (snap.conversation) {
          const selectedButton = base.content.match(
            /<button id="claim"[^>]*>领取奖励<\/button>/,
          )![0];
          patches = [
            {
              search: selectedButton,
              replace:
                '<button id="claim" style="float:right;margin-left:8px">领取奖励</button>',
            },
          ];
        } else {
          patches = [
            {
              search: base.content.match(/<style[^>]*>[\s\S]*?<\/style>/)![0],
              replace: content.match(/<style[^>]*>[\s\S]*?<\/style>/)![0],
            },
          ];
        }
      }
    }
    if (input.kind === "prd") {
      const template = snap.releases.find(
        (r: any) => r.manifest.type === "template",
      );
      const sections = template
        ? Buffer.from(template.files[template.main], "base64")
            .toString()
            .match(/^## .+$/gm) || []
        : ["## 功能说明", "## 功能规则", "## 异常与边界", "## 验收标准"];
      content =
        "# 每日奖励\n" +
        sections
          .map((h: string) => h + "\n用户每天可领取一次，服务端负责校验。")
          .join("\n\n") +
        "\n\nR-001 每日一次。\nAC-001 对应 R-001：重复领取不发奖。\n异常：网络失败可以重试。";
    }
    if (input.kind === "review") {
      meta = {
        summary: "TEST MOCK review",
        issues: input.snapshot.conversation
          ? [
              {
                id: "review-rule",
                severity: "major",
                description: "需要明确跨日边界",
                suggestion: "补充服务器时区和重置时刻",
              },
            ]
          : [],
      };
      content = JSON.stringify(meta);
    }
    await host.read("propose_artifact", {
      content,
      metadata: meta,
      summary: "TEST MOCK · " + input.kind,
      patches,
    });
    return "TEST MOCK";
  }
}

export class MockLark implements DeliveryPlugin {
  id = "feishu";
  name = "TEST MOCK Feishu";
  capabilities = ["prd.publish"];
  permissions = ["document.write"];
  docs = new Map<string, RemoteDoc>();
  creates = 0;
  updates = 0;
  uncertain = false;
  configured = true;

  async status() {
    return {
      state: this.configured ? "configured" : "unconfigured",
      detail: "TEST MOCK not live",
    };
  }
  async fetch(id: string) {
    const d = this.docs.get(id);
    if (!d) throw new Error("not found");
    return { ...d };
  }
  async create(title: string, content: string, target: string) {
    this.creates++;
    const id = "remote" + this.creates;
    this.docs.set(id, {
      id,
      content,
      revision: 1,
      url: "https://example.feishu.cn/docx/" + id,
    });
    if (this.uncertain)
      throw new Error("TEST MOCK timeout after remote create");
    return { id, url: "https://example.feishu.cn/docx/" + id };
  }
  async update(id: string, content: string, revision: number) {
    const d = await this.fetch(id);
    if (d.revision !== revision) throw new Error("remote conflict");
    this.updates++;
    this.docs.set(id, { ...d, content, revision: revision + 1 });
  }
}
