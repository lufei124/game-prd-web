import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import express from "express";
import { createApp } from "../server/app.ts";
import { MockRuntime, MockLark } from "./fixtures.ts";
const root = await mkdtemp(join(tmpdir(), "forge-browser-test-"));
const fixtureDirectory = "/private/tmp/game-prd-web-e2e-knowledge";
await mkdir(fixtureDirectory, { recursive: true });
await writeFile(
  join(fixtureDirectory, "会员退款规则.md"),
  "# 会员退款规则\n会员退款必须在订单详情页发起，超过七天不可退款。",
);
const plugin = new MockLark();
plugin.docs.set("feishu-rule", {
  id: "feishu-rule",
  content: "# 飞书规则\n每日奖励以北京时间零点重置。",
  revision: 1,
  url: "https://example.feishu.cn/docx/feishu-rule",
});
const { app } = await createApp(root, {
  runtime: {
    async run(input, host) {
      const mock = new MockRuntime();
      if (input.prompt.startsWith("UI_TEST_SLOW")) mock.delay = 30000;
      if (
        input.prompt.startsWith("UI_TEST_FAIL") &&
        !input.prompt.includes("\n")
      )
        mock.fail = true;
      return mock.run(input, host);
    },
  },
  plugin,
  test: true,
  folderPicker: async () => fixtureDirectory,
});
app.use(express.static(resolve("dist")));
app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
app.listen(4318, "127.0.0.1", () =>
  console.log("TEST MOCK server http://127.0.0.1:4318"),
);
