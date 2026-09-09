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
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "新需求" }).click();
  await expect(
    page.getByRole("heading", { name: "今天要设计什么？" }),
  ).toBeVisible();
  await expect(page.locator(".artifact-pane")).toHaveCount(0);
  await expect(page.getByLabel("需求对话输入")).toBeVisible();
  await expect(page.locator("input.inline-model")).toHaveCount(0);
  await expect(page.locator(".composer-controls select")).toHaveCount(0);
  await page.getByRole("button", { name: "本次模型", exact: true }).click();
  await page.getByRole("option", { name: "GPT-5.6 Sol" }).click();
  await expect(
    page.getByRole("button", { name: "本次模型", exact: true }),
  ).toContainText("GPT-5.6 Sol");
  await page.getByRole("button", { name: "本次思考深度", exact: true }).click();
  await page.getByRole("option", { name: "高", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "本次思考深度", exact: true }),
  ).toContainText("高");
  await page.screenshot({
    path: `test-results/${process.env.UX_CAPTURE || "after"}-start.png`,
  });
});

test("knowledge sources sync and chunk search returns relevant text", async ({
  page,
}) => {
  await page.goto("/");
  const project = await createProject(page, "知识库验收");
  const projectId = project.id;
  await page.getByRole("button", { name: "知识库" }).click();

  await page.route(
    "**/api/knowledge/pick-directory",
    (route) => route.fulfill({ json: { path: null } }),
    { times: 1 },
  );
  await page.getByRole("button", { name: "关联本地文件夹" }).click();
  await expect(
    page.getByRole("button", { name: "关联本地文件夹" }),
  ).toBeEnabled();
  await expect(page.locator(".source-card")).toHaveCount(0);
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
  await page.getByRole("button", { name: "关联飞书文档" }).click();
  const linkDialog = page.getByRole("dialog", { name: "关联飞书文档" });
  await expect(linkDialog).toBeVisible();
  await linkDialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(linkDialog).toHaveCount(0);
  await page.getByRole("button", { name: "关联飞书文档" }).click();
  const bounds = await linkDialog.boundingBox();
  const viewport = page.viewportSize()!;
  expect(
    Math.abs(bounds!.x + bounds!.width / 2 - viewport.width / 2),
  ).toBeLessThan(3);
  expect(
    Math.abs(bounds!.y + bounds!.height / 2 - viewport.height / 2),
  ).toBeLessThan(3);

  await expect(
    linkDialog.getByRole("button", { name: "关联文档", exact: true }),
  ).toBeDisabled();
  await linkDialog.getByLabel("飞书文档链接或文档 ID").fill("feishu-rule");
  await linkDialog
    .getByRole("button", { name: "关联文档", exact: true })
    .click();
  await expect(linkDialog).toHaveCount(0);
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
  const search = page.getByPlaceholder("搜索文档或项目规则…");
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
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.getByLabel("需求卡编辑器")).toHaveValue(
    /用户每天领取一次奖励/,
  );

  await page.getByRole("button", { name: "确认需求" }).click();
  const frame = page.frameLocator('iframe[title="交互原型"]');
  await expect(frame.getByRole("button", { name: "领取奖励" })).toBeVisible();
  await page.screenshot({
    path: `test-results/${process.env.UX_CAPTURE || "after"}-prototype.png`,
  });
  const initial = await get(page, `/requirements/${requirement.id}`);
  const initialPrototypeId = initial.requirement.heads.prototype;
  await page.getByRole("button", { name: "点选修改" }).click();
  await frame.getByRole("button", { name: "领取奖励" }).click();
  await expect(page.locator(".selection-chip")).toContainText("#claim");
  await page.getByLabel("选区修改要求").fill("把这个按钮放到右边");
  await page.getByLabel("选区修改要求").press("Enter");
  await expect(page.getByText(/AI 修改候选，仅预览/)).toBeVisible();
  await expect(frame.locator("#claim")).toHaveAttribute("style", /float:right/);
  await page.screenshot({ path: "test-results/candidate.png" });
  expect(
    (await get(page, `/requirements/${requirement.id}`)).requirement.heads
      .prototype,
  ).toBe(initialPrototypeId);
  await page.getByRole("button", { name: "当前版本", exact: true }).click();
  await expect(frame.locator("#claim")).not.toHaveAttribute(
    "style",
    /float:right/,
  );
  await page.getByRole("button", { name: "候选效果", exact: true }).click();
  await expect(frame.locator("#claim")).toHaveAttribute("style", /float:right/);
  await page.keyboard.press("ControlOrMeta+Enter");
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
  await expect(page.locator(".markdown-document")).toContainText("AC-001");
  await page.screenshot({ path: "test-results/prd-reading.png" });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const prdEditor = page.getByLabel("PRD 文档编辑器");
  await expect(prdEditor).toHaveValue(/AC-001/);
  await page.screenshot({
    path: `test-results/${process.env.UX_CAPTURE || "after"}-prd.png`,
  });
  await prdEditor.fill((await prdEditor.inputValue()) + "\n\n补充人工说明。");
  await page.getByRole("button", { name: "保存 PRD" }).click();
  await page.getByRole("button", { name: /AI 评审/ }).click();
  await page.getByRole("button", { name: "开始评审" }).click();
  const issues = page.locator(".issue-card");
  await expect(issues).toHaveCount(3);
  await page.screenshot({ path: "test-results/review-inbox.png" });
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
  await page.getByRole("button", { name: "编辑", exact: true }).click();
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
  await page.screenshot({ path: "test-results/presentation.png" });
  const withBrief = await get(page, `/requirements/${requirement.id}`);
  expect(withBrief.reviewBriefs).toHaveLength(1);
  expect(withBrief.reviewBriefs[0].prdVersionId).toBe(
    withBrief.requirement.heads.prd,
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 HTML" }).click();
  await download;
  await page.getByRole("button", { name: "PRD", exact: true }).last().click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await prdEditor.fill((await prdEditor.inputValue()) + "\n\n终稿后的新修订。");
  await page.getByRole("button", { name: "保存 PRD" }).click();
  await expect(page.getByRole("button", { name: "确认终稿" })).toBeVisible();
  await page.getByRole("button", { name: "评审讲解" }).click();
  await expect(page.getByText(/讲解版本基于旧 PRD/)).toBeVisible();
  await page.getByRole("button", { name: "生成新版本", exact: true }).click();
  await expect(page.locator(".showme-toolbar select option")).toHaveCount(2);
  await page.locator(".showme-toolbar select").selectOption({ index: 0 });
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
  await page
    .locator(".requirement-list")
    .getByRole("button", { name: /^直接终稿/ })
    .click();
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
  await page
    .locator(".requirement-list")
    .getByRole("button", { name: /^隔离原型/ })
    .click();
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

test("settings keep template and review roles with account controls in header", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).click();
  await expect(
    page.getByText("全局 PRD 模板和评审角色。账号管理位于右上角。"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".setting-card")
      .first()
      .getByRole("button", { name: "使用 ChatGPT 登录" }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".setting-card")
      .first()
      .getByRole("button", { name: "退出登录" }),
  ).toHaveCount(0);
  await expect(page.getByText("使用工作台绑定的 Codex")).toHaveCount(0);
  await page
    .getByLabel("全局 PRD 模板")
    .fill("# {{需求名称}}\n## 目标\n## 规则\n## 验收标准");
  const draft =
    "# 模板预览\n## 验收标准\n**重点**\n- 验收项\n\n| 事件名称 | 类型 |\n|---|---|\n| page_view | string |";
  await page.getByLabel("全局 PRD 模板", { exact: true }).fill(draft);
  await page.getByRole("button", { name: "预览", exact: true }).click();
  const preview = page.getByRole("region", { name: "全局 PRD 模板预览" });
  await expect(
    preview.getByRole("heading", { name: "模板预览" }),
  ).toBeVisible();
  await expect(preview.getByRole("cell", { name: "page_view" })).toBeVisible();
  await expect(preview.locator("strong")).toHaveText("重点");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.getByLabel("全局 PRD 模板", { exact: true })).toHaveValue(
    draft,
  );
  await page.getByRole("button", { name: "保存模板" }).click();
  await page.getByRole("button", { name: "添加角色" }).click();
  const lastRole = page.locator(".role-row").last();
  await lastRole.locator("input").nth(0).fill("合规");
  await lastRole.locator("input").nth(1).fill("隐私、授权和数据保留期限");
  await page.getByRole("button", { name: "保存角色" }).click();
  await page.reload();
  await page.getByRole("button", { name: "设置" }).click();
  await expect(page.getByLabel("全局 PRD 模板")).toHaveValue(/## 验收标准/);
  await expect(
    page.locator(".role-row").last().locator("input").nth(0),
  ).toHaveValue("合规");
  await expect(page.getByText("扩展中心", { exact: true })).toHaveCount(0);
});

test("document reading, draft preservation, history, command menu and narrow workspace", async ({
  page,
}) => {
  await page.goto("/");
  const project = await createProject(page, "交互与窄屏验收");
  await page.getByRole("button", { name: "新需求", exact: true }).click();
  const input = page.getByLabel("需求对话输入");
  await input.fill("面向每天登录的用户");
  await input.press("Enter");
  await expect(page.locator(".markdown-document")).toContainText("需求说明");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.getByLabel("需求卡编辑器");
  await editor.fill((await editor.inputValue()) + "\n\n未保存的草稿");
  await expect(
    page.getByRole("button", { name: "确认需求", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "收起成果" }).click();
  await page.getByRole("button", { name: "打开成果" }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(editor).toHaveValue(/未保存的草稿/);
  await page.getByRole("button", { name: "保存修改" }).click();
  await page.getByLabel("需求卡历史版本").selectOption({ index: 1 });
  await page.getByRole("button", { name: "查看", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("只读");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "确认需求", exact: true }).click();
  const frame = page.frameLocator('iframe[title="交互原型"]');
  await expect(frame.locator("#claim")).toBeVisible();
  await page.getByRole("button", { name: "点选修改" }).click();
  await frame.locator("#claim").hover();
  await frame.locator("#claim").click();
  await expect(page.getByLabel("选区修改要求")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("选区修改要求")).toHaveCount(0);
  await page.getByLabel("原型预览尺寸").selectOption("mobile");
  await expect(page.locator(".prototype-frame")).toHaveCSS("width", "402px");
  await page.getByRole("button", { name: "专注成果" }).click();
  await expect(page.locator(".conversation-pane")).toBeHidden();
  for (const width of [1920, 1512, 1100]) {
    await page.setViewportSize({ width, height: 982 });
    const workspaceBounds = await page.locator(".workbench").boundingBox();
    const artifactBounds = await page.locator(".artifact-pane").boundingBox();
    expect(
      Math.abs(artifactBounds!.width - workspaceBounds!.width),
    ).toBeLessThan(2);
  }
  await page.setViewportSize({ width: 1512, height: 982 });

  await page.getByRole("button", { name: "显示对话" }).click();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("搜索命令或需求").fill("知识库");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "知识库", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByLabel("搜索命令或需求").fill("面向每天登录");
  await page.keyboard.press("Enter");
  await expect(frame.locator("#claim")).toBeVisible();
  for (const width of [1280, 900, 600, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole("button", { name: "点选修改" })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await input.scrollIntoViewIfNeeded();
    await expect(input).toBeVisible();
    await input.fill("长对话内容".repeat(50));
    await expect(page.getByRole("button", { name: "发送消息" })).toBeVisible();
    await page.screenshot({ path: `test-results/responsive-${width}.png` });
  }
});

test("knowledge source filters, empty search, version drawer and safe document preview", async ({
  page,
}) => {
  await page.goto("/");
  const project = await createProject(page, "文档浏览验收");
  for (let i = 1; i <= 4; i++)
    await post(page, "/knowledge/text", {
      projectId: project.id,
      name: "非常长的项目业务规则文档名称用于检查换行与侧栏版本浏览".repeat(3),
      content: `# 版本 ${i}\n规则正文 [K1]\n<script>window.pwned=true</script>\n\n| 规则 | 行为 |\n| --- | --- |\n| R-001 | 只读 |`,
      state: "confirmed",
    });
  await page.getByRole("button", { name: "知识库", exact: true }).click();
  await page
    .getByPlaceholder("搜索文档或项目规则…")
    .fill("完全不存在的关键词xyz");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(
    page.getByText("没有找到匹配资料。试试其他关键词。"),
  ).toBeVisible();
  await expect(page.locator(".knowledge-item")).toHaveCount(0);
  await page.getByPlaceholder("搜索文档或项目规则…").fill("");
  await page.locator(".document-link").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("知识文档版本").locator("option")).toHaveCount(
    4,
  );
  await page.getByLabel("知识文档版本").selectOption({ index: 3 });
  await expect(page.getByRole("dialog")).toContainText("版本 1");
  await expect(page.getByRole("table")).toContainText("R-001");
  expect(await page.evaluate(() => (window as any).pwned)).toBeUndefined();
  const drawerBefore = (await page.locator(".knowledge-drawer").boundingBox())!
    .width;
  const divider = await page
    .getByRole("separator", { name: "知识文档侧栏宽度", exact: true })
    .boundingBox();
  await page.mouse.move(divider!.x + 4, divider!.y + 100);
  await page.mouse.down();
  await page.mouse.move(divider!.x - 80, divider!.y + 100, { steps: 8 });
  await page.mouse.up();
  expect(
    (await page.locator(".knowledge-drawer").boundingBox())!.width,
  ).toBeGreaterThan(drawerBefore + 60);
  await page.screenshot({ path: "test-results/knowledge-document.png" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "飞书", exact: true }).click();
  await expect(page.locator(".knowledge-item")).toHaveCount(0);
  await page.getByRole("button", { name: "全部资料", exact: true }).click();
  await expect(page.locator(".knowledge-item")).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/knowledge-mobile.png" });
});

test("composer attaches explicit references and guards IME and blank submissions", async ({
  page,
}) => {
  await page.goto("/");
  const project = await createProject(page, "附件与输入法验收");
  await page.getByRole("button", { name: "新需求", exact: true }).click();
  const input = page.getByLabel("需求对话输入");
  await expect(page.getByRole("button", { name: "发送消息" })).toBeDisabled();
  await input.fill("输入法测试");
  await input.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    isComposing: true,
  });
  expect(
    (await get(page, "/bootstrap")).requirements.filter(
      (r: any) => r.projectId === project.id,
    ),
  ).toHaveLength(0);
  await page.getByLabel("附加参考资料").setInputFiles({
    name: "附件规则.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# 附件规则\n每天领取一次。"),
  });
  await input.press("Shift+Enter");
  await expect(input).toHaveValue(/\n/);
  await input.press("Enter");
  await expect(page.locator(".markdown-document")).toBeVisible();
  const requirement = (await get(page, "/bootstrap")).requirements.find(
    (r: any) => r.projectId === project.id,
  );
  const workspace = await get(page, `/requirements/${requirement.id}`);
  expect(
    workspace.tasks
      .at(-1)
      .snapshot.contextPack.items.some((i: any) => i.title === "附件规则.md"),
  ).toBe(true);
  await page.locator(".execution-status summary").first().click();
  await expect(page.locator(".execution-details")).toContainText("本轮参考了");
  await page.getByText("Recall Debug · 开发调试").click();
  await expect(page.locator(".execution-details pre")).toContainText(
    "tokenBudget",
  );
});

test("execution exposes running, stop, failure and successful retry without chat logs", async ({
  page,
}) => {
  await page.goto("/");
  await createProject(page, "执行状态验收");
  await page.getByRole("button", { name: "新需求", exact: true }).click();
  const input = page.getByLabel("需求对话输入");
  await input.fill("UI_TEST_SLOW");
  await input.press("Enter");
  await expect(
    page.getByRole("button", { name: "停止生成", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".execution-status")).toContainText("正在处理");
  await page.getByRole("button", { name: "停止生成", exact: true }).click();
  await expect(page.locator(".execution-status")).toContainText("已停止");
  await input.fill("UI_TEST_FAIL");
  await input.press("Enter");
  await expect(page.locator(".execution-status")).toContainText("执行失败");
  await page.locator(".execution-status summary").first().click();
  await expect(page.locator(".execution-details")).toContainText(
    "TEST MOCK injected failure",
  );
  await page
    .locator(".execution-status")
    .getByRole("button", { name: "重试", exact: true })
    .click();
  await expect(page.locator(".markdown-document")).toContainText("需求说明");
  await expect(page.locator(".execution-status")).toContainText("已完成");
});

test("long documents keep frozen citation previews and preserve drafts when the head changes", async ({
  page,
}) => {
  await page.goto("/");
  const project = await createProject(page, "引用与并发草稿验收");
  await post(page, "/knowledge/text", {
    projectId: project.id,
    name: "每日奖励事实",
    content: "# 奖励规则\n每日奖励只可领取一次。",
    state: "confirmed",
  });
  await page.getByRole("button", { name: "新需求", exact: true }).click();
  const input = page.getByLabel("需求对话输入");
  await input.fill("每日奖励规则");
  await input.press("Enter");
  await expect(page.locator(".markdown-document")).toBeVisible();
  const requirement = (await get(page, "/bootstrap")).requirements.find(
    (r: any) => r.projectId === project.id,
  );
  let workspace = await get(page, `/requirements/${requirement.id}`);
  let base = workspace.requirement.heads.requirement;
  const content =
    "# 长文档验收\n" +
    Array.from(
      { length: 45 },
      (_, i) =>
        `\n## 第 ${i + 1} 节\n每日奖励只可领取一次 [K1]。\n${"规则说明。".repeat(30)}\n`,
    ).join("");
  for (let i = 0; i < 12; i++) {
    const v = await post(page, `/requirements/${requirement.id}/versions`, {
      kind: "requirement",
      base,
      content: content + `\n修订 ${i}`,
      metadata: {},
    });
    base = v.id;
  }
  await expect(page.locator(".markdown-document")).toContainText("修订 11");
  await expect(page.getByLabel("需求卡历史版本").locator("option")).toHaveCount(
    13,
  );
  const citation = page.locator(".citation").first();
  await citation.hover();
  await expect(citation.getByRole("tooltip")).toContainText("每日奖励事实");
  await expect(citation.getByRole("tooltip")).toContainText(
    "每日奖励只可领取一次",
  );
  await citation.focus();
  await expect(citation.getByRole("tooltip")).toBeVisible();
  await page
    .getByLabel("文档大纲")
    .getByRole("button", { name: "第 45 节", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "第 45 节", exact: true }),
  ).toBeInViewport();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("需求卡编辑器").fill(content + "\n我的未保存草稿");
  await post(page, `/requirements/${requirement.id}/versions`, {
    kind: "requirement",
    base,
    content: "# 另一个正式版本",
    metadata: {},
  });
  await expect(page.getByRole("alert")).toContainText("未保存草稿已保留");
  await expect(page.getByLabel("需求卡编辑器")).toHaveValue(/我的未保存草稿/);
  await expect(page.getByRole("button", { name: "保存修改" })).toBeDisabled();
  await page.getByRole("button", { name: "放弃草稿，载入新版" }).click();
  await expect(page.getByLabel("需求卡编辑器")).toHaveValue("# 另一个正式版本");
});

test("all projects and requirements expose confirmed deletion and recovery", async ({
  page,
}) => {
  await page.goto("/");
  const project = await createProject(page, "删除入口验收");
  const r = await post(page, "/requirements", {
    projectId: project.id,
    name: "待删需求",
    mode: "full",
  });
  const keep = await post(page, "/requirements", {
    projectId: project.id,
    name: "保留需求",
    mode: "full",
  });
  await page.reload();
  await page
    .getByRole("button", { name: "删除需求 待删需求", exact: true })
    .click();
  const confirm = page.getByRole("dialog", { name: "删除需求", exact: true });
  await expect(
    confirm.getByRole("button", { name: "移入回收站" }),
  ).toBeDisabled();
  await confirm.getByLabel("输入名称确认删除").fill("错误");
  await expect(
    confirm.getByRole("button", { name: "移入回收站" }),
  ).toBeDisabled();
  await confirm.getByRole("button", { name: "取消", exact: true }).click();
  expect(
    (await get(page, "/bootstrap")).requirements.some(
      (x: any) => x.id === r.id,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "删除需求 待删需求", exact: true })
    .click();
  await page.getByLabel("输入名称确认删除").fill("待删需求");
  await page.getByRole("button", { name: "移入回收站" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    (await get(page, "/bootstrap")).requirements.some(
      (x: any) => x.id === r.id,
    ),
  ).toBe(false);
  expect(
    (await get(page, "/bootstrap")).requirements.some(
      (x: any) => x.id === keep.id,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "回收站", exact: true }).click();
  await page
    .locator(".resource-row")
    .filter({ hasText: "待删需求" })
    .getByRole("button", { name: "恢复", exact: true })
    .click();
  await page.getByRole("button", { name: "关闭管理面板" }).click();
  await page
    .locator(".requirement-list .req-row")
    .filter({ hasText: "待删需求" })
    .click();
  await page.getByRole("button", { name: "删除当前需求", exact: true }).click();
  await page.getByLabel("输入名称确认删除").fill("待删需求");
  await page.getByRole("button", { name: "移入回收站" }).click();
  await expect(
    page.getByRole("heading", { name: "需求", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "管理项目", exact: true }).click();
  await page
    .locator(".resource-row")
    .filter({ hasText: "删除入口验收" })
    .getByRole("button", { name: "删除项目", exact: true })
    .click();
  await page.getByLabel("输入名称确认删除").fill("删除入口验收");
  await page.getByRole("button", { name: "移入回收站" }).click();
  await expect(
    page.getByRole("dialog", { name: "删除项目", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "关闭管理面板" }).click();
  expect(
    (await get(page, "/bootstrap")).projects.some(
      (x: any) => x.id === project.id,
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "回收站", exact: true }).click();
  await page
    .locator(".resource-row")
    .filter({ hasText: "删除入口验收" })
    .getByRole("button", { name: "恢复", exact: true })
    .click();
  await expect(
    page.locator(".resource-row").filter({ hasText: "待删需求" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭管理面板" }).click();
  await page.getByLabel("当前项目").selectOption(project.id);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "管理项目", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "删除需求 保留需求", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("@smoke new requirement through candidate apply to PRD", async ({
  page,
}) => {
  await page.goto("/");
  await createProject(page, "CI 核心交互");
  await page.getByRole("button", { name: "新需求", exact: true }).click();
  await page.getByLabel("需求对话输入").fill("面向每天登录的用户");
  await page.getByLabel("需求对话输入").press("Enter");
  await expect(page.locator(".markdown-document")).toContainText("需求说明");
  await page.getByRole("button", { name: "确认需求", exact: true }).click();
  const frame = page.frameLocator('iframe[title="交互原型"]');
  await expect(frame.locator("#claim")).toBeVisible();
  await page.getByRole("button", { name: "点选修改" }).click();
  await frame.locator("#claim").click();
  await page.getByLabel("选区修改要求").fill("把这个按钮放到右边");
  await page.getByLabel("选区修改要求").press("Enter");
  await expect(page.getByText(/AI 修改候选，仅预览/)).toBeVisible();
  await page.getByRole("button", { name: "应用修改", exact: true }).click();
  await expect(page.getByText(/AI 修改候选，仅预览/)).toHaveCount(0);
  await expect(frame.locator("#claim")).toHaveAttribute("style", /float:right/);
  await page.getByRole("button", { name: "确认原型", exact: true }).click();
  await expect(page.locator(".markdown-document")).toContainText("AC-001");
});

test("local recovery survives reload, rejects stale restore and clears after save", async ({
  page,
}) => {
  await page.goto("/");
  const project = await createProject(page, "本地恢复验收");
  await page.getByRole("button", { name: "新需求", exact: true }).click();
  await page.getByLabel("需求对话输入").fill("面向每天登录的用户");
  await page.getByLabel("需求对话输入").press("Enter");
  await expect(page.locator(".markdown-document")).toBeVisible();
  const req = (await get(page, "/bootstrap")).requirements.find(
    (r: any) => r.projectId === project.id,
  );
  const reopen = async () => {
    await page.reload();
    await page.locator(".req-row").filter({ hasText: "面向每天登录" }).click();
  };
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("需求卡编辑器").fill("# 刷新前草稿");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(localStorage).some((k) =>
          k.startsWith("forge:artifact-draft:"),
        ),
      ),
    )
    .toBe(true);
  await reopen();
  await expect(page.getByLabel("本地草稿恢复")).toContainText("发现未保存草稿");
  await expect(page.locator(".markdown-document")).not.toContainText(
    "刷新前草稿",
  );
  await page.getByRole("button", { name: "恢复草稿" }).click();
  await expect(page.locator(".markdown-document")).toContainText("刷新前草稿");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(localStorage).filter((k) =>
            k.startsWith("forge:artifact-draft:"),
          ).length,
      ),
    )
    .toBe(0);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("需求卡编辑器").fill("# 旧版本本地草稿");
  const ws = await get(page, `/requirements/${req.id}`);
  await post(page, `/requirements/${req.id}/versions`, {
    kind: "requirement",
    base: ws.requirement.heads.requirement,
    content: "# 新版服务器文档",
    metadata: {},
  });
  await reopen();
  await expect(page.getByLabel("本地草稿恢复")).toContainText("草稿基于旧版本");
  await expect(page.getByRole("button", { name: "恢复草稿" })).toHaveCount(0);
  await page.getByText("查看草稿", { exact: true }).click();
  await expect(page.getByLabel("本地草稿恢复")).toContainText("旧版本本地草稿");
  await expect(page.locator(".markdown-document")).toContainText(
    "新版服务器文档",
  );
  await page
    .getByLabel("本地草稿恢复")
    .getByRole("button", { name: "放弃", exact: true })
    .click();
  await reopen();
  await expect(page.getByLabel("本地草稿恢复")).toHaveCount(0);
  await page.getByRole("button", { name: "确认需求", exact: true }).click();
  await expect(
    page.frameLocator('iframe[title="交互原型"]').locator("#claim"),
  ).toBeVisible();
  await page.getByRole("button", { name: "确认原型", exact: true }).click();
  await expect(page.locator(".markdown-document")).toContainText("AC-001");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("PRD 文档编辑器").fill("# PRD 恢复内容");
  await reopen();
  await page.getByRole("button", { name: "恢复草稿" }).click();
  await expect(page.locator(".markdown-document")).toContainText(
    "PRD 恢复内容",
  );
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
  });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("PRD 文档编辑器").fill("# 存储失败仍保留编辑内容");
  await expect(page.getByRole("alert")).toContainText("本地草稿备份失败");
  await expect(page.getByLabel("PRD 文档编辑器")).toHaveValue(
    "# 存储失败仍保留编辑内容",
  );
});

test("desktop splitters resize, persist, reset and keep narrow layouts usable", async ({
  page,
}) => {
  await page.goto("/");
  await createProject(page, "可拖动分栏验收");
  const drag = async (name: string, dx: number) => {
    const handle = page.getByRole("separator", { name, exact: true });
    const box = await handle.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(
      box!.x + box!.width / 2,
      box!.y + Math.min(80, box!.height / 2),
    );
    await page.mouse.down();
    await page.mouse.move(
      box!.x + box!.width / 2 + dx,
      box!.y + Math.min(80, box!.height / 2),
      { steps: 8 },
    );
    await page.mouse.up();
  };
  const width = async (selector: string) =>
    (await page.locator(selector).boundingBox())!.width;
  const rail = await width(".rail");
  await drag("导航宽度", 60);
  expect(await width(".rail")).toBeGreaterThan(rail + 40);
  await page.reload();
  expect(await width(".rail")).toBeGreaterThan(rail + 40);
  await page
    .getByRole("separator", { name: "导航宽度", exact: true })
    .dblclick();
  await expect.poll(() => width(".rail")).toBe(rail);
  await page.getByRole("button", { name: "新需求", exact: true }).click();
  await page.getByLabel("需求对话输入").fill("面向每天登录的用户");
  await page.getByLabel("需求对话输入").press("Enter");
  await expect(page.locator(".markdown-document")).toBeVisible();
  const before = await width(".conversation-pane");
  await drag("对话与成果分栏", 70);
  expect(await width(".conversation-pane")).toBeGreaterThan(before + 50);
  const outline = await width(".document-outline");
  await page
    .getByRole("separator", { name: "大纲与正文分栏", exact: true })
    .focus();
  await page.keyboard.press("ArrowRight");
  expect(await width(".document-outline")).toBeGreaterThan(outline);
  await page.getByRole("button", { name: "对照", exact: true }).click();
  const editor = await width(".doc-editor");
  await drag("编辑与预览分栏", 35);
  expect(await width(".doc-editor")).toBeGreaterThan(editor + 20);
  await page.getByRole("button", { name: "知识库", exact: true }).click();
  const source = await width(".source-column");
  await drag("知识来源与文档分栏", 40);
  expect(await width(".source-column")).toBeGreaterThan(source + 25);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("separator", { name: "知识来源与文档分栏", exact: true }),
  ).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("trash permanently deletes projects and requirements only after name confirmation", async ({
  page,
}) => {
  await page.goto("/");
  const p = await createProject(page, "永久删除验收");
  const r = await post(page, "/requirements", {
    projectId: p.id,
    name: "待清理需求",
  });
  const remove = async (path: string, name: string) =>
    page.evaluate(
      async ({ path, name }) => {
        const b = await (await fetch("/api/bootstrap")).json();
        const response = await fetch("/api" + path, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            "X-Forge-CSRF": b.csrf,
          },
          body: JSON.stringify({ confirmedName: name }),
        });
        if (!response.ok) throw new Error(await response.text());
      },
      { path, name },
    );
  await remove(`/requirements/${r.id}`, r.name);
  await page.reload();
  await page.getByRole("button", { name: "回收站", exact: true }).click();
  const row = page.locator(".resource-row").filter({ hasText: r.name });
  await row.getByRole("button", { name: "永久删除", exact: true }).click();
  const confirm = page.getByRole("dialog", {
    name: "永久删除需求",
    exact: true,
  });
  await expect(confirm).toContainText("不可恢复");
  await expect(
    confirm.getByRole("button", { name: "永久删除", exact: true }),
  ).toBeDisabled();
  await confirm.getByRole("button", { name: "取消", exact: true }).click();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "永久删除", exact: true }).click();
  await confirm.getByLabel("输入名称确认删除").fill(r.name);
  await confirm.getByRole("button", { name: "永久删除", exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.getByLabel("关闭管理面板").click();
  await remove(`/projects/${p.id}`, p.name);
  await page.reload();
  await page.getByRole("button", { name: "回收站", exact: true }).click();
  const projectRow = page.locator(".resource-row").filter({ hasText: p.name });
  await projectRow
    .getByRole("button", { name: "永久删除", exact: true })
    .click();
  const projectConfirm = page.getByRole("dialog", {
    name: "永久删除项目",
    exact: true,
  });
  await projectConfirm.getByLabel("输入名称确认删除").fill(p.name);
  await projectConfirm
    .getByRole("button", { name: "永久删除", exact: true })
    .click();
  await expect(projectRow).toHaveCount(0);
});

test("prototype is optional and skip proceeds to PRD without generating a prototype", async ({
  page,
}) => {
  await page.goto("/");
  const project = await createProject(page, "跳过原型验收");
  await page.getByRole("button", { name: "新需求", exact: true }).click();
  await page.getByLabel("需求对话输入").fill("面向每天登录的用户");
  await page.getByLabel("需求对话输入").press("Enter");
  await expect(
    page.getByRole("button", { name: "跳过原型，生成 PRD", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "跳过原型，生成 PRD", exact: true })
    .click();
  await expect(page.locator(".markdown-document")).toContainText("AC-001");
  const req = (await get(page, "/bootstrap")).requirements.find(
    (r: any) => r.projectId === project.id,
  );
  const ws = await get(page, `/requirements/${req.id}`);
  expect(ws.requirement.heads.prototype).toBeFalsy();
  expect(ws.requirement.waiver.requirementVersion).toBe(
    ws.requirement.heads.requirement,
  );
  expect(ws.tasks.some((t: any) => t.kind === "prototype")).toBe(false);
});

test("prototype bundle switches both views without generation and shows explanations", async ({
  page,
}) => {
  await page.goto("/");
  const project = await createProject(page, "双视图验收");
  await page.getByRole("button", { name: "新需求", exact: true }).click();
  await page.getByLabel("需求对话输入").fill("面向每天登录的用户");
  await page.getByLabel("需求对话输入").press("Enter");
  await expect(page.getByLabel("生成原型风格")).toHaveCount(0);
  await page.getByRole("button", { name: "确认需求", exact: true }).click();
  const frame = page.frameLocator('iframe[title="交互原型"]');
  await expect(frame.locator("#claim")).toBeVisible();
  await expect(page.getByLabel("原型预览尺寸")).toHaveValue("mobile");
  await expect(page.locator(".prototype-frame")).toHaveCSS("width", "402px");
  await expect(page.locator(".prototype-frame")).toHaveCSS("height", "874px");
  await expect(page.getByLabel("原型解释")).toContainText("每日奖励页");
  await expect(page.getByLabel("原型解释")).toContainText(
    "点击重试恢复可领取状态",
  );
  await expect(
    page.getByRole("button", { name: "生成高保真", exact: true }),
  ).toHaveCount(0);
  const b = await get(page, "/bootstrap");
  const req = b.requirements.find((r: any) => r.projectId === project.id);
  const initial = await get(page, `/requirements/${req.id}`);
  for (const mode of ["wireframe", "high", "wireframe"]) {
    await page.getByLabel("原型视图", { exact: true }).selectOption(mode);
    await expect(frame.locator("html")).toHaveAttribute(
      "data-prototype-view",
      mode,
    );
    await expect(frame.locator("#claim")).toHaveCSS(
      "border-radius",
      mode === "wireframe" ? "0px" : "10px",
    );
    await expect
      .poll(() =>
        frame
          .locator("#claim")
          .evaluate((el: HTMLButtonElement) => typeof el.onclick),
      )
      .toBe("function");
    await frame.locator("#reset").click();
    await frame.locator("#claim").click();
    await expect(frame.locator("#status")).toHaveText("领取成功");
  }
  const after = await get(page, `/requirements/${req.id}`);
  expect(after.tasks.length).toBe(initial.tasks.length);
  expect(after.requirement.heads.prototype).toBe(
    initial.requirement.heads.prototype,
  );
  await page.getByLabel("原型缩放比例").selectOption("50");
  await expect
    .poll(
      async () => (await page.locator(".prototype-frame").boundingBox())!.width,
    )
    .toBe(201);
  expect(await frame.locator("html").evaluate(() => innerWidth)).toBe(402);
  const clickScaled = async (selector: string) => {
    const outer = (await page.locator(".prototype-frame").boundingBox())!;
    const inner = await frame.locator(selector).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.click(outer.x + inner.x * 0.5, outer.y + inner.y * 0.5);
  };
  await clickScaled("#reset");
  await clickScaled("#claim");
  await expect(frame.locator("#status")).toHaveText("领取成功");
  await page.getByLabel("原型缩放比例").selectOption("150");
  await expect
    .poll(
      async () => (await page.locator(".prototype-frame").boundingBox())!.width,
    )
    .toBe(603);
  await page.getByLabel("原型缩放比例").selectOption("100");
  await page.screenshot({
    path: "test-results/prototype-dual-explanations.png",
  });
});
