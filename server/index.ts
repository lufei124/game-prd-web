import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import express from "express";
import { stopCodexLogin } from "./codex-auth.ts";
import { createApp } from "./app.ts";
const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const root = resolve(process.env.WORKBENCH_DATA || join(appRoot, ".data"));
const { app, s, tasks } = await createApp(root);
const port = Number(process.env.PORT || 4317);
if (existsSync(join(appRoot, "dist/index.html"))) {
  app.use(express.static(join(appRoot, "dist")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(join(appRoot, "dist/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root: join(appRoot, "web"),
    configFile: false,
    server: { middlewareMode: true, host: "127.0.0.1" },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const server = app.listen(port, "127.0.0.1", () =>
  console.log(
    `Forge Workbench: http://127.0.0.1:${port} — 数据仅存本机；AI 调用使用在线模型。`,
  ),
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  for (const [id] of tasks.running) tasks.cancel(id);
  await stopCodexLogin(root);
  const deadline = Date.now() + 10000;
  while (tasks.running.size && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 50));
  server.close(() => {
    s.close();
    process.exit(0);
  });
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
