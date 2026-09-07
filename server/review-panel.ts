import type { AgentRuntime, AgentInput, AgentHost } from "./agent.ts";
import { check } from "./db.ts";
import { reviewSchema } from "./domain.ts";

export const reviewRoles = [
  { id: "product", name: "产品", focus: "目标、用户场景、业务规则和需求范围是否一致，是否存在待用户裁决的分歧" },
  { id: "design", name: "交互设计", focus: "逐页核对原型与 PRD 的入口、操作、状态、反馈、异常恢复与可访问性" },
  { id: "engineering", name: "研发与测试", focus: "数据、接口、权限、并发、边界、验收标准和可测试性" },
];

// Host orchestrates independent SDK turns over the same immutable snapshot.
// Sequential calls also respect the single subscription credential refresh lock.
export async function runReviewPanel(runtime: AgentRuntime, input: AgentInput, host: AgentHost) {
  const reports: any[] = [];
  for (const role of input.snapshot.reviewRoles) {
    input.signal.throwIfAborted();
    host.progress(`${role.name}评审中…`);
    let report: ReturnType<typeof reviewSchema.parse> | undefined;
    await runtime.run({
      ...input,
      prompt: `${input.prompt}\n本次独立评审视角：${role.name}。重点：${role.focus}。先读取同一份冻结上下文，不依赖其他评审结论。必须提交符合 review metadata 契约的评审候选；不修改 PRD，不确认问题已解决。`,
    }, {
      progress: (message) => host.progress(`${role.name}：${message}`),
      session: host.session,
      read: async (name, args) => {
        if (name === "propose_artifact") {
          report = reviewSchema.parse(args.metadata);
          return { status: "review_collected" };
        }
        check(name !== "ask_question", "评审中的待澄清问题请列入评审 issues");
        check(["read_context", "read_resource", "read_knowledge"].includes(name), "评审只允许读取冻结上下文", 403);
        return host.read(name, args);
      },
    });
    check(report, `${role.name}未返回有效评审，未提交部分结果，请重试`, 422);
    reports.push({ role, report });
  }
  input.signal.throwIfAborted();
  const metadata = {
    summary: reports.map(({ role, report }) => `${role.name}：${report.summary}`).join("\n"),
    issues: reports.flatMap(({ role, report }) => report.issues.map((issue: any, i: number) => ({
      ...issue, id: `${role.id}-${i + 1}`, description: `【${role.name}】${issue.description}`,
    }))),
  };
  const summary = `已完成 ${reports.length} 个独立视角评审，共发现 ${metadata.issues.length} 个问题。评审结果在右侧，可以继续对话修改 PRD；修改后请重新评审。`;
  await host.read("propose_artifact", { content: JSON.stringify(metadata), metadata, summary });
  return summary;
}
