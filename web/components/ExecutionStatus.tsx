import React, { useState } from "react";
import { api } from "../api";
const labels: Record<string, string> = {
  queued: "等待执行",
  running: "正在处理",
  waiting: "等待你回答",
  completed: "已完成",
  failed: "执行失败",
  cancelled: "已停止",
  interrupted: "执行中断",
};
const stages: Record<string, string> = {
  requirement: "澄清需求",
  prototype: "生成原型",
  prd: "编写 PRD",
  review: "独立评审",
};
export function ExecutionStatus({ task, candidate, onRetry, onStop }: any) {
  const [trace, setTrace] = useState<any>(null);
  const [error, setError] = useState("");
  const active = ["running", "queued"].includes(task?.status);
  return (
    <div className={`execution-status ${task?.status || "idle"}`}>
      <details>
        <summary>
          <span className={active ? "activity-dot pulse" : "activity-dot"} />
          <span role="status">
            {candidate
              ? "修改候选已就绪"
              : task
                ? `${task.retryOf && active ? "正在重试" : labels[task.status] || task.status} · ${task.snapshot?.chatOnly ? "评审讲解" : stages[task.kind]}`
                : "就绪 · 可以开始对话"}
          </span>
          <span className="execution-disclosure">执行详情</span>
        </summary>
        <div className="execution-details">
          {task?.snapshot?.contextPack && (
            <p>本轮参考了 {task.snapshot.contextPack.items.length} 份资料</p>
          )}
          {task?.events?.map((event: any, i: number) => (
            <p key={i}>{event.text}</p>
          ))}
          {task?.error && <p role="alert">{task.error}</p>}
          {!task && <p>发送需求后，会在这里显示执行进展。</p>}
          {task && (
            <details>
              <summary
                onClick={() => {
                  if (!trace)
                    api(`/tasks/${task.id}/recall-trace`)
                      .then(setTrace)
                      .catch((e) => setError(e.message));
                }}
              >
                Recall Debug · 开发调试
              </summary>
              {error ? (
                <p>{error}</p>
              ) : (
                <pre>
                  {trace ? JSON.stringify(trace, null, 2) : "暂无调试数据"}
                </pre>
              )}
            </details>
          )}
        </div>
      </details>
      {(active || task?.status === "waiting") && (
        <button className="ghost" onClick={() => onStop(task.id)}>
          停止
        </button>
      )}
      {["failed", "cancelled", "interrupted"].includes(task?.status) && (
        <button className="ghost" onClick={() => onRetry(task.id)}>
          重试
        </button>
      )}
    </div>
  );
}
