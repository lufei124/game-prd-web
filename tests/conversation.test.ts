import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../server/db.ts";
import { Domain } from "../server/domain.ts";
import { bootstrap } from "../server/bootstrap.ts";
import { Tasks } from "../server/tasks.ts";
import { Extensions } from "../server/extensions.ts";
import { Knowledge } from "../server/knowledge.ts";
import { conversationOptions } from "../server/conversation.ts";
test("multi-turn conversation automatically selects Skills, preserves questions and updates the requirement draft (Mock)", async () => {
  const root = await mkdtemp(join(tmpdir(), "conversation-")),
    s = new Store(root);
  await bootstrap(s);
  const d = new Domain(s),
    p = d.project("产品"),
    r = d.requirement(p.id, "登录");
  let turns = 0;
  const runtime = {
    async run(input: any, host: any) {
      turns++;
      if (input.prompt === "你好") return "你好，我们先聊聊你的想法";
      if (turns === 1) {
        await host.read("ask_question", { question: "面向哪些用户？" });
        return "请补充用户";
      }
      assert(
        input.snapshot.messages.some(
          (m: any) => m.content === "面向哪些用户？",
        ),
      );
      assert(
        input.snapshot.questions.some((q: any) => q.answer === "企业管理员"),
      );
      await host.read("propose_artifact", {
        content:
          "# 需求卡\n用户：企业管理员\n" +
          (turns === 3 ? "支持手机验证码" : "使用邮箱登录"),
        metadata: {},
        summary: "已按你的回答更新需求卡。",
      });
      return "已更新";
    },
  };
  const tasks = new Tasks(s, d, new Extensions(s), new Knowledge(s), runtime);
  const send = async (prompt: string) => {
    const t = tasks.create(r.id, conversationOptions(s, r.id, { prompt }));
    for (
      let i = 0;
      i < 100 && ["queued", "running"].includes(s.get("task", t.id).status);
      i++
    )
      await new Promise((r) => setTimeout(r, 10));
    return s.get("task", t.id);
  };
  try {
    const first = await send("帮我梳理登录需求");
    assert.equal(first.status, "waiting");
    assert.equal(first.snapshot.releases[0].manifest.type, "skill");
    const second = await send("企业管理员");
    assert.equal(second.status, "completed");
    assert.equal(s.get("task", first.id).status, "completed");
    const third = await send("还需要支持手机验证码");
    assert.equal(third.status, "completed");
    assert.equal(d.versions(r.id).length, 2);
    assert(d.versions(r.id).at(-1)!.content.includes("手机验证码"));
    assert(!s.get("requirement", r.id).confirmed.requirement);
    const greeting = await send("你好");
    assert.equal(greeting.status, "completed");
    assert.equal(d.versions(r.id).length, 2);
    assert(s.all("message").some((m) => m.content === "你好，我们先聊聊你的想法"));
    const opts = conversationOptions(s, r.id, {
      prompt: "使用墨色风格生成原型",
    });
    assert.equal(opts.kind, "requirement");
    assert.equal(conversationOptions(s,r.id,{prompt:"帮我写一份 PRD"}).kind,"requirement");
  } finally {
    s.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex chat preserves history and rejects artifact writes (Mock)", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-chat-"));
  const s = new Store(root);
  await bootstrap(s);
  const d = new Domain(s), p = d.project("聊天"), r = d.requirement(p.id, "交流");
  let turn = 0;
  const tasks = new Tasks(s, d, new Extensions(s), new Knowledge(s), {
    async run(input, host) {
      assert.equal(input.snapshot.executor, "codex");
      assert.equal(input.snapshot.releases.length, 0);
      await assert.rejects(host.read("propose_artifact", { content: "不应保存" }), /聊天模式不能修改成果/);
      await assert.rejects(host.read("ask_question", { question: "问题" }), /聊天模式不创建业务问题/);
      if (turn++) assert(input.snapshot.messages.some((m: any) => m.content === "你好，我是 Codex"));
      return "你好，我是 Codex";
    },
  });
  try {
    for (const prompt of ["你好", "继续聊聊"]) {
      const t = tasks.create(r.id, conversationOptions(s, r.id, { prompt, chatOnly: true, executor: "claude" }));
      for (let i = 0; i < 100 && ["queued", "running"].includes(s.get("task", t.id).status); i++)
        await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(s.get("task", t.id).status, "completed");
    }
    assert.equal(d.versions(r.id).length, 0);
    assert.equal(s.all("message").length, 4);
    assert.equal(s.all("question").length, 0);
  } finally { s.close(); await rm(root, { recursive: true, force: true }); }
});
