import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  mkdir,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { seatbeltProfile } from "../server/codex.ts";
test(
  "macOS OS sandbox permits only executor directory reads",
  { skip: process.platform !== "darwin" },
  async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "forge-seatbelt-")),
    );
    try {
      const work = join(root, "work"),
        home = join(root, "home");
      await mkdir(work);
      await mkdir(home);
      await writeFile(join(work, "allowed.txt"), "allowed");
      await writeFile(join(root, "outside.txt"), "private");
      const binary = await realpath("/bin/cat");
      const profile = seatbeltProfile(work, home, binary);
      assert.match(
        profile,
        /require-all \(literal "\/"\) \(vnode-type DIRECTORY\)/,
      );
      assert.doesNotMatch(profile, /subpath "\/"/);
      assert.equal(
        execFileSync(
          "/usr/bin/sandbox-exec",
          ["-p", profile, binary, join(work, "allowed.txt")],
          { encoding: "utf8" },
        ),
        "allowed",
      );
      assert.throws(() =>
        execFileSync(
          "/usr/bin/sandbox-exec",
          ["-p", profile, binary, join(root, "outside.txt")],
          { stdio: "pipe" },
        ),
      );
      await symlink(join(root, "outside.txt"), join(work, "escape.txt"));
      assert.throws(() =>
        execFileSync(
          "/usr/bin/sandbox-exec",
          ["-p", profile, binary, join(work, "escape.txt")],
          { stdio: "pipe" },
        ),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "official bundled Codex CLI starts inside the restricted OS sandbox without credentials",
  { skip: process.platform !== "darwin" },
  async () => {
    const binary = await realpath(
      new URL(
        "../node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex",
        import.meta.url,
      ),
    );
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "forge-codex-probe-")),
    );
    try {
      const work = join(root, "work"),
        home = join(root, "home");
      await mkdir(work);
      await mkdir(home);
      const output = execFileSync(
        "/usr/bin/sandbox-exec",
        ["-p", seatbeltProfile(work, home, binary), binary, "--version"],
        {
          encoding: "utf8",
          env: { PATH: "/usr/bin:/bin", HOME: home, CODEX_HOME: home },
          timeout: 10000,
        },
      );
      assert.match(output, /codex/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
