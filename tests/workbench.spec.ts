import { test, expect } from "@playwright/test";
const post = async (page: any, path: string, body: any) =>
  page.evaluate(
    async ({ path, body }: any) => {
      const b = await (await fetch("/api/bootstrap")).json();
      const r = await fetch("/api" + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forge-CSRF": b.csrf },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    { path, body },
  );
const dialog = async (page: any, name: string, value: string) => {
  await page.getByRole("dialog").getByLabel(name, { exact: true }).fill(value);
};
test("browser full flow: create project, knowledge, confirm, two clickable styles, restore, PRD and publish Mock", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await dialog(page, "项目名称", "奖励体验实验室");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await page.getByRole("button", { name: "知识库", exact: true }).click();
  await page.getByRole("button", { name: "文本", exact: true }).click();
  await dialog(page, "资料名称", "奖励规则");
  await dialog(page, "内容", "每天奖励仅可领取一次，重复请求不重复发奖。");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await expect(page.getByText("奖励规则.md", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "项目", exact: false })
    .filter({ hasText: "项目" })
    .first()
    .click();
  await page.getByRole("button", { name: "新建需求", exact: true }).click();
  await dialog(page, "需求名称", "每日奖励领取");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "需求卡编辑器" })
    .fill("# 需求\n用户每天只能领取一次奖励。\n重复领取不发奖。");
  await page.getByRole("button", { name: "保存版本", exact: true }).click();
  await page.getByRole("button", { name: "确认需求卡", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await page.getByRole("button", { name: "交互原型", exact: true }).click();
  await page
    .getByRole("textbox", { name: "给产品助手的任务" })
    .fill("生成可点击的奖励领取原型");
  await page.getByRole("button", { name: "开始任务", exact: true }).click();
  const frame = page.frameLocator('iframe[title="交互原型预览"]');
  await frame.getByRole("button", { name: "领取奖励", exact: true }).click();
  await expect(frame.getByText("领取成功", { exact: true })).toBeVisible();
  await frame
    .getByRole("button", { name: "模拟网络异常", exact: true })
    .click();
  await expect(frame.getByText("网络异常", { exact: true })).toBeVisible();
  await frame.getByRole("button", { name: "重试", exact: true }).click();
  await page.getByRole("button", { name: "任务配置", exact: true }).click();
  await page
    .getByLabel("视觉风格", { exact: true })
    .selectOption({ label: "墨色编辑风格" });
  await page
    .getByRole("textbox", { name: "给产品助手的任务" })
    .fill("切换成墨色风格，保留交互");
  await page.getByRole("button", { name: "开始任务", exact: true }).click();
  await expect(frame.locator("body")).toHaveCSS(
    "background-color",
    "rgb(32, 37, 33)",
  );
  await page.getByRole("button", { name: /v1.*AI/ }).click();
  await page.getByRole("button", { name: "恢复为新版本", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(frame.locator("body")).toHaveCSS(
    "background-color",
    "rgb(246, 248, 245)",
  );
  await page.getByRole("button", { name: "批注", exact: true }).click();
  await dialog(page, "批注", "补充失败后的重试体验");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await page.getByRole("button", { name: "确认交互原型", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByText("原型已确认 / 编写 PRD", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "PRD 文档", exact: true }).click();
  await page
    .getByRole("textbox", { name: "给产品助手的任务" })
    .fill("根据已确认原型撰写研发 PRD");
  await page.getByRole("button", { name: "开始任务", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "PRD 文档编辑器" }),
  ).toContainText("");
  await expect
    .poll(() =>
      page.getByRole("textbox", { name: "PRD 文档编辑器" }).inputValue(),
    )
    .toContain("验收标准");
  await page.getByRole("button", { name: "评审", exact: true }).click();
  await page
    .getByRole("textbox", { name: "给产品助手的任务" })
    .fill("评审当前 PRD");
  await page.getByRole("button", { name: "开始任务", exact: true }).click();
  await expect(
    page.getByText("本次评审未报告问题，仍需用户确认终稿。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "PRD 文档", exact: true }).click();
  await page.getByRole("button", { name: "确认终稿", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "已是终稿" })).toBeVisible();
  await page.getByRole("button", { name: "飞书交付", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "生成发布预览" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认发布到飞书" })
    .click();
  await expect(page.getByText("飞书交付 · 已发布")).toBeVisible();
  await page.screenshot({ path: "docs/workspace-tested.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("malicious prototype cannot reach parent storage or workbench API", async ({
  page,
}) => {
  await page.goto("/");
  const p = await post(page, "/projects", { name: "隔离安全验证" });
  const r = await post(page, "/requirements", {
    name: "沙箱",
    projectId: p.id,
    mode: "prototype",
  });
  const { html, metadata } = await import("./fixtures.ts");
  const attack = html().replace(
    "</body>",
    `<script>window.testResult={};try{parent.localStorage.setItem('prototype-pwned','yes');window.testResult.parent=true}catch(e){window.testResult.parent=false}fetch('/api/bootstrap').then(()=>window.testResult.fetch=true).catch(()=>window.testResult.fetch=false);</script></body>`,
  );
  const v = await post(page, "/requirements/" + r.id + "/versions", {
    kind: "prototype",
    content: attack,
    base: null,
    metadata,
  });
  await page.evaluate(
    ({ p, r }: any) => {
      localStorage.setItem("forge-project", p.id);
      localStorage.setItem("forge-requirement", r.id);
    },
    { p, r },
  );
  await page.reload();
  await page.getByRole("button", { name: "交互原型", exact: true }).click();
  const iframe = page.frameLocator("iframe");
  await expect(
    iframe.getByRole("button", { name: "领取奖励", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      iframe
        .locator("body")
        .evaluate(() => JSON.stringify((window as any).testResult)),
    )
    .toBe('{"parent":false,"fetch":false}');
  expect(
    await page.evaluate(() => localStorage.getItem("prototype-pwned")),
  ).toBeNull();
});

test("manual draft survives reload, extension editor and narrow PRD import work", async ({
  page,
}) => {
  await page.goto("/");
  const p = await post(page, "/projects", { name: "文档独立任务" });
  const r = await post(page, "/requirements", {
    name: "只评审",
    projectId: p.id,
    mode: "review",
  });
  await page.evaluate(
    ({ p, r }: any) => {
      localStorage.setItem("forge-project", p.id);
      localStorage.setItem("forge-requirement", r.id);
    },
    { p, r },
  );
  await page.reload();
  const editor = page.getByRole("textbox", { name: "PRD 文档编辑器" });
  await editor.fill("# 本地未保存草稿");
  await page.reload();
  await expect(editor).toHaveValue("# 本地未保存草稿");
  await page.getByRole("button", { name: "扩展中心", exact: true }).click();
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await dialog(page, "名称", "验收优先模板");
  await page
    .getByRole("dialog")
    .getByLabel("类型", { exact: true })
    .selectOption("template");
  await dialog(page, "适用阶段（逗号分隔）", "prd");
  await dialog(page, "内容", "# {{需求名称}}\n## 验收先行\n## 决策记录");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "验收优先模板" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).first().click();
  await expect(
    page.getByRole("heading", { name: "Codex · 默认产品助手" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 2,
    ),
  ).toBeTruthy();
});

test("Codex defaults, model/depth persistence, Chinese Skills and project trash through UI (Mock)", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await dialog(page, "项目名称", "可恢复项目");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await page.getByRole("button", { name: "新建需求", exact: true }).click();
  await dialog(page, "需求名称", "助手配置验证");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await page.getByRole("button", { name: "任务配置", exact: true }).click();
  await expect(page.getByLabel("产品助手", { exact: true })).toHaveValue(
    "codex",
  );
  await page.getByLabel("任务模型", { exact: true }).fill("gpt-5.6-sol");
  await page.getByLabel("任务思考深度", { exact: true }).selectOption("high");
  await page
    .getByRole("textbox", { name: "给产品助手的任务" })
    .fill("整理需求");
  await page.getByRole("button", { name: "开始任务", exact: true }).click();
  await page.getByText("执行记录与固定版本", { exact: true }).click();
  await expect(
    page.getByText("思考深度：high", { exact: false }),
  ).toBeVisible();
  await page.reload();
  await page.getByText("执行记录与固定版本", { exact: true }).click();
  await expect(
    page.getByText("思考深度：high", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "项目", exact: false })
    .first()
    .click();
  // Selecting the project opens its dashboard rather than the current requirement.
  await page.getByRole("button", { name: "可恢复项目", exact: true }).click();
  await page.getByRole("button", { name: "删除项目", exact: true }).click();
  await dialog(page, "输入项目名称确认", "错误名称");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "移入回收站" })
    .click();
  await expect(
    page.getByRole("dialog").getByText("请输入完整项目名称确认删除"),
  ).toBeVisible();
  await dialog(page, "输入项目名称确认", "可恢复项目");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "移入回收站" })
    .click();
  await expect(
    page.getByRole("button", { name: "可恢复项目", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: /^回收站/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "恢复项目" })
    .click();
  await expect(
    page.getByRole("heading", { name: "可恢复项目", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "助手配置验证", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "扩展中心", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "需求整理与确认", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "低保真线框原型", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "GitHub 导入 Skill", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("来源", { exact: true }),
  ).toHaveValue("github");
  await dialog(page, "目录 / GitHub URL", "https://github.com/example/demo");
  await page.route("**/api/extensions/import", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.source).toBe("github");
    expect(body.location).toBe("https://github.com/example/demo");
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: "GitHub 测试网络错误（Mock）" }),
    });
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText("GitHub 测试网络错误（Mock）"),
  ).toBeVisible();
});

test("system assistant model and reasoning settings persist after refresh", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).first().click();
  const card = page.locator(".setting-card").filter({
    has: page.getByRole("heading", {
      name: "Codex · 默认产品助手",
      exact: true,
    }),
  });
  await card.getByRole("button", { name: "编辑", exact: true }).click();
  await dialog(page, "模型 ID", "gpt-5.6-sol");
  await page
    .getByRole("dialog")
    .getByLabel("思考深度", { exact: true })
    .selectOption("high");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await page.reload();
  await page.getByRole("button", { name: "设置", exact: true }).first().click();
  await expect(
    card.getByText("codex · gpt-5.6-sol · high", { exact: true }),
  ).toBeVisible();
});

test("central assistant layout, subscription login UI and permanent recycle-bin deletion (Mock)", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await dialog(page, "项目名称", "永久删除界面测试");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await page.getByRole("button", { name: "新建需求", exact: true }).click();
  await dialog(page, "需求名称", "中间助手");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "需求卡编辑器" })
    .fill("永久删除的本地草稿");
  const draftKey = await page.evaluate(() =>
    Object.keys(localStorage).find(
      (k) => localStorage.getItem(k) === "永久删除的本地草稿",
    ),
  );
  expect(draftKey).toBeTruthy();
  await page
    .getByRole("button", { name: "选择本次任务模型与思考深度" })
    .click();
  await page
    .getByRole("dialog", { name: "本次任务模型" })
    .getByRole("button", { name: "6 astra", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "本次任务模型" })
    .getByRole("button", { name: "低", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "本次任务模型" }),
  ).not.toBeVisible();
  await expect(page.locator(".composer-model")).toContainText("6 astra");
  await expect(page.locator(".composer-model")).toContainText("低");
  await page.getByRole("button", { name: "任务配置", exact: true }).click();
  await expect(page.getByLabel("任务模型", { exact: true })).toHaveValue(
    "gpt-6-astra",
  );
  await expect(page.getByLabel("任务思考深度", { exact: true })).toHaveValue(
    "low",
  );
  await page.getByRole("button", { name: "任务配置", exact: true }).click();
  await page
    .getByRole("textbox", { name: "给产品助手的任务" })
    .fill("梳理这个需求的页面流程与验收标准");
  await page.screenshot({ path: "test-results/central-composer.png" });
  const artifact = await page.locator(".artifact-panel").boundingBox(),
    assistant = await page.locator(".agent-panel").boundingBox();
  expect(artifact).toBeTruthy();
  expect(assistant).toBeTruthy();
  expect(artifact!.x).toBeGreaterThanOrEqual(
    assistant!.x + assistant!.width - 2,
  );
  expect(Math.abs(artifact!.width - assistant!.width)).toBeLessThan(2);
  expect(Math.abs(assistant!.y - artifact!.y)).toBeLessThan(2);
  expect(Math.abs(assistant!.height - artifact!.height)).toBeLessThan(2);
  const conversation = await page.locator(".agent-scroll").boundingBox();
  expect(conversation!.height).toBeGreaterThan(250);
  await expect(
    page.getByRole("textbox", { name: "给产品助手的任务" }),
  ).toBeInViewport();
  await page
    .getByRole("button", { name: "永久删除界面测试", exact: true })
    .click();
  await page.getByRole("button", { name: "删除项目", exact: true }).click();
  await dialog(page, "输入项目名称确认", "永久删除界面测试");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "移入回收站", exact: true })
    .click();
  await page.getByRole("button", { name: "清理回收站", exact: true }).click();
  const select = page.getByRole("dialog").getByLabel("已删除项目");
  const option = await select
    .locator("option")
    .filter({ hasText: "永久删除界面测试" })
    .getAttribute("value");
  await select.selectOption(option!);
  await dialog(page, "输入项目名称确认永久删除", "错误名字");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "永久删除，不可恢复" })
    .click();
  await expect(
    page.getByRole("dialog").getByText("请输入完整项目名称确认永久删除"),
  ).toBeVisible();
  await dialog(page, "输入项目名称确认永久删除", "永久删除界面测试");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "永久删除，不可恢复" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  expect(
    await page.evaluate((key) => localStorage.getItem(key!), draftKey),
  ).toBeNull();
  const trash = await page.evaluate(
    async () => (await (await fetch("/api/bootstrap")).json()).projectTrash,
  );
  expect(trash.some((x: any) => x.name === "永久删除界面测试")).toBe(false);
  let login = false;
  await page.route("**/api/codex/login", async (route) => {
    login = true;
    await route.fulfill({ json: { state: "unconfigured" } });
  });
  await page.route("**/api/status", async (route) =>
    route.fulfill({
      json: {
        codex: {
          state: "unconfigured",
          mode: "subscription",
          detail: "订阅登录测试（Mock）",
          login: login
            ? {
                state: "waiting",
                url: "https://auth.openai.com/codex/device",
                code: "MOCK-CODE",
                detail: "测试授权码（Mock）",
              }
            : null,
        },
        claude: { state: "unconfigured" },
        feishu: { state: "unconfigured" },
      },
    }),
  );
  await page.getByRole("button", { name: "设置", exact: true }).first().click();
  await page
    .getByRole("button", { name: "使用 ChatGPT 登录", exact: true })
    .click();
  await expect(page.getByText("MOCK-CODE", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "打开官方登录页面 ↗" }),
  ).toHaveAttribute("href", "https://auth.openai.com/codex/device");
});
