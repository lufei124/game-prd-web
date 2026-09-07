import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  FolderKanban,
  Library,
  Blocks,
  Settings,
  Plus,
  ArrowUpRight,
  ArrowRight,
  ArrowUp,
  Check,
  CheckCheck,
  ChevronDown,
  FileText,
  PanelLeft,
  MessageSquare,
  Sparkles,
  Clock,
  Play,
  Upload,
  RotateCcw,
  Download,
  Send,
  Square,
  Link,
  Paperclip,
  Palette,
  AlertCircle,
  BookOpen,
  X,
  Search,
  Monitor,
  Layers,
  CheckCircle2,
  MoreHorizontal,
  Shield,
  ExternalLink,
  Trash2,
  Github,
} from "lucide-react";
import { api } from "./api";
import "./style.css";
type Field = {
  name: string;
  label: string;
  value?: string;
  type?: string;
  options?: { value: string; label: string }[];
  hint?: string;
  required?: boolean;
};
type DialogSpec = {
  title: string;
  description?: string;
  fields: Field[];
  submit?: string;
  skipScopedReload?: boolean;
  action: (values: any) => Promise<void>;
};
const labels: Record<string, string> = {
  requirement: "需求卡",
  prototype: "交互原型",
  prd: "PRD 文档",
  review: "评审",
  full: "完整流程",
  publish: "仅发布",
  queued: "排队中",
  running: "正在执行",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "中断",
  waiting: "等待回答",
  published: "已发布",
  uncertain: "待核验",
  parsed: "已解析",
  image: "图片 · 未做 OCR",
  unparsed: "未解析",
  pending: "待确认",
  confirmed: "已确认目标",
  live: "已上线事实",
  historical: "历史方案",
  configured: "已配置 · 待实测",
  unconfigured: "待配置",
  needs_permission: "需授权",
};
const effortOptions = [
  { value: "low", label: "低 · 更快" },
  { value: "medium", label: "中 · 均衡" },
  { value: "high", label: "高 · 深入" },
  { value: "xhigh", label: "很高" },
  { value: "max", label: "最大" },
  { value: "ultra", label: "超深（Codex）" },
];
const modelChoices = [
  "gpt-5.6-terra",
  "gpt-5.6-sol",
  "gpt-6-astra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "claude-sonnet-4-6",
];
const assistantFields = (v: any): Field[] => [
  {
    name: "executor",
    label: "默认助手",
    type: "select",
    value: v.executor || "codex",
    options: [
      { value: "codex", label: "Codex" },
      { value: "claude", label: "Claude" },
    ],
  },
  {
    name: "model",
    label: "模型 ID",
    value: v.model || "gpt-5.6-terra",
    required: true,
    hint: "可选常用模型或输入其他模型 ID；需与助手及账号权限匹配。",
  },
  {
    name: "reasoningEffort",
    label: "思考深度",
    type: "select",
    value: v.reasoningEffort || "medium",
    options: effortOptions,
  },
];
const fmt = (x: string) =>
  new Date(x).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
function App() {
  const [data, setData] = useState<any>(null),
    [view, setView] = useState("projects"),
    [projectId, setProjectId] = useState(
      localStorage.getItem("forge-project") || "",
    ),
    [requirementId, setRequirementId] = useState(
      localStorage.getItem("forge-requirement") || "",
    );
  const [ws, setWs] = useState<any>(null),
    [kind, setKind] = useState("requirement"),
    [chosenVersion, setChosenVersion] = useState(""),
    [editor, setEditor] = useState(""),
    [selectedText, setSelectedText] = useState(""),
    [preview, setPreview] = useState(true);
  const [knowledge, setKnowledge] = useState<any>({
      items: [],
      conflicts: [],
      proposals: [],
    }),
    [status, setStatus] = useState<any>(null),
    [filter, setFilter] = useState(""),
    [extensionType, setExtensionType] = useState("all");
  const [dialog, setDialog] = useState<DialogSpec | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState("");
  const [taskPrompt, setTaskPrompt] = useState(""),
    [styleId, setStyleId] = useState(""),
    [skillId, setSkillId] = useState(""),
    [templateId, setTemplateId] = useState(""),
    [scope, setScope] = useState("visual"),
    [executor, setExecutor] = useState(""),
    [taskModel, setTaskModel] = useState(""),
    [reasoningEffort, setReasoningEffort] = useState(""),
    [referenceIds, setReferenceIds] = useState<string[]>([]),
    [showConfig, setShowConfig] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const initialLoad = useRef(true);
  const reload = async () => {
    const d = await api("/bootstrap");
    setData(d);
    if (d.draftRequirementIds) {
      const retained = new Set(d.draftRequirementIds);
      for (const key of Object.keys(localStorage))
        if (key.startsWith("forge-draft:") && !retained.has(key.split(":")[1]))
          localStorage.removeItem(key);
    }
    setProjectId((current) =>
      d.projects.some((p: any) => p.id === current)
        ? current
        : d.projects[0]?.id || "",
    );
    setRequirementId((current) =>
      d.requirements.some((r: any) => r.id === current) ? current : "",
    );
  };
  const loadWorkspace = async () => {
    if (requirementId) setWs(await api("/requirements/" + requirementId));
  };
  const loadKnowledge = async () => {
    if (projectId) setKnowledge(await api("/knowledge?projectId=" + projectId));
  };
  const run = async (fn: () => Promise<any>, message = "已保存") => {
    setError("");
    setBusy(true);
    try {
      await fn();
      await Promise.all([reload(), loadWorkspace(), loadKnowledge()]);
      if (message) setToast(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (status?.codex?.login?.state !== "waiting") return;
    const timer = setInterval(() => {
      api("/status")
        .then(setStatus)
        .catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [status?.codex?.login?.state]);
  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    localStorage.setItem("forge-project", projectId);
    loadKnowledge().catch((e) => setError(e.message));
    setStyleId("");
    setTemplateId("");
    setSkillId("");
    setReferenceIds([]);
    setExecutor("");
    setTaskModel("");
    setReasoningEffort("");
  }, [projectId]);
  useEffect(() => {
    localStorage.setItem("forge-requirement", requirementId);
    setChosenVersion("");
    setWs(null);
    if (requirementId) loadWorkspace().catch((e) => setError(e.message));
  }, [requirementId]);
  useEffect(() => {
    if (!requirementId) return;
    const id = setInterval(() => loadWorkspace().catch(() => {}), 2200);
    return () => clearInterval(id);
  }, [requirementId]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 3500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    if (view === "settings")
      api("/status")
        .then(setStatus)
        .catch((e) => setError(e.message));
  }, [view]);
  const project = data?.projects.find((p: any) => p.id === projectId),
    req = ws?.requirement;
  const effectiveExecutor =
    executor ||
    project?.defaults?.executor ||
    data?.settings.executor ||
    "codex";
  const effectiveModel =
    taskModel ||
    [project?.defaults, data?.settings].find(
      (x) => x?.model && (!x.executor || x.executor === effectiveExecutor),
    )?.model ||
    (effectiveExecutor === "codex" ? "gpt-5.6-terra" : "claude-sonnet-4-6");
  const effectiveEffort =
    reasoningEffort ||
    project?.defaults?.reasoningEffort ||
    data?.settings.reasoningEffort ||
    "medium";
  const versions = (ws?.versions || []).filter((v: any) => v.kind === kind);
  const version =
    versions.find((v: any) => v.id === (chosenVersion || req?.heads[kind])) ||
    versions.at(-1);
  const savedKey =
    "forge-draft:" + requirementId + ":" + kind + ":" + (version?.id || "new");
  useEffect(() => {
    setEditor(localStorage.getItem(savedKey) ?? version?.content ?? "");
    setSelectedText("");
  }, [savedKey]);
  const dirty = editor !== (version?.content || "");
  const setDraft = (v: string) => {
    setEditor(v);
    localStorage.setItem(savedKey, v);
  };
  const selectRequirement = (id: string) => {
    setRequirementId(id);
    setView("projects");
    setKind("requirement");
  };
  const kinds =
    req?.mode === "prototype"
      ? ["prototype"]
      : req?.mode === "publish"
        ? ["prd"]
        : req?.mode === "review"
          ? ["prd", "review"]
          : ["requirement", "prototype", "prd", "review"];
  useEffect(() => {
    if (req && !kinds.includes(kind)) setKind(kinds[0]);
  }, [req?.id]);
  const open = (d: DialogSpec) => setDialog(d);
  const options = (type: string) =>
    data?.extensions.filter(
      (e: any) =>
        e.type === type &&
        e.enabled &&
        (!e.projectIds.length || e.projectIds.includes(projectId)),
    ) || [];
  const skillOptions = options("skill").filter((x: any) =>
    x.release.manifest.stages.includes(kind),
  );
  const defaultId = (key: string) =>
    project?.defaults?.[key] || data?.settings.defaults?.[key] || "";
  const newProject = () =>
    open({
      title: "新建项目",
      description: "每个项目拥有独立知识、需求与默认扩展。",
      fields: [{ name: "name", label: "项目名称", required: true }],
      action: async (v) => {
        const p = await api("/projects", "POST", v);
        setProjectId(p.id);
        setRequirementId("");
      },
    });
  const deleteProject = () =>
    open({
      title: "删除项目",
      description: `将「${project.name}」及关联需求、知识和成果移入回收站。可恢复，不删除远端飞书文档。正在执行的任务需先取消。`,
      fields: [
        { name: "confirmedName", label: "输入项目名称确认", required: true },
      ],
      submit: "移入回收站",
      skipScopedReload: true,
      action: async (v) => {
        await api("/projects/" + projectId, "DELETE", v);
        setRequirementId("");
        setWs(null);
        setKnowledge({ items: [], conflicts: [], proposals: [] });
      },
    });
  const projectTrash = (permanent = false) =>
    open({
      title: permanent ? "永久删除项目" : "项目回收站",
      description: permanent
        ? "此操作不可恢复，将删除项目全部需求、知识、成果、历史和关联本地文件。远端飞书文档及独立备份不受影响。"
        : "恢复项目及其需求、知识、成果和版本记录。",
      submit: permanent ? "永久删除，不可恢复" : "恢复项目",
      skipScopedReload: true,
      fields: [
        {
          name: "id",
          label: "已删除项目",
          type: "select",
          options: data.projectTrash.map((p: any) => ({
            value: p.id,
            label:
              p.name +
              (p.purging ? " · 待完成清理" : "") +
              " · " +
              fmt(p.deletedAt),
          })),
        },
        ...(permanent
          ? [
              {
                name: "confirmedName",
                label: "输入项目名称确认永久删除",
                required: true,
              },
            ]
          : []),
      ],
      action: async (v) => {
        if (permanent) {
          await api("/projects/" + v.id + "/permanent", "DELETE", {
            confirmedName: v.confirmedName,
          });
          return;
        }
        const p = await api("/projects/" + v.id + "/restore", "POST", {});
        setProjectId(p.id);
        setRequirementId("");
      },
    });
  const newRequirement = () => {
    if (!projectId) return newProject();
    open({
      title: "开始一个新需求",
      fields: [
        {
          name: "name",
          label: "需求名称",
          required: true,
          hint: "例如：每日奖励领取流程",
        },
        {
          name: "mode",
          label: "任务范围",
          type: "select",
          value: "full",
          options: [
            { value: "full", label: "完整流程" },
            { value: "prototype", label: "只做原型" },
            { value: "review", label: "只评审 PRD" },
            { value: "publish", label: "只发布已有 PRD" },
          ],
        },
      ],
      action: async (v) => {
        const r = await api("/requirements", "POST", { ...v, projectId });
        selectRequirement(r.id);
      },
    });
  };
  const trusted = (
    title: string,
    description: string,
    action: () => Promise<void>,
  ) => open({ title, description, fields: [], submit: "确认", action });
  const save = () =>
    run(async () => {
      let metadata = version?.metadata || {};
      if (kind === "prototype") {
        const m = editor.match(
          /<script[^>]*id=["']prototype-meta["'][^>]*>([\s\S]*?)<\/script>/i,
        );
        if (!m) throw new Error("HTML 需要 script#prototype-meta JSON");
        metadata = JSON.parse(m[1]);
      }
      if (kind === "review") {
        metadata = JSON.parse(editor);
      }
      const v = await api(
        "/requirements/" + requirementId + "/versions",
        "POST",
        { kind, content: editor, base: version?.id || null, metadata },
      );
      localStorage.removeItem(savedKey);
      setChosenVersion(v.id);
    });
  const confirm = () =>
    trusted(
      "确认当前" + labels[kind],
      `本次确认绑定 v${version?.number}。后续修改会生成新版本，并重新检查关联 PRD。`,
      async () => {
        await api("/requirements/" + requirementId + "/confirm", "POST", {
          kind,
          versionId: version.id,
        });
      },
    );
  const startTask = () =>
    run(async () => {
      if (dirty)
        throw new Error("请先保存手动编辑，再启动 AI 修改，以便锁定基础版本");
      const text = taskPrompt.trim();
      if (!text) throw new Error("请描述要生成或修改的内容");
      const t = await api("/requirements/" + requirementId + "/tasks", "POST", {
        kind,
        prompt: text,
        skillIds: [
          skillId ||
            project?.defaults?.skills?.[kind] ||
            data.settings.defaults.skills?.[kind],
        ].filter(Boolean),
        ...(kind === "prototype"
          ? { styleId: styleId || defaultId("styleId") }
          : {}),
        ...(kind === "prd"
          ? { templateId: templateId || defaultId("templateId") }
          : {}),
        referenceIds,
        scope: kind === "prototype" && version ? scope : "layout",
        selection: selectedText,
        executor: effectiveExecutor,
        model: effectiveModel,
        reasoningEffort: effectiveEffort,
      });
      setTaskPrompt("");
      setChosenVersion("");
    }, "任务已提交，进度会自动保存");
  const uploadKnowledge = (requirementScope = false) =>
    open({
      title: requirementScope ? "添加需求资料" : "添加项目知识",
      description: requirementScope
        ? "仅此需求使用，不自动进入长期知识。"
        : "原文件和来源会保留。导入后显示真实解析状态。",
      fields: [
        { name: "file", label: "文件", type: "file", required: true },
        { name: "module", label: "模块", value: "general" },
        {
          name: "state",
          label: "知识状态",
          type: "select",
          value: "pending",
          options: ["pending", "live", "confirmed", "historical"].map((x) => ({
            value: x,
            label: labels[x],
          })),
        },
      ],
      action: async (v) => {
        const form = new FormData();
        form.append("file", v.file);
        form.append("projectId", projectId);
        form.append("module", v.module);
        form.append("state", v.state);
        if (requirementScope) form.append("requirementId", requirementId);
        await api("/knowledge/upload", "POST", form);
      },
    });
  const createExtension = (type = "skill", existing?: any, copy = false) =>
    open({
      title: existing
        ? copy
          ? "复制并编辑"
          : "编辑扩展 · 保存新版本"
        : "创建扩展",
      description:
        "标准 SKILL.md 保留资源；更新不会改变已经运行的任务或历史成果。模板可以自由调整章节、条件、表格、写作要求与示例。",
      fields: [
        {
          name: "name",
          label: "名称",
          value: existing ? existing.name + (copy ? " 副本" : "") : "",
          required: true,
        },
        {
          name: "type",
          label: "类型",
          type: "select",
          value: existing?.type || type,
          options: [
            { value: "skill", label: "任务 Skill" },
            { value: "style", label: "风格 Skill" },
            { value: "template", label: "PRD 模板" },
          ],
        },
        {
          name: "stages",
          label: "适用阶段（逗号分隔）",
          value:
            existing?.release.manifest.stages.join(",") ||
            (type === "template"
              ? "prd"
              : type === "style"
                ? "prototype"
                : "requirement"),
        },
        {
          name: "content",
          label: "内容",
          type: "textarea",
          value:
            existing?.release.content ||
            (type === "template"
              ? "# {{需求名称}}\n\n## 目标\n\n## 规则\n\n## 验收"
              : "---\nname: my-skill\ndescription: 描述任务能力\n---\n\n# 任务规则\n写明步骤、产物与禁止事项。"),
          required: true,
        },
      ],
      action: async (v) => {
        await api("/extensions/simple", "POST", {
          ...v,
          stages: v.stages
            .split(",")
            .map((x: string) => x.trim())
            .filter(Boolean),
          ...(existing && !copy ? { existingId: existing.id } : {}),
        });
      },
    });
  const importExtension = (source = "directory", existing?: any) =>
    open({
      title: existing ? "导入扩展更新" : "导入扩展",
      description:
        "仅检查和保存文件。不会执行脚本或安装依赖。目录需先在设置中授权。",
      fields: [
        {
          name: "source",
          label: "来源",
          type: "select",
          value: source,
          options: [
            { value: "directory", label: "本地目录" },
            { value: "github", label: "GitHub 仓库 / 子目录" },
            { value: "zip", label: "ZIP 文件" },
          ],
        },
        {
          name: "location",
          label: "目录 / GitHub URL",
          value: "",
          hint: "支持 https://github.com/作者/仓库、tree/分支/子目录、blob/分支/路径/SKILL.md；多 Skill 仓库请指定子目录。",
        },
        { name: "file", label: "ZIP 文件（仅 ZIP 来源需要）", type: "file" },
        {
          name: "name",
          label: "扩展名称",
          value: existing?.name || "",
          hint: "留空时使用 SKILL.md 中的名称",
        },
        {
          name: "type",
          label: "扩展类型",
          type: "select",
          value: existing?.type || "skill",
          options: [
            { value: "skill", label: "任务 Skill" },
            { value: "style", label: "风格 Skill" },
            { value: "template", label: "Markdown 模板" },
          ],
        },
        {
          name: "stages",
          label: "适用阶段（逗号分隔）",
          value: existing?.release.manifest.stages.join(",") || "prototype",
        },
      ],
      action: async (v) => {
        const metadata = {
          ...(v.name?.trim() ? { name: v.name.trim() } : {}),
          type: v.type,
          stages: v.stages
            .split(",")
            .map((x: string) => x.trim())
            .filter(Boolean),
          permissions: ["resource.read", "artifact.draft", "knowledge.read"],
        };
        if (v.source === "zip") {
          if (!v.file?.size) throw new Error("请选择 ZIP");
          const form = new FormData();
          form.append("file", v.file);
          form.append("metadata", JSON.stringify(metadata));
          if (existing) form.append("existingId", existing.id);
          await api("/extensions/zip", "POST", form);
        } else
          await api("/extensions/import", "POST", {
            source: v.source,
            location: v.location,
            metadata,
            existingId: existing?.id,
          });
      },
    });
  const publish = () =>
    open({
      title: "飞书发布目标",
      description: "先核验权限和远端版本，再确认具体终稿。更新会整体替换正文。",
      fields: [
        {
          name: "target",
          label: "文件夹 token（或 my_library）",
          value: "my_library",
          required: true,
        },
        {
          name: "includePrototype",
          label: "附带关联原型 HTML 文件",
          type: "select",
          value: "false",
          options: [
            { value: "false", label: "不附带" },
            { value: "true", label: "附带（作为文件，不使用 localhost 链接）" },
          ],
        },
        {
          name: "attachmentIds",
          label: "附带截图或资料（填资料 ID，逗号分隔）",
          hint: knowledge.items
            .filter(
              (k: any) => !k.requirementId || k.requirementId === requirementId,
            )
            .map((k: any) => k.name + ": " + k.id)
            .join("；"),
        },
      ],
      submit: "生成发布预览",
      action: async (v) => {
        const p = await api("/publish/prepare", "POST", {
          requirementId,
          versionId: req.finalVersion,
          target: v.target,
          includePrototype: v.includePrototype === "true",
          attachmentIds: v.attachmentIds
            .split(",")
            .map((x: string) => x.trim())
            .filter(Boolean),
        });
        setTimeout(
          () =>
            open({
              title:
                p.operation +
                " · v" +
                ws.versions.find((x: any) => x.id === p.versionId)?.number,
              description:
                "目标：" +
                p.target +
                "，附件 " +
                p.attachments.length +
                " 个。确认仅对本次文档版本有效。",
              fields: [
                {
                  name: "preview",
                  label: "即将发布的正文",
                  type: "readonly",
                  value: p.content,
                },
              ],
              submit: "确认发布到飞书",
              action: async () => {
                await api("/publish/confirm", "POST", { approvalId: p.id });
              },
            }),
          0,
        );
      },
    });
  if (!data)
    return (
      <div className="loading">
        <div className="mark">f.</div>
        <h2>正在打开你的工作台</h2>
        <p>{error || "载入本地项目与版本…"}</p>
      </div>
    );
  return (
    <div className="app">
      <datalist id="assistant-models">
        {modelChoices.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <aside className="global-nav">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("projects");
          }}
        >
          <span className="mark">f.</span>
          <span>
            forge<span className="brand-sub">产品工作台</span>
          </span>
        </a>
        <div className="workspace-label">
          个人空间 <span>LOCAL</span>
        </div>
        <nav>
          {[
            ["projects", "项目", FolderKanban],
            ["knowledge", "知识库", Library],
            ["extensions", "扩展中心", Blocks],
            ["settings", "设置", Settings],
          ].map(([key, label, Icon]: any) => (
            <button
              key={key}
              className={view === key ? "nav-item active" : "nav-item"}
              onClick={() => setView(key)}
            >
              <Icon size={18} />
              {label}
              {key === "projects" && (
                <span className="nav-count">{data.projects.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-divider" />
        <div className="section-label">
          我的项目
          <button className="icon" title="新建项目" onClick={newProject}>
            <Plus size={15} />
          </button>
        </div>
        <div className="project-list">
          {data.projects.map((p: any) => (
            <button
              className={
                "project-link " + (p.id === projectId ? "selected" : "")
              }
              key={p.id}
              onClick={() => {
                setProjectId(p.id);
                setRequirementId("");
                setView("projects");
              }}
            >
              <span className="project-dot" />
              {p.name}
            </button>
          ))}
        </div>
        <div className="nav-bottom">
          <div className="local-card">
            <span className="live-dot" />
            <b>保存在此设备</b>
            <p>你的项目，你的工作空间。</p>
          </div>
          <div className="profile">
            <span className="avatar">我</span>
            <span>
              个人工作台<small>本地优先 · v0.1</small>
            </span>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            工作空间 <span>/</span> <b>{project?.name || "所有项目"}</b>
            {view === "projects" && req && (
              <>
                <span>/</span>
                {req.name}
              </>
            )}
          </div>
          <div className="top-actions">
            <span className="local-pill">
              <span className="live-dot" />
              本地存储
            </span>
            <button
              className="icon"
              title="设置"
              onClick={() => setView("settings")}
            >
              <Settings size={17} />
            </button>
          </div>
        </header>
        {data.runtime === "test-mock" && (
          <div className="banner warning">
            测试执行器 Mock 正在运行，生成与飞书结果不是真实服务。
          </div>
        )}
        {error && (
          <div role="alert" className="banner error">
            <AlertCircle size={17} />
            <span>{error}</span>
            <button className="icon" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {toast && (
          <div role="status" className="toast">
            <CheckCircle2 size={17} />
            {toast}
          </div>
        )}
        {view === "projects" && !requirementId && (
          <div className="page dashboard">
            <div className="page-heading">
              <div>
                <p className="eyebrow">MAKE IDEAS TANGIBLE</p>
                <h1>{project ? project.name : "从一个想法，开始。"}</h1>
                <p>把资料、需求与可体验的产品方案，放在一起。</p>
              </div>
              <div className="row">
                {project && (
                  <button onClick={deleteProject}>
                    <Trash2 size={16} />
                    删除项目
                  </button>
                )}
                {!!data.projectTrash?.length && (
                  <button onClick={() => projectTrash()}>
                    回收站（{data.projectTrash.length}）
                  </button>
                )}
                {!!data.projectTrash?.length && (
                  <button onClick={() => projectTrash(true)}>
                    <Trash2 size={15} />
                    清理回收站
                  </button>
                )}
                <button className="primary" onClick={newRequirement}>
                  <Plus size={17} />
                  新建需求
                </button>
              </div>
            </div>
            <div className="hero-strip">
              <div className="hero-icon">
                <Layers size={31} />
              </div>
              <div>
                <h2>从需求到交付，每一步都有依据</h2>
                <p>需求确认 → 交互原型 → 研发 PRD → 飞书交付</p>
              </div>
              <button onClick={() => setView("extensions")}>
                配置你的工作方式 <ArrowUpRight size={16} />
              </button>
            </div>
            <div className="section-heading">
              <h2>
                需求工作区{" "}
                <span>
                  {
                    data.requirements.filter(
                      (r: any) => r.projectId === projectId,
                    ).length
                  }
                </span>
              </h2>
              {project && (
                <button
                  onClick={() =>
                    open({
                      title: "项目默认配置",
                      description:
                        "单次任务选择优先于项目默认；项目默认优先于系统默认。",
                      fields: [
                        ...assistantFields({
                          ...data.settings,
                          ...project.defaults,
                        }),
                        {
                          name: "styleId",
                          label: "默认风格",
                          type: "select",
                          value: defaultId("styleId"),
                          options: options("style").map((x: any) => ({
                            value: x.id,
                            label: x.name,
                          })),
                        },
                        {
                          name: "templateId",
                          label: "默认 PRD 模板",
                          type: "select",
                          value: defaultId("templateId"),
                          options: options("template").map((x: any) => ({
                            value: x.id,
                            label: x.name,
                          })),
                        },
                      ],
                      action: async (v) => {
                        await api("/projects/" + projectId, "PATCH", {
                          defaults: { ...project.defaults, ...v },
                        });
                      },
                    })
                  }
                >
                  <Settings size={15} />
                  项目默认
                </button>
              )}
            </div>
            <div className="requirement-grid">
              {data.requirements
                .filter((r: any) => r.projectId === projectId)
                .map((r: any) => (
                  <button
                    className="requirement-card"
                    key={r.id}
                    onClick={() => selectRequirement(r.id)}
                  >
                    <div className="card-top">
                      <span className="file-icon">
                        <FileText size={23} />
                      </span>
                      <ArrowUpRight size={17} />
                    </div>
                    <h3>{r.name}</h3>
                    <p>{r.stage}</p>
                    <div className="card-footer">
                      <span className="pill">{labels[r.mode]}</span>
                      <time>{fmt(r.createdAt)}</time>
                    </div>
                  </button>
                ))}
              <button
                className="requirement-card add-card"
                onClick={newRequirement}
              >
                <Plus size={27} />
                <h3>创建新需求</h3>
                <p>从想法、资料或已有 PRD 开始</p>
              </button>
            </div>
            <div className="getting-started">
              <h3>让工作台更了解你的项目</h3>
              <div>
                <button onClick={() => setView("knowledge")}>
                  <Library size={22} />
                  <span>
                    <b>添加项目知识</b>
                    <small>产品规则、设计规范、历史方案</small>
                  </span>
                  <ArrowRight size={17} />
                </button>
                <button onClick={() => setView("extensions")}>
                  <Blocks size={22} />
                  <span>
                    <b>选择 Skills 与模板</b>
                    <small>组合适合你的工作方法</small>
                  </span>
                  <ArrowRight size={17} />
                </button>
                <button onClick={() => setView("settings")}>
                  <Sparkles size={22} />
                  <span>
                    <b>连接产品助手</b>
                    <small>配置 Codex 与可选 Claude</small>
                  </span>
                  <ArrowRight size={17} />
                </button>
              </div>
            </div>
          </div>
        )}
        {view === "projects" && requirementId && ws && (
          <div className="workspace">
            <div className="workspace-heading">
              <div>
                <button className="back" onClick={() => setRequirementId("")}>
                  ← 项目需求
                </button>
                <h1>
                  {req.name}
                  <span className="pill">{labels[req.mode]}</span>
                </h1>
                <div className="stage-text">
                  <span className="live-dot" />
                  {req.stage}
                </div>
              </div>
              <div className="header-buttons">
                {req.finalVersion && (
                  <button className="primary" onClick={publish}>
                    <Send size={16} />
                    飞书交付
                  </button>
                )}
              </div>
            </div>
            {req.mode !== "full" ? (
              <div className="stepper">
                <div className="done">
                  <span>1</span>
                  {labels[req.mode]} · {req.stage}
                </div>
              </div>
            ) : (
              <div className="stepper">
                {[
                  "需求整理",
                  "需求确认",
                  "原型迭代",
                  "原型确认",
                  "PRD 评审",
                  "终稿交付",
                ].map((s, i) => (
                  <div
                    key={s}
                    className={
                      i === 0 ||
                      (i === 1 && req.confirmed.requirement) ||
                      (i === 2 && req.heads.prototype) ||
                      (i === 3 && (req.confirmed.prototype || req.waiver)) ||
                      (i === 4 && req.heads.review) ||
                      (i === 5 && req.finalVersion)
                        ? "done"
                        : ""
                    }
                  >
                    <span>
                      {i === 0 ||
                      (i === 1 && req.confirmed.requirement) ||
                      (i === 3 && req.confirmed.prototype) ||
                      (i === 5 && req.finalVersion) ? (
                        <Check size={12} />
                      ) : (
                        i + 1
                      )}
                    </span>
                    {s}
                  </div>
                ))}
              </div>
            )}
            {req.stale && (
              <div className="banner warning">
                原型或核心需求已变化，关联 PRD
                待同步。旧终稿和发布记录仍然保留。
              </div>
            )}
            <div className="workspace-columns">
              <aside className="asset-panel">
                <div className="section-label">
                  本次成果 <span>{ws.versions.length}</span>
                </div>
                {kinds.map((k) => (
                  <button
                    key={k}
                    className={"asset-link " + (kind === k ? "selected" : "")}
                    onClick={() => {
                      setKind(k);
                      setChosenVersion("");
                      setSkillId("");
                    }}
                  >
                    {k === "prototype" ? (
                      <Monitor size={17} />
                    ) : (
                      <FileText size={17} />
                    )}
                    <span>{labels[k]}</span>
                    {req.heads[k] && <span className="asset-ready" />}
                  </button>
                ))}
                <div className="section-label spaced">
                  需求资料
                  <button
                    title="添加需求资料"
                    className="icon"
                    onClick={() => uploadKnowledge(true)}
                  >
                    <Plus size={15} />
                  </button>
                </div>
                {knowledge.items
                  .filter((k: any) => k.requirementId === requirementId)
                  .map((k: any) => (
                    <button
                      key={k.id}
                      className="resource-link"
                      onClick={() =>
                        open({
                          title: k.name,
                          description: labels[k.status] + " · " + k.source,
                          fields: [
                            {
                              name: "content",
                              label: "解析内容",
                              type: "readonly",
                              value: k.text || k.error,
                            },
                          ],
                          submit: "关闭",
                          action: async () => {},
                        })
                      }
                    >
                      <Paperclip size={14} />
                      {k.name}
                    </button>
                  ))}
                {kind === "prototype" && version && (
                  <>
                    <div className="section-label spaced">原型页面</div>
                    {version.metadata.pages?.map((p: any) => (
                      <div className="page-link" key={p.id}>
                        <Monitor size={13} />
                        {p.name}
                        <small>{p.id}</small>
                      </div>
                    ))}
                  </>
                )}
                <div className="section-label spaced">
                  版本历史 <Clock size={13} />
                </div>
                {[...versions].reverse().map((v: any) => (
                  <button
                    key={v.id}
                    className={
                      "version-link " + (version?.id === v.id ? "selected" : "")
                    }
                    onClick={() => setChosenVersion(v.id)}
                  >
                    <span>
                      v{v.number}{" "}
                      {req.confirmed[kind] === v.id
                        ? "· 已确认"
                        : req.finalVersion === v.id
                          ? "· 终稿"
                          : ""}
                    </span>
                    <small>
                      {fmt(v.createdAt)} · {v.actor === "agent" ? "AI" : "手动"}
                    </small>
                  </button>
                ))}
              </aside>
              <aside className="agent-panel">
                <div className="agent-heading">
                  <span className="assistant-icon">
                    <Sparkles size={18} />
                  </span>
                  <div>
                    <b>产品助手</b>
                    <small>
                      {effectiveExecutor === "codex" ? "Codex" : "Claude"} ·{" "}
                      {effectiveModel}
                    </small>
                  </div>
                  <button
                    className="icon"
                    title="任务配置"
                    onClick={() => setShowConfig(!showConfig)}
                  >
                    <Settings size={16} />
                  </button>
                </div>
                <div className="agent-scroll">
                  {showConfig && (
                    <div className="generation-config">
                      <div className="config-title">
                        本次任务配置{" "}
                        <button
                          className="icon"
                          onClick={() => setShowConfig(false)}
                        >
                          <ChevronDown size={15} />
                        </button>
                      </div>
                      <label>
                        产品助手
                        <select
                          aria-label="产品助手"
                          value={effectiveExecutor}
                          onChange={(e) => {
                            setExecutor(e.target.value);
                            setTaskModel("");
                            setReasoningEffort("medium");
                          }}
                        >
                          <option value="codex">Codex</option>
                          <option value="claude">Claude</option>
                        </select>
                      </label>
                      <label>
                        模型
                        <input
                          aria-label="任务模型"
                          list="assistant-models"
                          value={effectiveModel}
                          onChange={(e) => setTaskModel(e.target.value)}
                        />
                      </label>
                      <label>
                        思考深度
                        <select
                          aria-label="任务思考深度"
                          value={effectiveEffort}
                          onChange={(e) => setReasoningEffort(e.target.value)}
                        >
                          {effortOptions
                            .filter(
                              (o) =>
                                effectiveExecutor === "codex" ||
                                o.value !== "ultra",
                            )
                            .map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                        </select>
                      </label>
                      <p className="footnote">
                        模型与深度会固定到本次任务。实际可用性取决于账号权限；未配置请前往设置。
                      </p>
                      <label>
                        {kind === "prototype" ? "原型方式" : "执行 Skill"}
                        <select
                          aria-label="执行 Skill"
                          value={
                            skillId ||
                            project?.defaults?.skills?.[kind] ||
                            data.settings.defaults.skills?.[kind] ||
                            ""
                          }
                          onChange={(e) => setSkillId(e.target.value)}
                        >
                          {skillOptions.map((x: any) => (
                            <option key={x.id} value={x.id}>
                              {x.name === "game-prototype"
                                ? "交互原型"
                                : x.name === "game-wireframe-prototype"
                                  ? "低保真线框"
                                  : x.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      {kind === "prototype" && (
                        <>
                          <label>
                            视觉风格
                            <select
                              aria-label="视觉风格"
                              value={styleId || defaultId("styleId")}
                              onChange={(e) => setStyleId(e.target.value)}
                            >
                              {options("style").map((x: any) => (
                                <option key={x.id} value={x.id}>
                                  {x.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="style-swatches">
                            <div
                              className={
                                (styleId || defaultId("styleId")) ===
                                options("style")[0]?.id
                                  ? "swatch mint chosen"
                                  : "swatch mint"
                              }
                            >
                              <span />
                              <span />
                              <span />
                              <small>清透</small>
                            </div>
                            <div
                              className={
                                (styleId || defaultId("styleId")) ===
                                options("style")[1]?.id
                                  ? "swatch ink chosen"
                                  : "swatch ink"
                              }
                            >
                              <span />
                              <span />
                              <span />
                              <small>墨色</small>
                            </div>
                          </div>
                          {version && (
                            <label>
                              修改范围
                              <select
                                value={scope}
                                onChange={(e) => setScope(e.target.value)}
                              >
                                <option value="visual">
                                  仅视觉（保留业务与交互）
                                </option>
                                <option value="layout">
                                  允许调整布局与交互
                                </option>
                              </select>
                            </label>
                          )}
                        </>
                      )}
                      {kind === "prd" && (
                        <label>
                          PRD 模板
                          <select
                            aria-label="PRD 模板"
                            value={templateId || defaultId("templateId")}
                            onChange={(e) => setTemplateId(e.target.value)}
                          >
                            {options("template").map((x: any) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <details>
                        <summary>
                          参考资料 · {referenceIds.length} 项手动选择
                        </summary>
                        <small>相关文本会自动检索；勾选可固定额外资料。</small>
                        {knowledge.items
                          .filter(
                            (k: any) =>
                              !k.requirementId ||
                              k.requirementId === requirementId,
                          )
                          .map((k: any) => (
                            <label className="check-label" key={k.id}>
                              <input
                                type="checkbox"
                                checked={referenceIds.includes(k.id)}
                                onChange={(e) =>
                                  setReferenceIds(
                                    e.target.checked
                                      ? [...referenceIds, k.id]
                                      : referenceIds.filter(
                                          (id) => id !== k.id,
                                        ),
                                  )
                                }
                              />
                              {k.name}
                              <small>{labels[k.status]}</small>
                            </label>
                          ))}
                      </details>
                      <p className="config-note">
                        扩展与参考资料版本将在任务开始时固定。
                      </p>
                    </div>
                  )}
                  <div className="assistant-message">
                    <span className="tiny-label">产品助手</span>
                    <p>
                      {req.heads.requirement
                        ? "可以继续生成成果，也可以描述一个具体修改。我会保留版本并展示修改摘要。"
                        : "先写下你的想法，或添加资料。我会帮你整理需求，提出需要澄清的问题。"}
                    </p>
                  </div>
                  {ws.messages.slice(-8).map((m: any) => (
                    <div
                      key={m.id}
                      className={
                        m.role === "user" ? "user-message" : "assistant-message"
                      }
                    >
                      <span className="tiny-label">
                        {m.role === "user" ? "你" : "产品助手"}
                      </span>
                      <p>{m.content}</p>
                    </div>
                  ))}
                  {ws.questions
                    .filter((q: any) => q.status === "open")
                    .map((q: any) => (
                      <div className="question-card" key={q.id}>
                        <b>需要你补充</b>
                        <p>{q.question}</p>
                        <button
                          onClick={() =>
                            open({
                              title: "回答产品助手",
                              description: q.question,
                              fields: [
                                {
                                  name: "answer",
                                  label: "你的回答",
                                  type: "textarea",
                                  required: true,
                                },
                              ],
                              action: async (v) => {
                                await api(
                                  "/questions/" + q.id + "/answer",
                                  "POST",
                                  v,
                                );
                              },
                            })
                          }
                        >
                          填写回答
                        </button>
                      </div>
                    ))}
                  {[...ws.tasks]
                    .reverse()
                    .slice(0, 4)
                    .map((t: any) => (
                      <div className="task-card" key={t.id}>
                        <div>
                          <b>
                            <Sparkles size={13} />
                            {labels[t.kind]}
                          </b>
                          <span className={"task-state " + t.status}>
                            {labels[t.status] || t.status}
                          </span>
                        </div>
                        <progress max={100} value={t.progress} />
                        <p>
                          {t.error ||
                            t.candidate?.summary ||
                            t.events.at(-1)?.text ||
                            "准备输入快照…"}
                        </p>
                        <details>
                          <summary>执行记录与固定版本</summary>
                          <small>
                            模型：{t.snapshot.model} · {t.snapshot.executor} ·
                            思考深度：{t.snapshot.reasoningEffort || "默认"}
                          </small>
                          {t.snapshot.releases.map((x: any) => (
                            <small key={x.id}>
                              {x.manifest.name} · v{x.number} ·{" "}
                              {x.hash.slice(0, 8)}
                            </small>
                          ))}
                          {t.events.map((e: any, i: number) => (
                            <p key={i}>
                              {fmt(e.at)} {e.text}
                            </p>
                          ))}
                        </details>
                        <div className="task-actions">
                          {["queued", "running", "waiting"].includes(
                            t.status,
                          ) && (
                            <button
                              onClick={() =>
                                run(
                                  () =>
                                    api(
                                      "/tasks/" + t.id + "/cancel",
                                      "POST",
                                      {},
                                    ),
                                  "任务已取消",
                                )
                              }
                            >
                              <Square size={12} />
                              取消
                            </button>
                          )}
                          {[
                            "failed",
                            "cancelled",
                            "interrupted",
                            "waiting",
                          ].includes(t.status) && (
                            <button
                              onClick={() =>
                                run(
                                  () =>
                                    api(
                                      "/tasks/" + t.id + "/retry",
                                      "POST",
                                      {},
                                    ),
                                  "已按原快照重试",
                                )
                              }
                            >
                              <RotateCcw size={12} />
                              重试 / 继续
                            </button>
                          )}
                          {t.candidate &&
                            t.status !== "completed" &&
                            !["queued", "running"].includes(t.status) && (
                              <button
                                onClick={() =>
                                  open({
                                    title: "恢复任务候选",
                                    description:
                                      "比较候选与当前成果；确认后将候选保存为当前成果的新版本。",
                                    fields: [
                                      {
                                        name: "preview",
                                        label: "候选内容",
                                        type: "readonly",
                                        value: t.candidate.content,
                                      },
                                    ],
                                    submit: "采纳为新版本",
                                    action: async () => {
                                      await api(
                                        "/tasks/" + t.id + "/recover",
                                        "POST",
                                        { base: req.heads[t.kind] || null },
                                      );
                                    },
                                  })
                                }
                              >
                                查看候选
                              </button>
                            )}
                        </div>
                      </div>
                    ))}
                  {ws.annotations
                    .filter((a: any) => a.versionId === version?.id)
                    .map((a: any) => (
                      <div className="annotation" key={a.id}>
                        <MessageSquare size={14} />
                        <p>
                          <b>{a.pageId}</b>
                          {a.text}
                        </p>
                      </div>
                    ))}
                  {ws.publications.map((p: any) => (
                    <div className="task-card" key={p.id}>
                      <b>飞书交付 · {labels[p.status] || p.status}</b>
                      <p>{p.error || p.target}</p>
                      {p.status === "published" && (
                        <button
                          onClick={() =>
                            run(async () => {
                              const ticket = await api(
                                "/publications/" + p.id + "/remote-preview",
                                "POST",
                                {},
                              );
                              open({
                                title: "核对远端修改",
                                description:
                                  "请先导入远端修改并合并到当前 PRD、确认终稿。此处确认允许用当前终稿覆盖这一远端版本，原发布记录保留。",
                                fields: [
                                  {
                                    name: "content",
                                    label: "远端当前内容",
                                    type: "readonly",
                                    value: ticket.content,
                                  },
                                ],
                                submit: "确认合并已完成，采用此远端基线",
                                action: async () => {
                                  await api("/publish/accept-remote", "POST", {
                                    ticketId: ticket.id,
                                  });
                                },
                              });
                            }, "")
                          }
                        >
                          处理远端冲突
                        </button>
                      )}
                      {p.url && (
                        <a href={p.url} target="_blank" rel="noreferrer">
                          打开远端文档 <ExternalLink size={12} />
                        </a>
                      )}
                      {["writing", "uncertain", "conflict"].includes(
                        p.status,
                      ) && (
                        <button
                          onClick={() =>
                            open({
                              title: "核验上次发布",
                              description:
                                "填写远端已创建的文档 ID。核验成功前不会重复创建。",
                              fields: [
                                {
                                  name: "remoteId",
                                  label: "远端文档 ID / URL",
                                  value: p.remoteId || "",
                                  required: true,
                                },
                                {
                                  name: "attachmentsConfirmed",
                                  label: "附件核验",
                                  type: "select",
                                  value: "false",
                                  options: [
                                    { value: "false", label: "按自动记录核验" },
                                    {
                                      value: "true",
                                      label:
                                        "我已在飞书逐项核对本次所有附件均已存在",
                                    },
                                  ],
                                },
                              ],
                              action: async (v) => {
                                await api(
                                  "/publications/" + p.id + "/reconcile",
                                  "POST",
                                  {
                                    ...v,
                                    attachmentsConfirmed:
                                      v.attachmentsConfirmed === "true",
                                  },
                                );
                              },
                            })
                          }
                        >
                          核验远端结果
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="composer">
                  {selectedText && (
                    <div className="selection-chip">
                      已选 {selectedText.length} 字 · 仅修改选区
                      <button
                        className="icon"
                        onClick={() => setSelectedText("")}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )}
                  <div className="composer-box">
                    <textarea
                      aria-label="给产品助手的任务"
                      value={taskPrompt}
                      onChange={(e) => setTaskPrompt(e.target.value)}
                      placeholder={
                        kind === "prototype" && version
                          ? "例如：将主按钮改成暖橙色，保留交互…"
                          : "描述你想生成或修改的内容…"
                      }
                    />
                    <div className="composer-toolbar">
                      <button
                        className="icon"
                        title="添加需求资料"
                        onClick={() => uploadKnowledge(true)}
                      >
                        <Plus size={22} />
                      </button>
                      <span className="composer-confirmation">
                        <Shield size={17} />
                        由你确认
                      </span>
                      <button
                        className="composer-model"
                        title="选择本次任务模型与思考深度"
                        aria-label="选择本次任务模型与思考深度"
                        onClick={() =>
                          open({
                            title: "本次任务模型",
                            description:
                              "仅应用于接下来提交的任务，已运行任务的模型与版本保持不变。",
                            fields: assistantFields({
                              executor: effectiveExecutor,
                              model: effectiveModel,
                              reasoningEffort: effectiveEffort,
                            }).map((f) =>
                              f.name === "executor"
                                ? { ...f, label: "产品助手" }
                                : f,
                            ),
                            action: async (v) => {
                              setExecutor(v.executor);
                              setTaskModel(v.model.trim());
                              setReasoningEffort(v.reasoningEffort);
                            },
                          })
                        }
                      >
                        <span>
                          {effectiveModel
                            .replace(/^gpt-/, "")
                            .replace(/-/g, " ")}
                        </span>
                        <span className="composer-effort">
                          {effortOptions
                            .find((x) => x.value === effectiveEffort)
                            ?.label.split(" · ")[0] || effectiveEffort}
                        </span>
                        <ChevronDown size={16} />
                      </button>
                      <button
                        className="send-button"
                        disabled={
                          busy ||
                          !taskPrompt.trim() ||
                          ws.tasks.some((t: any) =>
                            ["queued", "running"].includes(t.status),
                          )
                        }
                        title="开始任务"
                        onClick={startTask}
                      >
                        <ArrowUp size={23} />
                      </button>
                    </div>
                  </div>
                  <small className="privacy-note">
                    本次内容将发送至在线模型。确认操作由你完成。
                  </small>
                </div>
              </aside>
              <section className="artifact-panel">
                <div className="artifact-toolbar">
                  <div className="artifact-title">
                    {kind === "prototype" ? (
                      <Monitor size={18} />
                    ) : (
                      <FileText size={18} />
                    )}
                    <b>{labels[kind]}</b>
                    {version && <span className="pill">v{version.number}</span>}
                    {dirty && <small className="unsaved">未保存</small>}
                  </div>
                  <div>
                    {kind === "prototype" && (
                      <button onClick={() => setPreview(!preview)}>
                        {preview ? "源码" : "预览"}
                      </button>
                    )}
                    {version && (
                      <a
                        className="button icon"
                        title="导出当前版本"
                        href={"/api/versions/" + version.id + "/export"}
                      >
                        <Download size={16} />
                      </a>
                    )}
                    <button disabled={!dirty || busy} onClick={save}>
                      <Check size={15} />
                      保存版本
                    </button>
                  </div>
                </div>
                {chosenVersion && chosenVersion !== req.heads[kind] && (
                  <div className="banner warning">
                    正在查看历史版本。
                    <button
                      onClick={() =>
                        trusted(
                          "恢复历史版本",
                          "恢复会创建一个新版本，不会抹除历史或自动重新确认。",
                          async () => {
                            await api(
                              "/requirements/" + requirementId + "/restore",
                              "POST",
                              {
                                versionId: version.id,
                                base: req.heads[kind] || null,
                              },
                            );
                            setChosenVersion("");
                          },
                        )
                      }
                    >
                      <RotateCcw size={14} />
                      恢复为新版本
                    </button>
                  </div>
                )}
                {kind === "prototype" && preview ? (
                  version ? (
                    <div className="prototype-wrap">
                      <div className="preview-top">
                        <span />
                        <span />
                        <span />
                        <small>隔离交互预览 · 禁止网络与工作台接口</small>
                      </div>
                      <iframe
                        title="交互原型预览"
                        sandbox="allow-scripts"
                        src={"/api/versions/" + version.id + "/preview"}
                        key={version.id}
                      />
                    </div>
                  ) : (
                    <div className="artifact-empty">
                      <div className="empty-symbol">
                        <Monitor size={42} />
                        <Sparkles size={19} />
                      </div>
                      <h2>让需求变成可体验的页面</h2>
                      <p>
                        在右侧选择生成方式与风格，描述要展示的流程。
                        <br />
                        生成后可点击体验、批注和局部修改。
                      </p>
                      <button onClick={() => setShowConfig(true)}>
                        <Palette size={16} />
                        选择生成配置
                      </button>
                    </div>
                  )
                ) : kind === "review" && version ? (
                  <div className="review-pane">
                    <h2>评审结论</h2>
                    <p>{version.metadata.summary}</p>
                    {version.metadata.issues?.length === 0 && (
                      <div className="notice">
                        <CheckCircle2 size={18} />
                        本次评审未报告问题，仍需用户确认终稿。
                      </div>
                    )}
                    {version.metadata.issues?.map((issue: any) => (
                      <article className="review-issue" key={issue.id}>
                        <span className={"pill " + issue.severity}>
                          {issue.severity} · {issue.id}
                        </span>
                        <h3>{issue.description}</h3>
                        <p>{issue.suggestion}</p>
                        {ws.resolutions.some(
                          (x: any) =>
                            x.reviewId === version.id && x.issueId === issue.id,
                        ) ? (
                          <span className="success">已记录用户裁决</span>
                        ) : (
                          <button
                            onClick={() =>
                              open({
                                title: "处理评审问题 " + issue.id,
                                description: issue.description,
                                fields: [
                                  {
                                    name: "decision",
                                    label: "处理结果 / 裁决依据",
                                    type: "textarea",
                                    required: true,
                                  },
                                ],
                                action: async (v) => {
                                  await api(
                                    "/reviews/" + version.id + "/resolve",
                                    "POST",
                                    { issueId: issue.id, decision: v.decision },
                                  );
                                },
                              })
                            }
                          >
                            记录处理结果
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="editor-container">
                    <div className="editor-meta">
                      {kind === "requirement"
                        ? "记录目标、范围、核心规则与待确认问题。"
                        : kind === "prd"
                          ? "Markdown 文档 · 支持选中文本交给 AI 修改"
                          : "可编辑原始内容"}
                      <span>本地草稿自动保留</span>
                    </div>
                    <textarea
                      ref={textarea}
                      className={
                        "document-editor " +
                        (kind === "prototype" ? "code" : "")
                      }
                      aria-label={labels[kind] + "编辑器"}
                      spellCheck={false}
                      value={editor}
                      onChange={(e) => setDraft(e.target.value)}
                      onSelect={(e) => {
                        const t = e.currentTarget;
                        setSelectedText(
                          t.value.slice(t.selectionStart, t.selectionEnd),
                        );
                      }}
                      placeholder={
                        kind === "requirement"
                          ? "# 需求说明\n\n我们希望解决什么问题？\n\n## 用户与场景\n\n## 核心规则\n\n## 待确认事项"
                          : kind === "prd"
                            ? "粘贴已有 Markdown PRD，或在确认原型后让产品助手起草。"
                            : kind === "review"
                              ? '手动评审 JSON：{"summary":"评审结论","issues":[]}'
                              : "粘贴包含 prototype-meta 的自包含 HTML"
                      }
                    />
                  </div>
                )}
                <div className="artifact-bottom">
                  <span>
                    {version
                      ? `更新于 ${fmt(version.createdAt)}`
                      : "尚未生成成果"}
                    {selectedText && ` · 已选中 ${selectedText.length} 字`}
                  </span>
                  <div>
                    {["requirement", "prototype"].includes(kind) &&
                      version &&
                      req.heads[kind] === version.id && (
                        <button
                          className="primary"
                          disabled={dirty || req.confirmed[kind] === version.id}
                          onClick={confirm}
                        >
                          <CheckCheck size={16} />
                          {req.confirmed[kind] === version.id
                            ? "此版本已确认"
                            : "确认" + labels[kind]}
                        </button>
                      )}
                    {kind === "requirement" && req.confirmed.requirement && (
                      <button
                        onClick={() =>
                          open({
                            title: "确认无需原型",
                            description:
                              "仅适用于无 UI / 交互变化的需求。此确认将绑定当前需求版本。",
                            fields: [
                              {
                                name: "reason",
                                label: "无需原型的依据",
                                type: "textarea",
                                required: true,
                              },
                            ],
                            action: async (v) => {
                              await api(
                                "/requirements/" + requirementId + "/waive",
                                "POST",
                                {
                                  versionId: req.heads.requirement,
                                  reason: v.reason,
                                },
                              );
                            },
                          })
                        }
                      >
                        无需原型
                      </button>
                    )}
                    {kind === "prototype" && version && (
                      <button
                        onClick={() =>
                          open({
                            title: "添加页面批注",
                            fields: [
                              {
                                name: "pageId",
                                label: "页面",
                                type: "select",
                                options: version.metadata.pages.map(
                                  (p: any) => ({ value: p.id, label: p.name }),
                                ),
                              },
                              {
                                name: "text",
                                label: "批注",
                                type: "textarea",
                                required: true,
                              },
                            ],
                            action: async (v) => {
                              await api(
                                "/requirements/" +
                                  requirementId +
                                  "/annotations",
                                "POST",
                                { ...v, versionId: version.id },
                              );
                            },
                          })
                        }
                      >
                        <MessageSquare size={15} />
                        批注
                      </button>
                    )}
                    {kind === "prd" && req.stale && version && (
                      <button
                        onClick={() =>
                          trusted(
                            "确认 PRD 已核对同步",
                            "请核对当前原型与需求。确认后会创建绑定当前上游版本的新 PRD，旧版仍保留。",
                            async () => {
                              await api(
                                "/requirements/" + requirementId + "/sync-prd",
                                "POST",
                                { versionId: version.id },
                              );
                              setChosenVersion("");
                            },
                          )
                        }
                      >
                        核对并同步
                      </button>
                    )}
                    {kind === "prd" && version && (
                      <button
                        className="primary"
                        disabled={
                          dirty || req.stale || req.finalVersion === version.id
                        }
                        onClick={() =>
                          trusted(
                            "确认 PRD 终稿",
                            `将 v${version.number} 标记为终稿；飞书发布状态独立保存。`,
                            async () => {
                              await api(
                                "/requirements/" + requirementId + "/finalize",
                                "POST",
                                { versionId: version.id },
                              );
                            },
                          )
                        }
                      >
                        <CheckCheck size={15} />
                        {req.finalVersion === version.id
                          ? "已是终稿"
                          : "确认终稿"}
                      </button>
                    )}
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}
        {view === "knowledge" && (
          <div className="page">
            <div className="page-heading">
              <div>
                <p className="eyebrow">PROJECT MEMORY</p>
                <h1>知识库</h1>
                <p>让每一次决策，都能找到来源。</p>
              </div>
              <button
                className="primary"
                disabled={!projectId}
                onClick={() => uploadKnowledge()}
              >
                <Plus size={17} />
                添加资料
              </button>
            </div>
            {!projectId ? (
              <div className="empty-state">
                <Library size={36} />
                <h2>先创建一个项目</h2>
                <button onClick={newProject}>创建项目</button>
              </div>
            ) : (
              <>
                <div className="knowledge-summary">
                  <div>
                    <b>
                      {
                        knowledge.items.filter((x: any) => !x.requirementId)
                          .length
                      }
                    </b>
                    <span>项目知识</span>
                  </div>
                  <div>
                    <b>
                      {
                        knowledge.items.filter((x: any) => x.requirementId)
                          .length
                      }
                    </b>
                    <span>需求资料</span>
                  </div>
                  <div>
                    <b>
                      {
                        knowledge.items.filter(
                          (x: any) => x.status === "parsed",
                        ).length
                      }
                    </b>
                    <span>完成文本解析</span>
                  </div>
                  <div>
                    <b>{knowledge.conflicts.length}</b>
                    <span>待核对冲突</span>
                  </div>
                </div>
                <div className="list-toolbar">
                  <label className="search-box">
                    <Search size={16} />
                    <input
                      placeholder="搜索名称、模块或内容"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    />
                  </label>
                  <div>
                    <button
                      onClick={() =>
                        open({
                          title: "添加文本知识",
                          fields: [
                            { name: "name", label: "资料名称", required: true },
                            { name: "module", label: "模块", value: "general" },
                            {
                              name: "content",
                              label: "内容",
                              type: "textarea",
                              required: true,
                            },
                          ],
                          action: async (v) => {
                            await api("/knowledge/text", "POST", {
                              ...v,
                              projectId,
                            });
                          },
                        })
                      }
                    >
                      <FileText size={15} />
                      文本
                    </button>
                    <button
                      onClick={() =>
                        open({
                          title: "导入知识目录",
                          description:
                            "目录需先在设置中授权。保留每个原文件与来源，不能解析的资料会明确标记。",
                          fields: [
                            {
                              name: "path",
                              label: "本地目录绝对路径",
                              required: true,
                            },
                            { name: "module", label: "模块", value: "general" },
                          ],
                          action: async (v) => {
                            await api("/knowledge/directory", "POST", {
                              ...v,
                              projectId,
                            });
                          },
                        })
                      }
                    >
                      <FolderKanban size={15} />
                      目录
                    </button>
                    <button
                      onClick={() =>
                        open({
                          title: "导入指定飞书文档",
                          fields: [
                            {
                              name: "doc",
                              label: "飞书文档 URL / ID",
                              required: true,
                            },
                            { name: "name", label: "资料名称", required: true },
                          ],
                          action: async (v) => {
                            await api("/knowledge/feishu", "POST", {
                              ...v,
                              projectId,
                            });
                          },
                        })
                      }
                    >
                      <Link size={15} />
                      飞书
                    </button>
                  </div>
                </div>
                {knowledge.conflicts.length > 0 && (
                  <div className="conflicts">
                    <AlertCircle size={18} />
                    <div>
                      <b>发现资料冲突候选，请核对来源与状态</b>
                      {knowledge.conflicts.map((c: any, i: number) => (
                        <p key={i}>
                          {
                            knowledge.items.find((x: any) => x.id === c.left)
                              ?.name
                          }
                          ：{c.reason}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
                <div className="knowledge-table">
                  <div className="table-head">
                    <span>资料</span>
                    <span>范围 / 模块</span>
                    <span>状态</span>
                    <span>解析</span>
                    <span>操作</span>
                  </div>
                  {knowledge.items
                    .filter((k: any) =>
                      (k.name + " " + k.module + " " + k.text).includes(filter),
                    )
                    .map((k: any) => (
                      <div className="table-row" key={k.id}>
                        <button
                          className="knowledge-name"
                          onClick={() =>
                            open({
                              title: k.name,
                              description: `来源：${k.source} · v${k.version} · ${labels[k.status] || k.status}`,
                              fields: [
                                {
                                  name: "text",
                                  label: "解析内容",
                                  type: "readonly",
                                  value: k.text || k.error,
                                },
                              ],
                              submit: "关闭",
                              action: async () => {},
                            })
                          }
                        >
                          <span className="file-icon">
                            <FileText size={20} />
                          </span>
                          <span>
                            <b>{k.name}</b>
                            <small>
                              v{k.version} · {fmt(k.createdAt)}
                            </small>
                          </span>
                        </button>
                        <span>
                          {k.requirementId ? "需求资料" : "项目知识"}
                          <small>{k.module}</small>
                        </span>
                        <span className="pill">
                          {labels[k.state] || k.state}
                        </span>
                        <span
                          className={"parse-status " + k.status}
                          title={k.error}
                        >
                          {labels[k.status] || k.status}
                        </span>
                        <div>
                          <a
                            href={"/api/knowledge/" + k.id + "/file"}
                            className="button icon"
                            title="下载原文件"
                          >
                            <Download size={15} />
                          </a>
                          {!k.requirementId && (
                            <button
                              title="提出知识更新"
                              onClick={() =>
                                open({
                                  title: "提出知识更新",
                                  description:
                                    "正式知识不会被直接覆盖。提案经用户采纳后保存为新版本。",
                                  fields: [
                                    {
                                      name: "text",
                                      label: "建议的新内容",
                                      type: "textarea",
                                      value: k.text,
                                      required: true,
                                    },
                                    {
                                      name: "reason",
                                      label: "依据与影响",
                                      required: true,
                                    },
                                  ],
                                  action: async (v) => {
                                    await api(
                                      "/knowledge/" + k.id + "/proposals",
                                      "POST",
                                      v,
                                    );
                                  },
                                })
                              }
                            >
                              提案
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  {!knowledge.items.length && (
                    <div className="empty-state">
                      <BookOpen size={33} />
                      <h3>知识从一份资料开始</h3>
                      <p>
                        支持 Markdown、TXT、PDF、DOCX、CSV 与图片。
                        <br />
                        图片及扫描 PDF 不会被假装成已解析文本。
                      </p>
                    </div>
                  )}
                </div>
                {knowledge.proposals.length > 0 && (
                  <>
                    <h2 className="subheading">知识更新提案</h2>
                    {knowledge.proposals.map((p: any) => (
                      <article className="proposal" key={p.id}>
                        <div>
                          <b>
                            {
                              knowledge.items.find(
                                (x: any) => x.id === p.knowledgeId,
                              )?.name
                            }
                          </b>
                          <span className="pill">
                            {p.status === "adopted" ? "已采纳" : "待采纳"}
                          </span>
                        </div>
                        <p>{p.reason}</p>
                        <details>
                          <summary>查看建议内容</summary>
                          <pre>{p.text}</pre>
                        </details>
                        {p.status === "pending" && (
                          <button
                            className="primary"
                            onClick={() =>
                              trusted(
                                "采纳知识更新",
                                "此操作会创建一个新的正式知识版本，原版本保留。",
                                async () => {
                                  await api(
                                    "/proposals/" + p.id + "/adopt",
                                    "POST",
                                    {},
                                  );
                                },
                              )
                            }
                          >
                            确认采纳
                          </button>
                        )}
                      </article>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        )}
        {view === "extensions" && (
          <div className="page">
            <div className="page-heading">
              <div>
                <p className="eyebrow">YOUR WAY OF WORKING</p>
                <h1>扩展中心</h1>
                <p>让工作方法、产物结构和工具能力，各自独立生长。</p>
              </div>
              <div className="row">
                <button onClick={() => createExtension()}>
                  <Plus size={16} />
                  创建
                </button>
                <button onClick={() => importExtension("github")}>
                  <Github size={16} />
                  GitHub 导入 Skill
                </button>
                <button className="primary" onClick={() => importExtension()}>
                  <Upload size={16} />
                  导入扩展
                </button>
              </div>
            </div>
            <div className="extension-explainer">
              <div>
                <Sparkles size={21} />
                <b>Skills</b>
                <p>
                  规定如何完成任务
                  <br />
                  标准 SKILL.md 与完整资源
                </p>
              </div>
              <div>
                <FileText size={21} />
                <b>模板</b>
                <p>
                  规定成果如何组织
                  <br />
                  章节、字段与写作要求
                </p>
              </div>
              <div>
                <Blocks size={21} />
                <b>功能插件</b>
                <p>
                  提供真实工具能力
                  <br />
                  统一权限和服务端注册
                </p>
              </div>
            </div>
            <div className="list-toolbar">
              <div className="tabs">
                {[
                  ["all", "全部"],
                  ["skill", "任务 Skills"],
                  ["style", "风格 Skills"],
                  ["template", "PRD 模板"],
                  ["plugin", "功能插件"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    className={extensionType === value ? "active" : ""}
                    onClick={() => setExtensionType(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {extensionType === "template" && (
                <button
                  onClick={() =>
                    open({
                      title: "从已有 PRD 提取模板",
                      description:
                        "提取为候选结构，编辑确认后才能保存。不会把业务结论作为模板事实。",
                      fields: [
                        {
                          name: "content",
                          label: "已有 Markdown PRD",
                          type: "textarea",
                          required: true,
                        },
                      ],
                      submit: "提取结构",
                      action: async (v) => {
                        const t = await api("/templates/extract", "POST", v);
                        setTimeout(
                          () =>
                            createExtension(
                              "template",
                              {
                                name: "提取模板",
                                type: "template",
                                release: {
                                  content: t.content,
                                  manifest: { stages: ["prd"] },
                                },
                              },
                              true,
                            ),
                          0,
                        );
                      },
                    })
                  }
                >
                  从 PRD 提取
                </button>
              )}
            </div>
            <div className="extension-grid">
              {data.extensions
                .filter(
                  (x: any) =>
                    extensionType === "all" || x.type === extensionType,
                )
                .map((e: any) => (
                  <article
                    className={
                      "extension-card " +
                      (!e.enabled ? "disabled-extension" : "")
                    }
                    key={e.id}
                  >
                    <div className="extension-card-top">
                      <span className={"extension-icon " + e.type}>
                        {e.type === "style" ? (
                          <Palette size={23} />
                        ) : e.type === "template" ? (
                          <FileText size={23} />
                        ) : (
                          <Sparkles size={23} />
                        )}
                      </span>
                      <span className="pill">
                        {e.release.compatible ? "兼容" : "需检查"} · v
                        {e.release.number}
                      </span>
                    </div>
                    <h3>{e.name}</h3>
                    <p className="extension-desc">
                      {e.description ||
                        e.release.content
                          .split("\n")
                          .find((x: string) => x.startsWith("description:"))
                          ?.replace("description:", "")
                          .trim() ||
                        "自定义产物模板，控制内容组织与写作要求。"}
                    </p>
                    <div className="extension-tags">
                      {e.release.manifest.stages.map((st: string) => (
                        <span key={st}>{labels[st]}</span>
                      ))}
                    </div>
                    <details>
                      <summary>来源、权限与资源</summary>
                      <small>来源：{e.release.source}</small>
                      <small>版本摘要：{e.release.hash.slice(0, 16)}</small>
                      <small>
                        权限：
                        {e.release.manifest.permissions.join(", ") ||
                          "无工具权限"}
                      </small>
                      <small>
                        依赖：
                        {e.release.manifest.dependencies.join(", ") || "无"}
                      </small>
                      <small>
                        资源：{e.release.resources.length}{" "}
                        个文件（保留，不执行）
                      </small>
                      {e.release.warnings.map((w: string) => (
                        <p className="warning-text" key={w}>
                          {w}
                        </p>
                      ))}
                      <label>
                        回退版本
                        <select
                          value={e.currentRelease}
                          onChange={(event) =>
                            run(
                              () =>
                                api(
                                  "/extensions/" + e.id + "/rollback",
                                  "POST",
                                  { releaseId: event.target.value },
                                ),
                              "已切换扩展版本",
                            )
                          }
                        >
                          {e.versions.map((v: any) => (
                            <option value={v.id} key={v.id}>
                              v{v.number} · {fmt(v.createdAt)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        onClick={() =>
                          open({
                            title: "项目绑定",
                            description:
                              "留空表示所有项目可用。填写项目 ID，以逗号分隔。",
                            fields: [
                              {
                                name: "projectIds",
                                label: data.projects
                                  .map((p: any) => p.name + ": " + p.id)
                                  .join("；"),
                                value: e.projectIds.join(","),
                              },
                            ],
                            action: async (v) => {
                              await api("/extensions/" + e.id, "PATCH", {
                                projectIds: v.projectIds
                                  .split(",")
                                  .map((x: string) => x.trim())
                                  .filter(Boolean),
                              });
                            },
                          })
                        }
                      >
                        项目绑定
                      </button>
                    </details>
                    <div className="extension-actions">
                      <button onClick={() => createExtension(e.type, e, true)}>
                        复制
                      </button>
                      <button onClick={() => createExtension(e.type, e)}>
                        编辑
                      </button>
                      <button onClick={() => importExtension("directory", e)}>
                        更新
                      </button>
                      <button
                        className={"toggle " + (e.enabled ? "on" : "")}
                        aria-label={(e.enabled ? "停用" : "启用") + e.name}
                        onClick={() =>
                          run(
                            () =>
                              api("/extensions/" + e.id, "PATCH", {
                                enabled: !e.enabled,
                              }),
                            e.enabled ? "已停用" : "已启用",
                          )
                        }
                      >
                        <span />
                      </button>
                    </div>
                  </article>
                ))}
              {["all", "plugin"].includes(extensionType) &&
                data.plugins.map((p: any) => (
                  <article className="extension-card" key={p.id}>
                    <div className="extension-card-top">
                      <span className="extension-icon plugin">
                        <Send size={23} />
                      </span>
                      <span className="pill">内置受控插件</span>
                    </div>
                    <h3>{p.name}</h3>
                    <p>
                      从指定飞书文档导入资料，发布与更新 PRD。凭证由本机
                      lark-cli 钥匙串管理。
                    </p>
                    <div className="extension-tags">
                      {p.capabilities.map((x: string) => (
                        <span key={x}>{x}</span>
                      ))}
                    </div>
                    <details>
                      <summary>权限声明</summary>
                      {p.permissions.map((x: string) => (
                        <small key={x}>{x}</small>
                      ))}
                    </details>
                    <div className="extension-actions">
                      <button
                        onClick={() =>
                          run(
                            () =>
                              api("/plugins/" + p.id, "PATCH", {
                                enabled: !p.config.enabled,
                                projectIds: p.config.projectIds,
                              }),
                            p.config.enabled ? "插件已停用" : "插件已启用",
                          )
                        }
                      >
                        {p.config.enabled ? "停用" : "启用"}
                      </button>
                      <button onClick={() => setView("settings")}>
                        连接与配置 <ArrowUpRight size={14} />
                      </button>
                    </div>
                  </article>
                ))}
            </div>
            <p className="footnote">
              <Shield size={14} />
              外部资料不能改变权限或确认规则。第三方可执行插件需经过代码审查与注册，首版不开放任意代码安装。
            </p>
          </div>
        )}
        {view === "settings" && (
          <div className="page settings-page">
            <div className="page-heading">
              <div>
                <p className="eyebrow">CONNECTED, ON YOUR TERMS</p>
                <h1>设置</h1>
                <p>连接状态、有效配置与资料边界，都清楚可见。</p>
              </div>
              <button
                onClick={() =>
                  run(
                    async () => setStatus(await api("/status")),
                    "已检查本机配置",
                  )
                }
              >
                <RotateCcw size={16} />
                检查连接配置
              </button>
            </div>
            <div className="notice">
              <Shield size={19} />
              <p>
                <b>本地优先，不等于离线</b>
                <br />
                {data.onlineNotice} API
                密钥由服务端读取；订阅凭证保存在独立私有目录，不进入页面、Prompt
                或数据库。
              </p>
            </div>
            {[
              [
                "codex",
                data.settings.executor === "codex"
                  ? "Codex · 默认产品助手"
                  : "Codex · 可选助手",
                status?.codex?.mode === "api-key"
                  ? "API Key 模式（单独计费）· WORKBENCH_CODEX_API_KEY"
                  : "默认使用 ChatGPT 订阅登录 · 自动检测本机 Codex",
                "使用官方 Codex SDK 完成需求整理、原型、PRD 与评审。独立会话与 macOS 沙箱隔离；未连接会明确提示，不会静默切换助手。",
              ],
              [
                "claude",
                data.settings.executor === "claude"
                  ? "Claude · 默认产品助手"
                  : "Claude · 可选助手",
                "WORKBENCH_ANTHROPIC_API_KEY",
                "SDK 管理主 Agent 循环与上下文。工具仅能读取任务快照和提交候选成果。",
              ],
              [
                "feishu",
                "飞书 · lark-cli",
                "lark-cli config init / lark-cli auth login",
                "沿用本机 lark-cli 与 OS 钥匙串。发布前检查 docs 权限与目标位置。",
              ],
            ].map(([key, title, config, desc]) => (
              <section className="setting-card" key={key}>
                <div className="setting-card-heading">
                  <span className="extension-icon">
                    {key === "feishu" ? (
                      <Send size={22} />
                    ) : (
                      <Sparkles size={22} />
                    )}
                  </span>
                  <h3>{title}</h3>
                  <span className="pill">
                    {status
                      ? labels[status[key]?.state] || status[key]?.state
                      : "检测中"}
                  </span>
                </div>
                <p>{desc}</p>
                <div className="config-row">
                  <span>配置方式</span>
                  <code>{config}</code>
                </div>
                <div className="config-status">
                  <AlertCircle size={15} />
                  <span>{status?.[key]?.detail || "请点击检查连接配置"}</span>
                </div>
                {key === "codex" && (
                  <>
                    <div className="config-row">
                      <button
                        onClick={() =>
                          run(async () => {
                            await api("/codex/login", "POST", {});
                            setStatus(await api("/status"));
                          }, "已发起订阅登录")
                        }
                      >
                        使用 ChatGPT 登录
                      </button>
                      <button
                        onClick={() =>
                          trusted(
                            "退出订阅登录",
                            "将移除网站的独立登录状态，进行中的登录也会取消。",
                            async () => {
                              await api("/codex/logout", "POST", {});
                              setStatus(await api("/status"));
                            },
                          )
                        }
                      >
                        退出 / 取消登录
                      </button>
                    </div>
                    {status?.codex?.login && (
                      <div className="login-status" role="status">
                        <p>{status.codex.login.detail}</p>
                        {status.codex.login.url && (
                          <a
                            href={status.codex.login.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            打开官方登录页面 ↗
                          </a>
                        )}
                        {status.codex.login.code && (
                          <p>
                            一次性代码：
                            <strong>{status.codex.login.code}</strong>
                          </p>
                        )}
                      </div>
                    )}
                    <div className="config-row">
                      <span>系统默认助手 / 模型 / 思考深度</span>
                      <b>
                        {data.settings.executor} · {data.settings.model} ·{" "}
                        {data.settings.reasoningEffort}
                      </b>
                      <button
                        onClick={() =>
                          open({
                            title: "设置默认助手",
                            fields: assistantFields(data.settings),
                            action: async (v) => {
                              await api("/settings", "PATCH", v);
                            },
                          })
                        }
                      >
                        编辑
                      </button>
                    </div>
                    <p className="footnote">
                      真实连接可通过需求工作区提交任务验证，执行记录会保存模型与结果；未配置不会伪造输出。
                    </p>
                  </>
                )}
                {key === "codex" && (
                  <p className="footnote">
                    独立登录目录：{status?.codex?.home || "数据目录/codex-auth"}
                    。不会自动读取 Codex 桌面登录。
                  </p>
                )}
              </section>
            ))}
            <section className="setting-card">
              <div className="setting-card-heading">
                <span className="extension-icon">
                  <FolderKanban size={22} />
                </span>
                <h3>存储与目录授权</h3>
              </div>
              <div className="config-row">
                <span>数据库与文件</span>
                <code>{status?.storage || "workbench/.data"}</code>
              </div>
              <p>
                SQLite 保存业务状态，原文件保存在
                files，两个执行器凭证和会话目录独立。备份时停止服务并复制整个数据目录。
              </p>
              <div className="roots">
                {data.settings.authorizedRoots.map((x: string) => (
                  <code key={x}>{x}</code>
                ))}
              </div>
              <button
                onClick={() =>
                  open({
                    title: "授权本地导入目录",
                    description:
                      "只用于用户主动导入文件。Agent 不会因此获得任意目录读写权限。禁止导入软链接与隐藏文件。",
                    fields: [
                      {
                        name: "roots",
                        label: "绝对路径，每行一个",
                        type: "textarea",
                        value: data.settings.authorizedRoots.join("\n"),
                      },
                    ],
                    submit: "保存授权目录",
                    action: async (v) => {
                      await api("/settings", "PATCH", {
                        authorizedRoots: v.roots
                          .split("\n")
                          .map((x: string) => x.trim())
                          .filter(Boolean),
                      });
                    },
                  })
                }
              >
                编辑授权目录
              </button>
            </section>
            <section className="setting-card">
              <h3>系统默认扩展</h3>
              <p>
                本次任务设置 → 项目默认 →
                系统默认。任何层级都不能覆盖业务门禁与安全权限。
              </p>
              <button
                onClick={() =>
                  open({
                    title: "系统默认扩展",
                    fields: [
                      {
                        name: "styleId",
                        label: "默认风格",
                        type: "select",
                        value: data.settings.defaults.styleId,
                        options: options("style").map((x: any) => ({
                          value: x.id,
                          label: x.name,
                        })),
                      },
                      {
                        name: "templateId",
                        label: "默认 PRD 模板",
                        type: "select",
                        value: data.settings.defaults.templateId,
                        options: options("template").map((x: any) => ({
                          value: x.id,
                          label: x.name,
                        })),
                      },
                    ],
                    action: async (v) => {
                      await api("/settings", "PATCH", {
                        defaults: { ...data.settings.defaults, ...v },
                      });
                    },
                  })
                }
              >
                编辑系统默认
              </button>
            </section>
          </div>
        )}
      </main>
      {dialog && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) setDialog(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label={dialog.title}
            className={
              "modal " +
              (dialog.fields.some((x) =>
                ["textarea", "readonly"].includes(x.type || ""),
              )
                ? "wide"
                : "")
            }
          >
            <div className="modal-heading">
              <h2>{dialog.title}</h2>
              <button
                className="icon"
                aria-label="关闭"
                onClick={() => setDialog(null)}
              >
                <X size={19} />
              </button>
            </div>
            {dialog.description && <p>{dialog.description}</p>}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                const values = Object.fromEntries(form);
                setError("");
                setBusy(true);
                try {
                  await dialog.action(values);
                  setDialog(null);
                  await reload();
                  if (!dialog.skipScopedReload)
                    await Promise.all([loadWorkspace(), loadKnowledge()]);
                  setToast("操作完成");
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {dialog.fields.map((f) => (
                <label className="form-field" key={f.name}>
                  {f.label}
                  {f.type === "select" ? (
                    <select
                      aria-label={f.label}
                      name={f.name}
                      defaultValue={f.value || f.options?.[0]?.value}
                    >
                      {f.options?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : f.type === "textarea" || f.type === "readonly" ? (
                    <textarea
                      aria-label={f.label}
                      name={f.name}
                      defaultValue={f.value}
                      required={f.required}
                      readOnly={f.type === "readonly"}
                      rows={10}
                    />
                  ) : (
                    <input
                      aria-label={f.label}
                      list={f.name === "model" ? "assistant-models" : undefined}
                      type={f.type || "text"}
                      name={f.name}
                      defaultValue={f.type === "file" ? undefined : f.value}
                      required={f.required}
                    />
                  )}{" "}
                  {f.hint && <small>{f.hint}</small>}
                </label>
              ))}
              {error && <div className="modal-error">{error}</div>}
              <div className="modal-actions">
                <button type="button" onClick={() => setDialog(null)}>
                  取消
                </button>
                <button type="submit" disabled={busy} className="primary">
                  {busy ? "处理中…" : dialog.submit || "保存"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
