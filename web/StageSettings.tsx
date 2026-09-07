import React from "react";

export function StageSettings({ requirement, project, settings, extensions, busy, onSave, onManage }: any) {
  const selected = requirement.assistantDefaults || {};
  const choices = (type: string, stage: string) => extensions.filter((e: any) =>
    e.type === type && e.enabled && (!e.projectIds.length || e.projectIds.includes(project.id)) &&
    (!e.release.manifest.stages.length || e.release.manifest.stages.includes(stage)));
  const stages = [["requirement", "需求澄清"], ["prototype", "原型生成"], ["prd", "PRD 编写"], ["review", "PRD 评审"]];
  const inherited = (key: string, stage?: string) => stage
    ? project.defaults?.skills?.[stage] || settings.defaults?.skills?.[stage]
    : project.defaults?.[key] || settings.defaults?.[key];
  const name = (id: string) => extensions.find((e: any) => e.id === id)?.name || "未配置";
  const update = (key: string, value: string, stage?: string) => {
    const next = { ...selected, skills: { ...selected.skills } };
    if (stage) { if (value) next.skills[stage] = value; else delete next.skills[stage]; }
    else { if (value) next[key] = value; else delete next[key]; }
    onSave(next);
  };
  const template = extensions.find((e: any) => e.id === (selected.templateId || inherited("templateId")));
  const templateText = template?.release.content || "请先选择 PRD 模板";
  return <details className="stage-settings">
    <summary>各阶段 Skill、风格与模板</summary>
    <p>本需求选择优先于项目和系统默认，每轮对话会固定所用版本。</p>
    {stages.map(([stage, label]) => <label key={stage}>{label} Skill
      <select aria-label={label + " Skill"} disabled={busy} value={selected.skills?.[stage] || ""} onChange={(e) => update("skills", e.target.value, stage)}>
        <option value="">默认 · {name(inherited("skills", stage))}</option>
        {choices("skill", stage).map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>
    </label>)}
    {[["styleId", "原型风格（单选）", "style", "prototype"], ["templateId", "PRD 模板", "template", "prd"]].map(([key, label, type, stage]) => <label key={key}>{label}
      <select aria-label={label} disabled={busy} value={selected[key] || ""} onChange={(e) => update(key, e.target.value)}>
        <option value="">默认 · {name(inherited(key))}</option>
        {choices(type, stage).map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>
    </label>)}
    <details><summary>查看当前 PRD 模板</summary><pre>{templateText}</pre></details>
    <p>评审由产品、交互设计、研发与测试三个独立会话分别检查同一版本，再汇总问题。</p>
    <button onClick={onManage}>添加或管理 Skill、风格、模板</button>
  </details>;
}
