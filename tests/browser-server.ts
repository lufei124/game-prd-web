import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import express from "express";
import { createApp } from "../server/app.ts";
import { MockRuntime, MockLark } from "./fixtures.ts";
const root = await mkdtemp(join(tmpdir(), "forge-browser-test-"));
const { app } = await createApp(root, {
  runtime: new MockRuntime(),
  plugin: new MockLark(),
  test: true,
});
app.use(express.static(resolve("dist")));
app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
app.listen(4318, "127.0.0.1", () =>
  console.log("TEST MOCK server http://127.0.0.1:4318"),
);
