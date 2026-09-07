import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rm,
  rename,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { check } from "./db.ts";
const exec = promisify(execFile);
const require = createRequire(import.meta.url);
export function codexBinary() {
  if (process.env.WORKBENCH_CODEX_BINARY)
    return resolve(process.env.WORKBENCH_CODEX_BINARY);
  try {
    const root = dirname(
      require.resolve(
        `@openai/codex-${process.platform}-${process.arch}/package.json`,
      ),
    );
    const triple = `${process.arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin`;
    const path = join(root, "vendor", triple, "bin", "codex");
    return existsSync(path) ? path : undefined;
  } catch {
    return undefined;
  }
}
export const codexAuthMode = () =>
  process.env.WORKBENCH_CODEX_AUTH_MODE === "api-key"
    ? "api-key"
    : "subscription";
export const authHome = (root: string) => join(root, "codex-auth");
export const authEnv = (home: string) => ({
  PATH: "/usr/bin:/bin",
  HOME: home,
  CODEX_HOME: home,
});
const logins = new Map<
  string,
  {
    state: string;
    url?: string;
    code?: string;
    detail: string;
    child?: ReturnType<typeof spawn>;
    done?: Promise<void>;
  }
>();
const active = new Set<string>();
export async function codexStatus(root: string) {
  const binary = codexBinary(),
    mode = codexAuthMode();
  const base = {
    mode,
    home: authHome(root),
    binary: binary || null,
    permissions: "独立登录；仅当前任务目录可写，禁止读取其他项目",
    login: logins.get(root)
      ? (({ child, done, ...state }) => state)(logins.get(root)!)
      : null,
  };
  if (!binary)
    return {
      ...base,
      state: "unconfigured",
      detail: "未找到 Codex CLI，请安装依赖或设置 WORKBENCH_CODEX_BINARY",
    };
  if (process.platform !== "darwin")
    return {
      ...base,
      state: "unsupported",
      detail: "严格目录隔离目前仅支持 macOS",
    };
  if (mode === "api-key")
    return {
      ...base,
      state: process.env.WORKBENCH_CODEX_API_KEY
        ? "configured"
        : "unconfigured",
      detail: process.env.WORKBENCH_CODEX_API_KEY
        ? "API Key 已配置，按 API 计费；真实调用待实测"
        : "待配置 WORKBENCH_CODEX_API_KEY",
    };
  if (!existsSync(join(authHome(root), "auth.json")))
    return {
      ...base,
      state: "unconfigured",
      detail: "请使用 ChatGPT 订阅账号登录；无需 API Key",
    };
  try {
    const result = await exec(
      binary,
      ["-c", 'cli_auth_credentials_store="file"', "login", "status"],
      { env: authEnv(authHome(root)), timeout: 5000, maxBuffer: 16384 },
    );
    check(
      /ChatGPT/i.test(result.stdout + result.stderr),
      "需要 ChatGPT 订阅登录",
      409,
    );
    return {
      ...base,
      state: "configured",
      detail: "订阅登录已就绪；可用额度与模型由账号决定，真实模型调用待实测",
    };
  } catch {
    return {
      ...base,
      state: "unconfigured",
      detail: "登录状态无效或检查失败，请重新登录",
    };
  }
}
export async function startCodexLogin(root: string) {
  check(!active.has(root), "请等待 Codex 任务结束后登录", 409);
  if (logins.get(root)?.state === "waiting") return codexStatus(root);
  const binary = codexBinary();
  check(binary, "未找到 Codex CLI", 409);
  check(
    codexAuthMode() === "subscription",
    "请将 WORKBENCH_CODEX_AUTH_MODE 设为 subscription 后重启",
    409,
  );
  const home = authHome(root);
  await mkdir(home, { recursive: true, mode: 0o700 });
  const loginHome = await mkdtemp(join(home, "login-"));
  const state = {
    done: undefined as Promise<void> | undefined,
    state: "waiting",
    detail: "正在请求订阅登录，请稍候…",
    child: undefined as ReturnType<typeof spawn> | undefined,
    url: undefined as string | undefined,
    code: undefined as string | undefined,
  };
  logins.set(root, state);
  const child = spawn(
    binary,
    ["-c", 'cli_auth_credentials_store="file"', "login", "--device-auth"],
    { env: authEnv(loginHome), stdio: ["ignore", "pipe", "pipe"] },
  );
  state.child = child;
  let output = "";
  const consume = (data: Buffer) => {
    output = (output + data.toString())
      .replace(/\x1b\[[0-9;]*m/g, "")
      .slice(-16384);
    const url = output.match(/https:\/\/auth\.openai\.com\/codex\/device/);
    const code = output.match(/\b[A-Z0-9]{4,6}-[A-Z0-9]{4,6}\b/);
    if (url) state.url = url[0];
    if (code) state.code = code[0];
    if (state.url && state.code)
      state.detail =
        "打开官方登录页面，输入一次性代码并使用订阅账号授权。请勿将代码发给他人。";
  };
  child.stdout.on("data", consume);
  child.stderr.on("data", consume);
  const timer = setTimeout(() => {
    state.detail = "登录超时，请重试";
    child.kill();
  }, 15 * 60_000);
  timer.unref();
  state.done = new Promise<void>((done) => {
    child.on("error", () => {
      state.state = "failed";
      state.detail = "无法启动 Codex 登录，请检查程序路径与权限";
      clearTimeout(timer);
    });
    child.on("close", async (code) => {
      clearTimeout(timer);
      try {
        if (state.state !== "cancelled" && code === 0) {
          const credential = await readFile(join(loginHome, "auth.json"));
          const temp = join(loginHome, "ready.json");
          await writeFile(temp, credential, { mode: 0o600 });
          if (state.state !== "cancelled")
            await rename(temp, join(home, "auth.json"));
        }
        if (state.state !== "cancelled") {
          state.state = code === 0 ? "completed" : "failed";
          state.detail =
            code === 0
              ? "订阅登录完成"
              : "登录未完成，请检查网络，并在 ChatGPT 安全设置中允许 Codex 设备代码登录后重试";
        }
      } catch {
        state.state = "failed";
        state.detail = "登录结果未能保存，请检查存储权限后重试";
      } finally {
        state.child = undefined;
        state.url = undefined;
        state.code = undefined;
        output = "";
        await rm(loginHome, { recursive: true, force: true }).catch(() => {});
        done();
      }
    });
  });
  return codexStatus(root);
}
export async function logoutCodex(root: string) {
  check(!active.has(root), "请等待 Codex 任务结束后退出登录", 409);
  const login = logins.get(root);
  if (login?.child) {
    login.state = "cancelled";
    login.child.kill();
    await login.done;
  }
  logins.delete(root);
  await rm(join(authHome(root), "auth.json"), { force: true });
  return codexStatus(root);
}
// Serialize subscription executions so refresh-token rotation cannot race between isolated homes.
export async function withCodexAuth<T>(
  root: string,
  home: string,
  signal: AbortSignal,
  run: () => Promise<T>,
) {
  if (codexAuthMode() === "api-key") return run();
  check(logins.get(root)?.state !== "waiting", "请先完成订阅登录", 409);
  check(
    !active.has(root),
    "另一个 Codex 任务正在使用订阅，请等待结束后重试",
    409,
  );
  active.add(root);
  const source = join(authHome(root), "auth.json"),
    target = join(home, "auth.json");
  let copied = false;
  try {
    signal.throwIfAborted();
    await mkdir(home, { recursive: true, mode: 0o700 });
    await writeFile(target, await readFile(source), { mode: 0o600 });
    copied = true;
    return await run();
  } finally {
    try {
      if (copied) {
        const temp = source + ".tmp";
        await writeFile(temp, await readFile(target), { mode: 0o600 });
        await rename(temp, source);
      }
    } finally {
      await rm(target, { force: true });
      active.delete(root);
    }
  }
}

export async function stopCodexLogin(root: string) {
  const login = logins.get(root);
  if (login?.child) {
    login.state = "cancelled";
    login.child.kill();
    await login.done;
  }
}
