import { test, expect } from "@playwright/test";
import { html, metadata, prd } from "./fixtures.ts";
import { unlink, writeFile } from "node:fs/promises";

const post = async (page: any, path: string, body: any) =>
  page.evaluate(
    async ({ path, body }: any) => {
      const bootstrap = await (await fetch("/api/bootstrap")).json();
      const response = await fetch("/api" + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forge-CSRF": bootstrap.csrf,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    { path, body },
  );

const get = async (page: any, path: string) =>
  page.evaluate(async (path: string) => {
    const response = await fetch("/api" + path);
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }, path);

async function createProject(page: any, name: string) {
  const project = await post(page, "/projects", { name });
  await page.reload();
  await page.getByLabel("当前项目").selectOption(project.id);
  return project;
}

test("v2 entry is conversation-first and hides legacy product UI", async ({
  page,
}) => {
  await page.goto("/");
  page.once("dialog", (dialog) => dialog.accept("新版入口验收"));
  await page.getByRole("button", { name: "新建项目" }).click();
  await expect(page.getByRole("heading", { name: "需求" })).toBeVisible();
  for (const name of ["需求", "知识库", "设置"])
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(page.getByText("扩展中心", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/阶段 Skill/)).toHaveCount(0);
  await expect(page.getByText(/Claude Code|Claude 模型/)).toHaveCount(0);
  await page.getByRole("button", { name: "新需求" }).click();
  await expect(
    page.getByRole("heading", { name: "描述你想做什么" }),
  ).toBeVisible();
  await expect(page.locator(".artifact-pane")).toHaveCount(0);
  await expect(page.getByLabel("需求对话输入")).toBeVisible();
});

test("knowledge sources sync and chunk search returns relevant text", async ({
  page,
}) => {
  await page.goto("/");
  const project = await createProject(page, "知识库验收");
  const projectId = project.id;
  await page.getByRole("button", { name: "知识库" }).click();
  page.once("dialog", (dialog) =>
    dialog.accept("/private/tmp/game-prd-web-e2e-knowledge"),
  );
  await page.getByRole("button", { name: "关联本地文件夹" }).click();
  await expect(
    page.getByText("会员退款规则.md", { exact: true }),
  ).toBeVisible();
  await page
    .locator(".source-card")
    .filter({ hasText: "game-prd-web-e2e-knowledge" })
    .getByTitle("立即同步")
    .click();
  await expect(
    page
      .locator(".source-card")
      .filter({ hasText: "game-prd-web-e2e-knowledge" }),
  ).toContainText("0 项变化");
  page.once("dialog", (dialog) => dialog.accept("feishu-rule"));
  await page.getByRole("button", { name: "关联飞书文档" }).click();
  await expect(page.getByText("飞书文档.md", { exact: true })).toBeVisible();
  const feishuState = await get(
    page,
    `/knowledge?projectId=${encodeURIComponent(projectId)}`,
  );
  const feishuVersion = feishuState.items.find((x: any) =>
    String(x.source).startsWith("feishu:"),
  );
  expect(feishuVersion.sourceRevision).toBe(1);
  expect(feishuVersion.sourceUrl).toContain(
    "example.feishu.cn/docx/feishu-rule",
  );
  const search = page.getByPlaceholder("测试 AI 能否找到某条项目规则…");
  await search.fill("超过七天不可退款");
  await search.press("Enter");
  await expect(
    page.locator(".knowledge-item").filter({ hasText: "会员退款规则.md" }),
  ).toContainText("会员退款必须在订单详情页发起");
  const result = await get(
    page,
    `/knowledge/search?projectId=${encodeURIComponent(projectId)}&q=${encodeURIComponent("会员退款规则")}`,
  );
  expect(result[0].text).toBeUndefined();
  expect(result[0].matchedChunks.length).toBeGreaterThan(0);

  const requirement = await post(page, "/requirements", {
    projectId,
    name: "会员退款",
    mode: "full",
  });
  await post(page, `/requirements/${requirement.id}/chat`, {
    prompt: "会员退款超过七天怎么处理？",
    stage: "requirement",
  });
  await expect
    .poll(
      async () =>
        (await get(page, `/requirements/${requirement.id}`)).tasks.at(-1)
          ?.status,
    )
    .toBe("completed");
  const before = await get(page, `/requirements/${requirement.id}`);
  const oldKnowledgeId =
    before.tasks.at(-1).snapshot.contextPack.items[0].knowledgeId;

  await writeFile(
    "/private/tmp/game-prd-web-e2e-knowledge/会员退款规则.md",
    "# 会员退款规则\n会员退款必须在订单详情页发起，超过十四天不可退款。",
  );
  await page
    .locator(".source-card")
    .filter({ hasText: "game-prd-web-e2e-knowledge" })
    .getByTitle("立即同步")
    .click();
  await expect(
    page
      .locator(".source-card")
      .filter({ hasText: "game-prd-web-e2e-knowledge" }),
  ).toContainText("1 项变化");
  await post(page, `/requirements/${requirement.id}/chat`, {
    prompt: "会员退款超过十四天怎么处理？",
    stage: "requirement",
  });
  await expect
    .poll(
      async () =>
        (await get(page, `/requirements/${requirement.id}`)).tasks.at(-1)
          ?.status,
    )
    .toBe("completed");
  const after = await get(page, `/requirements/${requirement.id}`);
  const newKnowledgeId =
    after.tasks.at(-1).snapshot.contextPack.items[0].knowledgeId;
  expect(newKnowledgeId).not.toBe(oldKnowledgeId);
  expect(after.tasks[0].snapshot.contextPack.items[0].knowledgeId).toBe(
    oldKnowledgeId,
  );

  await unlink("/private/tmp/game-prd-web-e2e-knowledge/会员退款规则.md");
  await page
    .locator(".source-card")
    .filter({ hasText: "game-prd-web-e2e-knowledge" })
    .getByTitle("立即同步")
    .click();
  await expect(
    page
      .locator(".source-card")
      .filter({ hasText: "game-prd-web-e2e-knowledge" }),
  ).toContainText("1 项变化");
  const reconciled = await get(
    page,
    `/knowledge?projectId=${encodeURIComponent(projectId)}`,
  );
  expect(
    reconciled.documents.find(
      (document: any) => document.currentVersionId === newKnowledgeId,
    ).status,
  ).toBe("deprecated");
  await post(page, `/requirements/${requirement.id}/chat`, {
    prompt: "会员退款超过十四天怎么处理？",
    stage: "requirement",
  });
  await expect
    .poll(
      async () =>
        (await get(page, `/requirements/${requirement.id}`)).tasks.at(-1)
          ?.status,
    )
    .toBe("completed");
  const afterDeletion = await get(page, `/requirements/${requirement.id}`);
  expect(
    afterDeletion.tasks
      .at(-1)
      .snapshot.contextPack.items.every(
        (item: any) => item.knowledgeId !== newKnowledgeId,
      ),
  ).toBe(true);
  expect(afterDeletion.tasks[0].snapshot.contextPack.items[0].knowledgeId).toBe(
    oldKnowledgeId,
  );
});

test("full v2 flow keeps prototype edits preview-first and review lineage", async ({
  page,
}) => {
  await page.goto("/");
  const project = await createProject(page, "完整流程验收");
  await post(page, "/knowledge/text", {
    projectId: project.id,
    requirementId: null,
    name: "奖励规则",
    content: "每日奖励只可领取一次，重复请求必须幂等。",
    state: "confirmed",
  });
  await page.getByRole("button", { name: "新需求" }).click();
  const input = page.getByLabel("需求对话输入");
  await input.fill("我想做一个奖励功能");
  await input.press("Enter");
  await expect(
    page.getByText("奖励面向哪些用户？", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".artifact-pane")).toHaveCount(0);
  const requirement = (await get(page, "/bootstrap")).requirements.find(
    (item: any) => item.projectId === project.id,
  );
  await expect
    .poll(
      async () =>
        (await get(page, `/requirements/${requirement.id}`)).tasks.at(-1)
          ?.status,
    )
    .toBe("waiting");
  await input.fill("面向每天登录的用户");
  await input.press("Enter");
  await expect
    .poll(
      async () =>
        (await get(page, `/requirements/${requirement.id}`)).tasks.at(-1)
          ?.status,
    )
    .toBe("completed");
  const openArtifact = page.getByRole("button", { name: "打开成果" });
  if (await openArtifact.isVisible()) await openArtifact.click();
  await expect(page.getByLabel("需求卡编辑器")).toHaveValue(
    /用户每天领取一次奖励/,
  );

  await page.getByRole("button", { name: "确认需求" }).click();
  const frame = page.frameLocator('iframe[title="交互原型"]');
  await expect(frame.getByRole("button", { name: "领取奖励" })).toBeVisible();
  const initial = await get(page, `/requirements/${requirement.id}`);
  const initialPrototypeId = initial.requirement.heads.prototype;
  await page.getByRole("button", { name: "点选修改" }).click();
  await frame.getByRole("button", { name: "领取奖励" }).click();
  await expect(page.locator(".selection-chip")).toContainText("#claim");
  await input.fill("把这个按钮放到右边");
  await input.press("Enter");
  await expect(page.getByText(/AI 修改候选，仅预览/)).toBeVisible();
  await expect(frame.locator("#claim")).toHaveAttribute("style", /float:right/);
  expect(
    (await get(page, `/requirements/${requirement.id}`)).requirement.heads
      .prototype,
  ).toBe(initialPrototypeId);
  await page.getByRole("button", { name: "应用修改" }).click();
  await expect(page.getByText(/AI 修改候选，仅预览/)).toHaveCount(0);
  const afterApply = await get(page, `/requirements/${requirement.id}`);
  expect(afterApply.requirement.heads.prototype).not.toBe(initialPrototypeId);
  expect(afterApply.tasks.at(-1).appliedAt).toBeTruthy();

  const history = page.getByLabel("原型历史版本");
  const firstVersionId = await history
    .locator("option")
    .nth(1)
    .getAttribute("value");
  await history.selectOption(firstVersionId!);
  await page.getByRole("button", { name: "回退", exact: true }).click();
  await expect(frame.locator("#claim")).not.toHaveAttribute(
    "style",
    /float:right/,
  );

  await input.fill("把这个按钮放到右边");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "放弃" })).toBeVisible();
  const headBeforeDiscard = (await get(page, `/requirements/${requirement.id}`))
    .requirement.heads.prototype;
  await page.getByRole("button", { name: "放弃" }).click();
  const afterDiscard = await get(page, `/requirements/${requirement.id}`);
  expect(afterDiscard.requirement.heads.prototype).toBe(headBeforeDiscard);
  expect(afterDiscard.tasks.at(-1).discardedAt).toBeTruthy();
  expect(afterDiscard.tasks.at(-1).candidate).toBeNull();

  await page.getByRole("button", { name: "确认原型" }).click();
  const prdEditor = page.getByLabel("PRD 文档编辑器");
  await expect(prdEditor).toHaveValue(/AC-001/);
  await prdEditor.fill((await prdEditor.inputValue()) + "\n\n补充人工说明。");
  await page.getByRole("button", { name: "保存 PRD" }).click();
  await page.getByRole("button", { name: /AI 评审/ }).click();
  await page.getByRole("button", { name: "开始评审" }).click();
  const issues = page.locator(".issue-card");
  await expect(issues).toHaveCount(3);
  await expect(issues.nth(0)).toContainText("产品");
  await expect(issues.nth(1)).toContainText("交互设计");
  await expect(issues.nth(2)).toContainText("研发测试");
  await issues
    .nth(0)
    .getByRole("button", { name: "采纳", exact: true })
    .click();
  await issues
    .nth(0)
    .getByRole("button", { name: "不采纳", exact: true })
    .click();
  await issues
    .nth(1)
    .getByRole("button", { name: "采纳", exact: true })
    .click();
  await issues
    .nth(2)
    .getByRole("button", { name: "稍后处理", exact: true })
    .click();
  const applyRequest = page.waitForRequest(
    (request) => request.url().endsWith("/chat") && request.method() === "POST",
  );
  await page.getByRole("button", { name: "应用已采纳建议" }).click();
  const appliedPrompt = (await applyRequest).postDataJSON().prompt;
  expect(appliedPrompt).toContain("交互设计");
  expect(appliedPrompt).not.toContain("【产品】");
  await expect(prdEditor).toHaveValue(/AC-001/);
  await page.getByRole("button", { name: "确认终稿" }).click();
  const finalized = await get(page, `/requirements/${requirement.id}`);
  expect(finalized.confirmations.at(-1).reviewStatus).toBe(
    "reviewed_then_modified",
  );

  await page.getByRole("button", { name: "评审讲解" }).click();
  await page.getByRole("button", { name: "生成评审讲解" }).click();
  const briefFrame = page.frameLocator("iframe.showme-frame");
  await expect(
    briefFrame.getByRole("heading", { name: "每日奖励需求评审" }),
  ).toBeVisible();
  await expect(
    briefFrame.getByText("评审关注点", { exact: true }),
  ).toBeVisible();
  const withBrief = await get(page, `/requirements/${requirement.id}`);
  expect(withBrief.reviewBriefs).toHaveLength(1);
  expect(withBrief.reviewBriefs[0].prdVersionId).toBe(
    withBrief.requirement.heads.prd,
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 HTML" }).click();
  await download;
  await page.getByRole("button", { name: "PRD", exact: true }).last().click();
  await prdEditor.fill((await prdEditor.inputValue()) + "\n\n终稿后的新修订。");
  await page.getByRole("button", { name: "保存 PRD" }).click();
  await expect(page.getByRole("button", { name: "确认终稿" })).toBeVisible();
  await page.getByRole("button", { name: "评审讲解" }).click();
  await expect(page.getByText(/讲解版本基于旧 PRD/)).toBeVisible();

  await page
    .getByLabel("成果阶段")
    .getByRole("button", { name: "原型", exact: true })
    .click();
  await input.fill("把这个按钮放到右边");
  await input.press("Enter");
  await expect(page.getByText(/AI 修改候选，仅预览/)).toBeVisible();
  await page.getByRole("button", { name: "应用修改" }).click();
  await page
    .getByLabel("成果阶段")
    .getByRole("button", { name: "PRD", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "重新同步" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "确认终稿" })).toHaveCount(0);
  await page
    .getByLabel("成果阶段")
    .getByRole("button", { name: "原型", exact: true })
    .click();
  await page.getByRole("button", { name: "确认原型" }).click();
  await expect(page.getByRole("button", { name: "重新同步" })).toHaveCount(0);
});

test("PRD can skip optional review and records skipped", async ({ page }) => {
  await page.goto("/");
  const project = await createProject(page, "跳过评审验收");
  const requirement = await post(page, "/requirements", {
    projectId: project.id,
    name: "直接终稿",
    mode: "full",
  });
  const requirementVersion = await post(
    page,
    `/requirements/${requirement.id}/versions`,
    {
      kind: "requirement",
      content: "# 需求卡\n每日奖励",
      base: null,
      metadata: {},
    },
  );
  await post(page, `/requirements/${requirement.id}/confirm`, {
    kind: "requirement",
    versionId: requirementVersion.id,
  });
  const prototypeVersion = await post(
    page,
    `/requirements/${requirement.id}/versions`,
    { kind: "prototype", content: html(), base: null, metadata },
  );
  await post(page, `/requirements/${requirement.id}/confirm`, {
    kind: "prototype",
    versionId: prototypeVersion.id,
  });
  await post(page, `/requirements/${requirement.id}/versions`, {
    kind: "prd",
    content: prd,
    base: null,
    metadata: {},
  });
  const changedPrototype = await post(
    page,
    `/requirements/${requirement.id}/versions`,
    {
      kind: "prototype",
      content: html(true),
      base: prototypeVersion.id,
      metadata,
    },
  );
  await post(page, `/requirements/${requirement.id}/confirm`, {
    kind: "prototype",
    versionId: changedPrototype.id,
  });
  await page.reload();
  await page.getByLabel("当前项目").selectOption(project.id);
  await page.getByRole("button", { name: /直接终稿/ }).click();
  await expect(page.getByRole("button", { name: "重新同步" })).toBeVisible();
  await page.getByRole("button", { name: "重新同步" }).click();
  await page.getByRole("button", { name: "跳过评审并确认终稿" }).click();
  const workspace = await get(page, `/requirements/${requirement.id}`);
  expect(workspace.confirmations.at(-1).reviewStatus).toBe("skipped");
  page.on("dialog", async (dialog) => {
    if (dialog.type() === "prompt") await dialog.accept("my_library");
    else await dialog.accept();
  });
  await page.getByRole("button", { name: "飞书交付" }).click();
  await expect(page.getByRole("button", { name: "飞书已交付" })).toBeVisible();
  expect(
    (await get(page, `/requirements/${requirement.id}`)).publications.at(-1)
      .status,
  ).toBe("published");
});

test("prototype iframe cannot reach parent storage or the workbench API", async ({
  page,
}) => {
  await page.goto("/");
  const project = await createProject(page, "原型隔离验收");
  const requirement = await post(page, "/requirements", {
    projectId: project.id,
    name: "隔离原型",
    mode: "prototype",
  });
  const attack = html().replace(
    "</body>",
    `<script>window.testResult={};try{parent.localStorage.setItem('prototype-pwned','yes');window.testResult.parent=true}catch(e){window.testResult.parent=false}fetch('/api/bootstrap').then(()=>window.testResult.fetch=true).catch(()=>window.testResult.fetch=false);</script></body>`,
  );
  await post(page, `/requirements/${requirement.id}/versions`, {
    kind: "prototype",
    content: attack,
    base: null,
    metadata,
  });
  await page.reload();
  await page.getByLabel("当前项目").selectOption(project.id);
  await page.getByRole("button", { name: /隔离原型/ }).click();
  const frame = page.frameLocator('iframe[title="交互原型"]');
  await expect(frame.getByRole("button", { name: "领取奖励" })).toBeVisible();
  await expect
    .poll(() =>
      frame
        .locator("body")
        .evaluate(() => JSON.stringify((window as any).testResult)),
    )
    .toBe('{"parent":false,"fetch":false}');
  expect(
    await page.evaluate(() => localStorage.getItem("prototype-pwned")),
  ).toBeNull();
});

test("settings persist Codex defaults, global template and review roles", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).click();
  await expect(
    page.getByText("只保留 Codex、全局 PRD 模板和评审角色。"),
  ).toBeVisible();
  await page.getByLabel("模型 ID").fill("gpt-5.6-sol");
  await page.getByLabel("思考深度").selectOption("high");
  await page
    .locator(".setting-card")
    .first()
    .getByRole("button", { name: "保存" })
    .click();
  await page
    .getByLabel("全局 PRD 模板")
    .fill("# {{需求名称}}\n## 目标\n## 规则\n## 验收标准");
  await page.getByRole("button", { name: "保存模板" }).click();
  await page.getByRole("button", { name: "添加角色" }).click();
  const lastRole = page.locator(".role-row").last();
  await lastRole.locator("input").nth(0).fill("合规");
  await lastRole.locator("input").nth(1).fill("隐私、授权和数据保留期限");
  await page.getByRole("button", { name: "保存角色" }).click();
  await page.reload();
  await page.getByRole("button", { name: "设置" }).click();
  await expect(page.getByLabel("模型 ID")).toHaveValue("gpt-5.6-sol");
  await expect(page.getByLabel("思考深度")).toHaveValue("high");
  await expect(page.getByLabel("全局 PRD 模板")).toHaveValue(/## 验收标准/);
  await expect(
    page.locator(".role-row").last().locator("input").nth(0),
  ).toHaveValue("合规");
  await expect(page.getByText("扩展中心", { exact: true })).toHaveCount(0);
});
