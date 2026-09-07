import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store, uid, now } from "../server/db.ts";
import { Domain } from "../server/domain.ts";
import { bootstrap } from "../server/bootstrap.ts";
import { html, metadata, prd } from "./fixtures.ts";

async function setup(root: string, name: string) {
  const s = new Store(root);
  await bootstrap(s);
  const d = new Domain(s);
  const p = d.project("评审测试");
  const r = d.requirement(p.id, name);
  const requirement = d.save(r.id, "requirement", "# 需求卡\n每日奖励", null);
  d.confirm(r.id, "requirement", requirement.id);
  const prototype = d.save(r.id, "prototype", html(), null, metadata);
  d.confirm(r.id, "prototype", prototype.id);
  const prdVersion = d.save(r.id, "prd", prd, null, {});
  return { s, d, r, prdVersion };
}

test("PRD can finalize without AI review and records skipped status", async () => {
  const root = await mkdtemp(join(tmpdir(), "review-skip-"));
  const { s, d, r, prdVersion } = await setup(root, "跳过评审");
  try {
    d.finalize(r.id, prdVersion.id);
    const confirmation = s
      .all("confirmation")
      .find((x) => x.requirementId === r.id && x.kind === "final");
    assert.equal(confirmation.reviewStatus, "skipped");
    assert.equal(confirmation.reviewVersionId, null);
  } finally {
    s.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("review lineage survives accepted edits and finalizes as reviewed_then_modified", async () => {
  const root = await mkdtemp(join(tmpdir(), "review-lineage-"));
  const { s, d, r, prdVersion } = await setup(root, "评审后修改");
  try {
    const reviewMetadata = {
      summary: "发现一项需要补充的规则",
      issues: [
        {
          id: "product-1",
          severity: "major" as const,
          description: "奖励入口状态需要更明确",
          suggestion: "补充不可领取状态的展示规则",
        },
      ],
    };
    const review = d.save(
      r.id,
      "review",
      JSON.stringify(reviewMetadata),
      null,
      reviewMetadata,
      "agent",
    );
    s.put("resolution", {
      id: uid(),
      reviewId: review.id,
      requirementId: r.id,
      issueId: "product-1",
      decision: "采纳",
      actor: "user",
      createdAt: now(),
    });
    const prdV2 = d.save(
      r.id,
      "prd",
      prd + "\n\n补充：不可领取状态显示明确原因。",
      prdVersion.id,
      {},
      "agent",
    );
    d.finalize(r.id, prdV2.id);
    const confirmation = s
      .all("confirmation")
      .find((x) => x.requirementId === r.id && x.kind === "final");
    assert.equal(confirmation.reviewStatus, "reviewed_then_modified");
    assert.equal(confirmation.reviewVersionId, review.id);
    assert.equal(confirmation.reviewedPrdVersionId, prdVersion.id);
  } finally {
    s.close();
    await rm(root, { recursive: true, force: true });
  }
});
