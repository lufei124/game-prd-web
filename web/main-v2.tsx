import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  CircleDot,
  Download,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  Library,
  LoaderCircle,
  LogOut,
  MessageSquare,
  Monitor,
  PanelRightOpen,
  Plus,
  RefreshCcw,
  Search,
  Settings,
  Sparkles,
  SquareMousePointer,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import { api } from "./api";
import "./v2.css";

type View = "home" | "knowledge" | "settings" | "workspace";
type Stage = "requirement" | "prototype" | "prd" | "review";
type Role = { id: string; name: string; focus: string };
type Source = {
  id: string;
  type: "directory" | "feishu";
  location: string;
  name: string;
  lastSynced?: string;
  lastChanges?: number;
  error?: string;
};
type SelectionTarget = {
  selector?: string;
  html?: string;
  text?: string;
  rect?: { x: number; y: number; width: number; height: number };
};
type ReviewBrief = {
  id: string;
  number: number;
  prdVersionId: string;
  html: string;
  createdAt: string;
};

const DEFAULT_ROLES: Role[] = [
  {
    id: "product",
    name: "产品",
    focus: "目标、用户场景、业务规则、范围与价值是否一致",
  },
  {
    id: "design",
    name: "交互设计",
    focus: "逐页核对入口、操作、状态、反馈、异常恢复与可用性",
  },
  {
    id: "engineering",
    name: "研发测试",
    focus: "数据、接口、权限、并发、边界、验收标准和可测试性",
  },
];
const EFFORTS = [
  ["low", "低"],
  ["medium", "中"],
  ["high", "高"],
  ["xhigh", "很高"],
  ["max", "最大"],
  ["ultra", "超深"],
] as const;

const fmt = (value?: string) =>
  value
    ? new Date(value).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const safeJson = <T,>(raw: string | null, fallback: T): T => {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};
const titleFromPrompt = (prompt: string) =>
  (
    prompt
      .split(/\n|。|！|？/)
      .map((x) => x.trim())
      .find(Boolean) || "新需求"
  ).slice(0, 28);
const downloadText = (name: string, content: string, type = "text/plain") => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
};

function withInspector(html: string) {
  const inspector = `<script data-forge-inspector>(function(){
    let enabled=false;
    const box=document.createElement('div');
    box.style.cssText='position:fixed;display:none;pointer-events:none;z-index:2147483647;border:2px solid #111;background:rgba(0,0,0,.04);border-radius:4px';
    document.addEventListener('DOMContentLoaded',()=>document.body.appendChild(box));
    function selector(el){
      if(el.id) return '#'+CSS.escape(el.id);
      const parts=[]; let node=el;
      while(node&&node.nodeType===1&&node!==document.body){
        let part=node.tagName.toLowerCase();
        if(node.classList&&node.classList.length) part+='.'+[...node.classList].slice(0,2).map(x=>CSS.escape(x)).join('.');
        const parent=node.parentElement;
        if(parent){ const same=[...parent.children].filter(x=>x.tagName===node.tagName); if(same.length>1) part+=':nth-of-type('+(same.indexOf(node)+1)+')'; }
        parts.unshift(part); node=parent;
        if(parts.length>=5) break;
      }
      return parts.join(' > ');
    }
    function mark(el){
      if(!enabled||!el||el===box) return;
      const r=el.getBoundingClientRect();
      Object.assign(box.style,{display:'block',left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});
    }
    window.addEventListener('message',e=>{ if(e.data&&e.data.type==='forge-select-mode'){ enabled=!!e.data.enabled; if(!enabled) box.style.display='none'; document.documentElement.style.cursor=enabled?'crosshair':''; }});
    document.addEventListener('mousemove',e=>mark(e.target),true);
    document.addEventListener('click',e=>{
      if(!enabled) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const el=e.target, r=el.getBoundingClientRect();
      parent.postMessage({type:'forge-selection',selector:selector(el),html:el.outerHTML.slice(0,100000),text:(el.innerText||el.textContent||'').slice(0,2000),rect:{x:r.x,y:r.y,width:r.width,height:r.height}},'*');
      enabled=false; box.style.display='none'; document.documentElement.style.cursor='';
    },true);
  })();</script>`;
  return /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, inspector + "</body>")
    : html + inspector;
}

function App() {
  const [data, setData] = useState<any>(null);
  const [view, setView] = useState<View>("home");
  const [projectId, setProjectId] = useState(
    localStorage.getItem("prd-v2-project") || "",
  );
  const [requirementId, setRequirementId] = useState("");
  const [workspace, setWorkspace] = useState<any>(null);
  const [knowledge, setKnowledge] = useState<any>({
    items: [],
    folders: [],
    links: [],
    conflicts: [],
  });
  const [status, setStatus] = useState<any>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [newDraft, setNewDraft] = useState(false);
  const [artifactOpen, setArtifactOpen] = useState(true);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");

  const project = data?.projects?.find((p: any) => p.id === projectId);
  const reviewRoles = data?.settings?.defaults?.reviewRoles || DEFAULT_ROLES;

  const reload = async () => {
    const next = await api("/bootstrap");
    setData(next);
    const nextProject = next.projects.some((p: any) => p.id === projectId)
      ? projectId
      : next.projects[0]?.id || "";
    if (nextProject !== projectId) setProjectId(nextProject);
  };
  const loadKnowledge = async (pid = projectId) => {
    if (pid)
      setKnowledge(
        await api(`/knowledge?projectId=${encodeURIComponent(pid)}`),
      );
  };
  const loadWorkspace = async (rid = requirementId) => {
    if (rid) setWorkspace(await api(`/requirements/${rid}`));
  };
  const refreshAll = async () => {
    await Promise.all([
      reload(),
      loadKnowledge(),
      requirementId ? loadWorkspace() : Promise.resolve(),
    ]);
  };

  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!projectId) return;
    localStorage.setItem("prd-v2-project", projectId);
    loadKnowledge(projectId).catch((e) => setError(e.message));
  }, [projectId]);
  useEffect(() => {
    if (!requirementId) return setWorkspace(null);
    loadWorkspace(requirementId).catch((e) => setError(e.message));
  }, [requirementId]);
  useEffect(() => {
    if (!requirementId) return;
    const timer = setInterval(
      () => loadWorkspace(requirementId).catch(() => {}),
      1400,
    );
    return () => clearInterval(timer);
  }, [requirementId]);
  useEffect(() => {
    if (view === "settings")
      api("/status")
        .then(setStatus)
        .catch((e) => setError(e.message));
  }, [view]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  const run = async (fn: () => Promise<void>, ok = "已完成") => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
      await refreshAll();
      if (ok) setToast(ok);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const enterRequirement = (id: string) => {
    setRequirementId(id);
    setNewDraft(false);
    setArtifactOpen(true);
    setView("workspace");
  };
  const startNew = () => {
    if (!projectId) return;
    setRequirementId("");
    setWorkspace(null);
    setNewDraft(true);
    setArtifactOpen(false);
    setView("workspace");
  };
  const createProject = () => {
    const name = window.prompt("项目名称");
    if (!name?.trim()) return;
    run(async () => {
      const p = await api("/projects", "POST", { name: name.trim() });
      setProjectId(p.id);
      setRequirementId("");
      setView("home");
    }, "项目已创建");
  };

  if (!data)
    return (
      <div className="boot">
        <LoaderCircle className="spin" /> 正在打开工作台…
      </div>
    );

  return (
    <div className="app-shell">
      <aside className="rail">
        <button className="brand" onClick={() => setView("home")}>
          <Sparkles size={17} /> PRD
        </button>
        <nav>
          <NavButton
            active={view === "home"}
            icon={<MessageSquare size={18} />}
            text="需求"
            onClick={() => setView("home")}
          />
          <NavButton
            active={view === "knowledge"}
            icon={<Library size={18} />}
            text="知识库"
            onClick={() => setView("knowledge")}
          />
          <NavButton
            active={view === "settings"}
            icon={<Settings size={18} />}
            text="设置"
            onClick={() => setView("settings")}
          />
        </nav>
        <div className="rail-bottom">
          <label>当前项目</label>
          <select
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setRequirementId("");
              setView("home");
            }}
          >
            {data.projects.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="ghost" onClick={createProject}>
            <Plus size={15} /> 新建项目
          </button>
        </div>
      </aside>
      <main className="main-shell">
        {error && (
          <div className="global-error">
            <X size={14} />
            {error}
            <button onClick={() => setError("")}>关闭</button>
          </div>
        )}
        {toast && (
          <div className="toast">
            <Check size={14} />
            {toast}
          </div>
        )}
        {view === "home" && (
          <Home
            data={data}
            projectId={projectId}
            onNew={startNew}
            onOpen={enterRequirement}
          />
        )}
        {view === "knowledge" && (
          <KnowledgeView
            project={project}
            projectId={projectId}
            knowledge={knowledge}
            settings={data.settings}
            onChanged={refreshAll}
            run={run}
          />
        )}
        {view === "settings" && (
          <SettingsView
            data={data}
            status={status}
            setStatus={setStatus}
            model={model}
            effort={effort}
            setModel={setModel}
            setEffort={setEffort}
            run={run}
          />
        )}
        {view === "workspace" && (
          <Workspace
            project={project}
            projectId={projectId}
            requirementId={requirementId}
            workspace={workspace}
            knowledge={knowledge}
            newDraft={newDraft}
            artifactOpen={artifactOpen}
            setArtifactOpen={setArtifactOpen}
            model={
              model ||
              project?.defaults?.model ||
              data.settings?.model ||
              "gpt-5.6-terra"
            }
            effort={
              effort ||
              project?.defaults?.reasoningEffort ||
              data.settings?.reasoningEffort ||
              "medium"
            }
            setModel={setModel}
            setEffort={setEffort}
            reviewRoles={reviewRoles}
            onCreated={enterRequirement}
            onBack={() => {
              setView("home");
              setNewDraft(false);
            }}
            onRefresh={refreshAll}
            run={run}
          />
        )}
      </main>
    </div>
  );
}

function NavButton({ active, icon, text, onClick }: any) {
  return (
    <button className={active ? "nav active" : "nav"} onClick={onClick}>
      {icon}
      <span>{text}</span>
    </button>
  );
}

function Home({ data, projectId, onNew, onOpen }: any) {
  const requirements = data.requirements.filter(
    (r: any) => r.projectId === projectId,
  );
  return (
    <section className="page home-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">PRODUCT WORKBENCH</p>
          <h1>需求</h1>
          <p>从一句想法开始，先聊清楚，再进入原型和 PRD。</p>
        </div>
        <button className="primary" onClick={onNew}>
          <Plus size={16} /> 新需求
        </button>
      </header>
      <div className="requirement-list">
        {requirements.length === 0 && (
          <button className="empty-card" onClick={onNew}>
            <MessageSquare size={24} />
            <b>创建第一个需求</b>
            <span>像使用 Codex 一样，直接描述你想做什么。</span>
          </button>
        )}
        {requirements.map((r: any) => (
          <button className="req-row" key={r.id} onClick={() => onOpen(r.id)}>
            <div className="req-icon">
              <FileText size={18} />
            </div>
            <div className="req-main">
              <b>{r.name}</b>
              <span>{r.stage}</span>
            </div>
            {r.stale && <span className="warn-chip">待同步</span>}
            <time>{fmt(r.createdAt)}</time>
            <ArrowRight size={16} />
          </button>
        ))}
      </div>
    </section>
  );
}

function Workspace(props: any) {
  const {
    project,
    projectId,
    requirementId,
    workspace,
    knowledge,
    newDraft,
    artifactOpen,
    setArtifactOpen,
    model,
    effort,
    setModel,
    setEffort,
    reviewRoles,
    onCreated,
    onBack,
    onRefresh,
    run,
  } = props;
  const [input, setInput] = useState("");
  const [selection, setSelection] = useState<SelectionTarget | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [dismissedCandidates, setDismissedCandidates] = useState<string[]>([]);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const req = workspace?.requirement;
  const stage: Stage = req?.conversationStage || "requirement";
  const versions = workspace?.versions || [];
  const head = (kind: Stage) =>
    versions.find((v: any) => v.id === req?.heads?.[kind]);
  const requirementVersion = head("requirement");
  const prototypeVersion = head("prototype");
  const prdVersion = head("prd");
  const reviewVersion = head("review");
  const running = workspace?.tasks?.find((t: any) =>
    ["queued", "running"].includes(t.status),
  );
  const lastTask = workspace?.tasks?.at(-1);
  const referenced = lastTask?.snapshot?.knowledge || [];
  const linked = (knowledge.links || [])
    .filter((l: any) => l.requirementId === requirementId)
    .map((l: any) => l.knowledgeId);
  const projectKnowledge = useMemo(() => {
    const latest = new Map<string, any>();
    for (const item of knowledge.items || []) {
      if (item.requirementId) continue;
      const key = `${item.source}:${item.name}`;
      const current = latest.get(key);
      if (!current || (current.version || 0) < (item.version || 0))
        latest.set(key, item);
    }
    return [...latest.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [knowledge.items]);
  const candidateTask = [...(workspace?.tasks || [])]
    .reverse()
    .find(
      (t: any) =>
        t.kind === "prototype" &&
        t.candidateReady &&
        t.candidate?.content &&
        !t.resultId &&
        t.base === prototypeVersion?.id &&
        !dismissedCandidates.includes(t.id),
    );

  useEffect(() => {
    if (!req) return;
    setArtifactOpen(Boolean(req.heads?.[stage] || req.heads?.requirement));
  }, [req?.id, stage, req?.heads?.[stage]]);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const payload = event.data;
      if (!payload || payload.type !== "forge-selection") return;
      setSelection({
        selector: payload.selector,
        html: payload.html,
        text: payload.text,
        rect: payload.rect,
      });
      setSelectionMode(false);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "forge-select-mode", enabled: selectionMode },
      "*",
    );
  }, [selectionMode, prototypeVersion?.id, candidateTask?.id]);

  const toggleMaterial = (knowledgeId: string, checked: boolean) =>
    run(async () => {
      if (checked)
        await api(`/requirements/${requirementId}/materials`, "POST", {
          knowledgeId,
        });
      else
        await api(
          `/requirements/${requirementId}/materials/${knowledgeId}`,
          "DELETE",
          {},
        );
    }, checked ? "已设为重点资料" : "已取消重点资料");

  const send = async (
    override?: string,
    stageOverride?: Stage,
    action: "discuss" | "generate" = "discuss",
    chatOnly = false,
  ) => {
    const prompt = (override ?? input).trim();
    if (!prompt || running) return;
    setInput("");
    if (!requirementId) {
      const r = await api("/requirements", "POST", {
        projectId,
        name: titleFromPrompt(prompt),
        mode: "full",
      });
      onCreated(r.id);
      await api(`/requirements/${r.id}/chat`, "POST", {
        prompt,
        stage: "requirement",
        action: "discuss",
        referenceIds: [],
        executor: "codex",
        model,
        reasoningEffort: effort,
      });
      return;
    }
    const currentStage = stageOverride || stage;
    const targetContext = selection
      ? `\n\n当前选中的原型元素：\nselector: ${selection.selector || "未知"}\ntext: ${selection.text || ""}\nrect: ${JSON.stringify(selection.rect || {})}`
      : "";
    await api(`/requirements/${requirementId}/chat`, "POST", {
      prompt: prompt + targetContext,
      stage: currentStage,
      action,
      chatOnly,
      referenceIds: linked,
      scope: "layout",
      selection: currentStage === "prototype" ? selection?.html || "" : "",
      executor: "codex",
      model,
      reasoningEffort: effort,
    });
    setSelection(null);
    await onRefresh();
  };

  const confirmRequirement = () =>
    run(async () => {
      await api(`/requirements/${requirementId}/confirm`, "POST", {
        kind: "requirement",
        versionId: requirementVersion.id,
      });
      await api(`/requirements/${requirementId}/chat`, "POST", {
        prompt:
          "需求卡已经由用户确认。直接根据已确认需求卡和相关知识生成第一版可交互 HTML 原型。",
        stage: "prototype",
        action: "generate",
        referenceIds: linked,
        executor: "codex",
        model,
        reasoningEffort: effort,
      });
    }, "需求已确认，正在生成原型");

  const confirmPrototype = () =>
    run(async () => {
      await api(`/requirements/${requirementId}/confirm`, "POST", {
        kind: "prototype",
        versionId: prototypeVersion.id,
      });
      await api(`/requirements/${requirementId}/chat`, "POST", {
        prompt:
          "原型已经由用户确认。结合已确认需求卡、当前原型和项目知识，按系统全局 PRD 模板生成完整 PRD 初稿。",
        stage: "prd",
        action: "generate",
        referenceIds: linked,
        executor: "codex",
        model,
        reasoningEffort: effort,
      });
    }, "原型已确认，正在生成 PRD");

  const applyCandidate = () =>
    run(async () => {
      if (!candidateTask) return;
      await api(`/requirements/${requirementId}/versions`, "POST", {
        kind: "prototype",
        content: candidateTask.candidate.content,
        base: candidateTask.base,
        metadata: candidateTask.candidate.metadata,
      });
      setDismissedCandidates((x) => [...x, candidateTask.id]);
    }, "候选修改已应用");

  if (newDraft || !requirementId) {
    return (
      <section className="workspace-page start-workspace">
        <button className="back-link" onClick={onBack}>
          <ArrowLeft size={15} /> 返回需求列表
        </button>
        <div className="start-center">
          <div className="start-mark">
            <Sparkles size={22} />
          </div>
          <h1>描述你想做什么</h1>
          <p>我会先自动查找当前项目知识，再逐轮把需求问清楚。</p>
          <Composer
            value={input}
            onChange={setInput}
            onSend={() => send()}
            disabled={false}
            model={model}
            effort={effort}
            onModelChange={setModel}
            onEffortChange={setEffort}
          />
        </div>
      </section>
    );
  }

  return (
    <section className="workspace-page">
      <header className="workspace-topbar">
        <div>
          <button className="back-link" onClick={onBack}>
            <ArrowLeft size={15} /> {project?.name}
          </button>
          <div className="workspace-title">
            <h2>{req?.name}</h2>
            <StageChip stage={stage} />
          </div>
        </div>
        <div className="top-actions">
          <details className="sources-pop materials-pop">
            <summary>
              <BookOpen size={15} /> 重点资料 {linked.length}
            </summary>
            <div>
              {projectKnowledge.length === 0 && (
                <span>知识库暂无项目资料</span>
              )}
              {projectKnowledge.slice(0, 80).map((item: any) => (
                <label className="material-check" key={item.id}>
                  <input
                    type="checkbox"
                    checked={linked.includes(item.id)}
                    onChange={(e) => toggleMaterial(item.id, e.target.checked)}
                  />
                  <span>{item.name}</span>
                </label>
              ))}
            </div>
          </details>
          {referenced.length > 0 && (
            <details className="sources-pop">
              <summary>
                <Search size={15} /> 已参考 {referenced.length} 份资料
              </summary>
              <div>
                {referenced.map((x: any) => (
                  <span key={x.id}>
                    {x.name}
                    {x.matchedChunks?.[0]?.heading
                      ? ` · ${x.matchedChunks[0].heading}`
                      : ""}
                  </span>
                ))}
              </div>
            </details>
          )}
          {(requirementVersion || prototypeVersion || prdVersion) && (
            <button
              className="ghost"
              onClick={() => setArtifactOpen(!artifactOpen)}
            >
              <PanelRightOpen size={16} />
              {artifactOpen ? "收起成果" : "打开成果"}
            </button>
          )}
        </div>
      </header>

      <div className={artifactOpen ? "workbench split" : "workbench"}>
        <div className="conversation-pane">
          <Conversation
            messages={workspace?.messages || []}
            tasks={workspace?.tasks || []}
          />
          {selection && (
            <div className="selection-chip">
              <SquareMousePointer size={14} />
              <span>
                {selection.selector || selection.text || "已选择原型区域"}
              </span>
              <button onClick={() => setSelection(null)}>
                <X size={13} />
              </button>
            </div>
          )}
          <Composer
            value={input}
            onChange={setInput}
            onSend={() => send()}
            disabled={Boolean(running)}
            model={model}
            effort={effort}
            fixedCount={linked.length}
            onModelChange={setModel}
            onEffortChange={setEffort}
          />
        </div>

        {artifactOpen && (
          <div className="artifact-pane">
            {stage === "requirement" && requirementVersion && (
              <RequirementArtifact
                version={requirementVersion}
                confirmed={
                  req.confirmed?.requirement === requirementVersion.id
                }
                onConfirm={confirmRequirement}
                requirementId={requirementId}
                onRefresh={onRefresh}
                run={run}
              />
            )}
            {stage === "prototype" && prototypeVersion && (
              <PrototypeArtifact
                version={prototypeVersion}
                confirmed={req.confirmed?.prototype === prototypeVersion.id}
                iframeRef={iframeRef}
                selectionMode={selectionMode}
                setSelectionMode={setSelectionMode}
                candidateTask={candidateTask}
                applyCandidate={applyCandidate}
                discardCandidate={() =>
                  candidateTask &&
                  setDismissedCandidates((x) => [...x, candidateTask.id])
                }
                onConfirm={confirmPrototype}
              />
            )}
            {(stage === "prd" || stage === "review") && prdVersion && (
              <PrdArtifact
                workspace={workspace}
                requirementId={requirementId}
                prdVersion={prdVersion}
                reviewVersion={reviewVersion}
                model={model}
                effort={effort}
                roles={reviewRoles}
                onSend={send}
                onRefresh={onRefresh}
                run={run}
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function StageChip({ stage }: { stage: Stage }) {
  const labels: Record<Stage, string> = {
    requirement: "需求澄清",
    prototype: "原型迭代",
    prd: "PRD",
    review: "评审",
  };
  return (
    <span className="stage-chip">
      <CircleDot size={12} />
      {labels[stage]}
    </span>
  );
}

function Conversation({ messages, tasks }: any) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(
    () => end.current?.scrollIntoView({ behavior: "smooth" }),
    [messages.length, tasks?.at(-1)?.status],
  );
  const active = tasks?.find((t: any) =>
    ["queued", "running"].includes(t.status),
  );
  return (
    <div className="conversation">
      {messages.length === 0 && (
        <div className="chat-empty">
          <Bot size={20} />
          <b>先把需求说出来</b>
          <span>项目资料由系统自动检索；能自己查到的事实不会反过来问你。</span>
        </div>
      )}
      {messages.map((m: any) => (
        <div key={m.id} className={`message ${m.role}`}>
          {m.role === "assistant" && (
            <div className="avatar">
              <Sparkles size={13} />
            </div>
          )}
          <div className="bubble">
            <pre>{m.content}</pre>
          </div>
        </div>
      ))}
      {active && (
        <div className="thinking">
          <LoaderCircle size={14} className="spin" />
          {active.events?.at(-1)?.text || "Codex 正在处理…"}
        </div>
      )}
      <div ref={end} />
    </div>
  );
}

function Composer({
  value,
  onChange,
  onSend,
  disabled,
  model,
  effort,
  fixedCount = 0,
  onModelChange,
  onEffortChange,
}: any) {
  return (
    <div className="composer">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="输入需求、回答问题或继续修改…"
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            !e.shiftKey &&
            !e.nativeEvent.isComposing
          ) {
            e.preventDefault();
            onSend();
          }
        }}
      />
      <div className="composer-footer">
        <div className="composer-meta composer-controls">
          <input
            aria-label="本次模型"
            className="inline-model"
            value={model}
            onChange={(e) => onModelChange?.(e.target.value)}
          />
          <select
            aria-label="本次思考深度"
            value={effort}
            onChange={(e) => onEffortChange?.(e.target.value)}
          >
            {EFFORTS.map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
          {fixedCount > 0 && <span>重点资料 {fixedCount}</span>}
        </div>
        <button
          className="send-button"
          disabled={disabled || !value.trim()}
          onClick={onSend}
        >
          {disabled ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <ArrowRight size={17} />
          )}
        </button>
      </div>
    </div>
  );
}

function RequirementArtifact({
  version,
  confirmed,
  onConfirm,
  requirementId,
  onRefresh,
  run,
}: any) {
  const [content, setContent] = useState(version.content);
  useEffect(() => setContent(version.content), [version.id]);
  const dirty = content !== version.content;
  const save = () =>
    run(async () => {
      await api(`/requirements/${requirementId}/versions`, "POST", {
        kind: "requirement",
        content,
        base: version.id,
        metadata: version.metadata || {},
      });
      await onRefresh();
    }, "需求卡已保存");
  return (
    <ArtifactShell
      title="需求卡"
      subtitle={`v${version.number}`}
      actions={
        <>
          {dirty && (
            <button className="ghost" onClick={save}>
              保存修改
            </button>
          )}
          {!confirmed && (
            <button className="primary" onClick={onConfirm}>
              <Check size={15} /> 确认需求
            </button>
          )}
        </>
      }
    >
      <textarea
        className="doc-editor"
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
    </ArtifactShell>
  );
}

function PrototypeArtifact({
  version,
  confirmed,
  iframeRef,
  selectionMode,
  setSelectionMode,
  candidateTask,
  applyCandidate,
  discardCandidate,
  onConfirm,
}: any) {
  const html = candidateTask?.candidate?.content || version.content;
  return (
    <ArtifactShell
      title="交互原型"
      subtitle={`v${version.number}${candidateTask ? " · 修改候选" : ""}`}
      actions={
        <>
          <button
            className={selectionMode ? "tool active" : "tool"}
            onClick={() => setSelectionMode(!selectionMode)}
          >
            <SquareMousePointer size={15} /> 点选修改
          </button>
          <button
            className="ghost"
            onClick={() =>
              downloadText(
                `prototype-v${version.number}.html`,
                version.content,
                "text/html",
              )
            }
          >
            <Download size={15} /> HTML
          </button>
          {!confirmed && !candidateTask && (
            <button className="primary" onClick={onConfirm}>
              <Check size={15} /> 确认原型
            </button>
          )}
        </>
      }
    >
      {candidateTask && (
        <div className="candidate-bar">
          <span>
            <WandSparkles size={15} /> AI 修改候选，仅预览，正式原型还未改变。
          </span>
          <div>
            <button className="ghost" onClick={discardCandidate}>
              放弃
            </button>
            <button className="primary" onClick={applyCandidate}>
              应用修改
            </button>
          </div>
        </div>
      )}
      {selectionMode && (
        <div className="selection-tip">
          点击原型中的具体元素，再在左侧输入修改要求。
        </div>
      )}
      <iframe
        ref={iframeRef}
        className="prototype-frame"
        title="交互原型"
        srcDoc={withInspector(html)}
        sandbox="allow-scripts"
      />
    </ArtifactShell>
  );
}

function PrdArtifact({
  workspace,
  requirementId,
  prdVersion,
  reviewVersion,
  model,
  effort,
  roles,
  onSend,
  onRefresh,
  run,
}: any) {
  const [content, setContent] = useState(prdVersion.content);
  const [tab, setTab] = useState<"prd" | "review" | "showme">("prd");
  const briefKey = `prd-showme:${requirementId}`;
  const legacyBrief = safeJson<any>(localStorage.getItem(briefKey), null);
  const initialBriefs: ReviewBrief[] = Array.isArray(legacyBrief)
    ? legacyBrief
    : legacyBrief?.html
      ? [{ ...legacyBrief, id: legacyBrief.id || crypto.randomUUID(), number: 1 }]
      : [];
  const [briefs, setBriefs] = useState<ReviewBrief[]>(initialBriefs);
  const [briefId, setBriefId] = useState("");
  useEffect(() => setContent(prdVersion.content), [prdVersion.id]);
  const req = workspace.requirement;
  const dirty = content !== prdVersion.content;
  const resolutions = workspace.resolutions || [];
  const currentBriefs = briefs.filter((x) => x.prdVersionId === prdVersion.id);
  const currentBrief =
    currentBriefs.find((x) => x.id === briefId) || currentBriefs.at(-1);

  const saveBriefs = (next: ReviewBrief[]) => {
    setBriefs(next);
    localStorage.setItem(briefKey, JSON.stringify(next));
  };
  const savePrd = () =>
    run(async () => {
      await api(`/requirements/${requirementId}/versions`, "POST", {
        kind: "prd",
        content,
        base: prdVersion.id,
        metadata: prdVersion.metadata || {},
      });
      await onRefresh();
    }, "PRD 已保存");
  const startReview = () =>
    run(async () => {
      const marker = `REVIEW_ROLES_JSON:${JSON.stringify(roles || DEFAULT_ROLES)}`;
      await api(`/requirements/${requirementId}/chat`, "POST", {
        prompt: `${marker}\n对当前 PRD 开始多 Agent 独立评审，所有评审只提出问题，不直接修改 PRD。`,
        stage: "review",
        action: "generate",
        referenceIds: [],
        executor: "codex",
        model,
        reasoningEffort: effort,
      });
      setTab("review");
    }, "评审已开始");
  const decide = (issueId: string, decision: string) =>
    run(async () => {
      await api(`/reviews/${reviewVersion.id}/resolve`, "POST", {
        issueId,
        decision,
      });
      await onRefresh();
    }, "评审决策已记录");
  const applyAccepted = async () => {
    const accepted =
      reviewVersion?.metadata?.issues?.filter((issue: any) =>
        resolutions.some(
          (r: any) =>
            r.reviewId === reviewVersion.id &&
            r.issueId === issue.id &&
            r.decision === "采纳",
        ),
      ) || [];
    if (!accepted.length) return;
    await onSend(
      `根据以下已经由用户明确采纳的评审建议统一修改当前 PRD。不要擅自采纳其他问题。\n${accepted
        .map(
          (x: any, i: number) =>
            `${i + 1}. ${x.description}\n建议：${x.suggestion}`,
        )
        .join("\n")}`,
      "prd",
      "discuss",
    );
    setTab("prd");
  };
  const finalize = () =>
    run(async () => {
      await api(`/requirements/${requirementId}/finalize`, "POST", {
        versionId: prdVersion.id,
      });
    }, reviewVersion ? "终稿已确认" : "已跳过 AI 评审并确认终稿");

  const generateShowme = async () => {
    const before = workspace.messages.length;
    await run(async () => {
      await api(`/requirements/${requirementId}/chat`, "POST", {
        prompt: `基于当前 PRD 生成一份用于产品需求评审会议的自包含 HTML。它不是研发 PRD 的复制版，而是帮助人快速理解需求的讲解材料。参考 Show Me 原则：只保留最能讲清楚的视图；优先使用流程结构、状态对比、关键规则、异常边界、评审关注点；视觉简洁、信息密度高、桌面端可直接演示。必须只返回完整 <!doctype html>... </html>，不要 Markdown 代码围栏。当前 PRD：\n${prdVersion.content}`,
        stage: "prd",
        action: "discuss",
        chatOnly: true,
        referenceIds: [],
        executor: "codex",
        model,
        reasoningEffort: effort,
      });
      for (let i = 0; i < 90; i++) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        const next = await api(`/requirements/${requirementId}`);
        const latest = (next.messages || [])
          .slice(before)
          .reverse()
          .find(
            (m: any) =>
              m.role === "assistant" && /<html[\s>]/i.test(m.content),
          );
        if (latest) {
          const match =
            latest.content.match(/<!doctype html>[\s\S]*<\/html>/i) ||
            latest.content.match(/<html[\s\S]*<\/html>/i);
          if (match) {
            const item: ReviewBrief = {
              id: crypto.randomUUID(),
              number: currentBriefs.length + 1,
              prdVersionId: prdVersion.id,
              html: match[0],
              createdAt: new Date().toISOString(),
            };
            saveBriefs([...briefs, item]);
            setBriefId(item.id);
            setTab("showme");
            return;
          }
        }
        if (
          !next.tasks?.some((t: any) =>
            ["queued", "running"].includes(t.status),
          )
        )
          break;
      }
      throw new Error("评审讲解 HTML 未生成，请重试");
    }, "评审讲解已生成");
  };

  return (
    <ArtifactShell
      title="PRD"
      subtitle={`v${prdVersion.number}${req.stale ? " · 待同步" : ""}`}
      actions={
        <>
          <button
            className="ghost"
            onClick={() =>
              downloadText(
                `prd-v${prdVersion.number}.md`,
                prdVersion.content,
                "text/markdown",
              )
            }
          >
            <Download size={15} /> Markdown
          </button>
          {!req.finalVersion && (
            <button className="primary" onClick={finalize}>
              <Check size={15} />
              {reviewVersion ? "确认终稿" : "跳过评审并确认终稿"}
            </button>
          )}
        </>
      }
    >
      <div className="artifact-tabs">
        <button
          className={tab === "prd" ? "active" : ""}
          onClick={() => setTab("prd")}
        >
          PRD
        </button>
        <button
          className={tab === "review" ? "active" : ""}
          onClick={() => setTab("review")}
        >
          AI 评审
          {reviewVersion ? ` · ${reviewVersion.metadata?.issues?.length || 0}` : ""}
        </button>
        <button
          className={tab === "showme" ? "active" : ""}
          onClick={() => setTab("showme")}
        >
          评审讲解
        </button>
      </div>
      {tab === "prd" && (
        <div className="prd-edit-wrap">
          <textarea
            className="doc-editor prd-editor"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          {dirty && (
            <div className="floating-save">
              <button className="primary" onClick={savePrd}>
                保存 PRD
              </button>
            </div>
          )}
        </div>
      )}
      {tab === "review" && (
        <div className="review-panel">
          {!reviewVersion && (
            <div className="empty-state">
              <Bot size={24} />
              <h3>多 Agent 评审是可选的</h3>
              <p>
                默认从多个独立视角检查当前 PRD。角色可以在设置中全局修改。
              </p>
              <button className="primary" onClick={startReview}>
                <Sparkles size={15} /> 开始评审
              </button>
            </div>
          )}
          {reviewVersion && (
            <>
              <div className="review-summary">
                {reviewVersion.metadata?.summary}
              </div>
              {reviewVersion.metadata?.issues?.map((issue: any) => {
                const resolution = resolutions
                  .filter(
                    (r: any) =>
                      r.reviewId === reviewVersion.id &&
                      r.issueId === issue.id,
                  )
                  .at(-1);
                return (
                  <div className="issue-card" key={issue.id}>
                    <div className="issue-head">
                      <b>{issue.description}</b>
                      <span className={`severity ${issue.severity}`}>
                        {issue.severity}
                      </span>
                    </div>
                    <p>{issue.suggestion}</p>
                    <div className="issue-actions">
                      {["采纳", "不采纳", "稍后处理"].map((decision) => (
                        <button
                          key={decision}
                          className={
                            resolution?.decision === decision ? "selected" : ""
                          }
                          onClick={() => decide(issue.id, decision)}
                        >
                          {decision}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              <button
                className="primary apply-review"
                onClick={applyAccepted}
              >
                应用已采纳建议
              </button>
            </>
          )}
        </div>
      )}
      {tab === "showme" && (
        <div className="showme-panel">
          {!currentBrief ? (
            <div className="empty-state">
              <Monitor size={24} />
              <h3>生成需求评审讲解</h3>
              <p>
                基于当前 PRD 生成一份更适合产品评审会议演示的 HTML，不影响 PRD 本身。
              </p>
              <button className="primary" onClick={generateShowme}>
                <WandSparkles size={15} /> 生成评审讲解
              </button>
            </div>
          ) : (
            <>
              <div className="showme-toolbar">
                <select
                  value={currentBrief.id}
                  onChange={(e) => setBriefId(e.target.value)}
                >
                  {currentBriefs.map((brief) => (
                    <option key={brief.id} value={brief.id}>
                      讲解 v{brief.number} · {fmt(brief.createdAt)}
                    </option>
                  ))}
                </select>
                <span>基于 PRD v{prdVersion.number}</span>
                <button
                  className="ghost"
                  onClick={() =>
                    downloadText(
                      `${workspace.requirement.name}-评审讲解-v${currentBrief.number}.html`,
                      currentBrief.html,
                      "text/html",
                    )
                  }
                >
                  <Download size={15} /> 导出 HTML
                </button>
                <button className="ghost" onClick={generateShowme}>
                  <RefreshCcw size={15} /> 生成新版本
                </button>
              </div>
              <iframe
                className="showme-frame"
                srcDoc={currentBrief.html}
                sandbox="allow-scripts"
              />
            </>
          )}
        </div>
      )}
    </ArtifactShell>
  );
}

function ArtifactShell({ title, subtitle, actions, children }: any) {
  return (
    <div className="artifact-shell">
      <header className="artifact-header">
        <div>
          <h3>{title}</h3>
          <span>{subtitle}</span>
        </div>
        <div className="artifact-actions">{actions}</div>
      </header>
      <div className="artifact-body">{children}</div>
    </div>
  );
}

function KnowledgeView({
  project,
  projectId,
  knowledge,
  settings,
  onChanged,
  run,
}: any) {
  const [sources, setSources] = useState<Source[]>(
    project?.defaults?.knowledgeSources || [],
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);

  useEffect(() => {
    setSources(project?.defaults?.knowledgeSources || []);
  }, [projectId, JSON.stringify(project?.defaults?.knowledgeSources || [])]);

  const persist = async (next: Source[]) => {
    setSources(next);
    await api(`/projects/${projectId}`, "PATCH", {
      defaults: {
        ...(project?.defaults || {}),
        knowledgeSources: next,
      },
    });
  };

  const syncSourceCore = async (source: Source, list = sources) => {
    let result: any;
    if (source.type === "directory") {
      const roots = [
        ...new Set([...(settings.authorizedRoots || []), source.location]),
      ];
      await api("/settings", "PATCH", { authorizedRoots: roots });
      result = await api("/knowledge/directory", "POST", {
        projectId,
        path: source.location,
      });
    } else {
      result = await api("/knowledge/feishu", "POST", {
        projectId,
        doc: source.location,
        name: source.name,
      });
    }
    const rows = Array.isArray(result) ? result : [result];
    const changes = rows.filter((x: any) => !x.unchanged).length;
    const next = list.map((x) =>
      x.id === source.id
        ? {
            ...x,
            lastSynced: new Date().toISOString(),
            lastChanges: changes,
            error: "",
          }
        : x,
    );
    await persist(next);
    return next;
  };

  const syncSource = async (source: Source, list = sources) =>
    run(async () => {
      await syncSourceCore(source, list);
    }, "资料源已同步");

  useEffect(() => {
    if (!projectId || sources.length === 0) return;
    const timer = setInterval(() => {
      void (async () => {
        let current = sources;
        for (const source of sources) {
          try {
            current = await syncSourceCore(source, current);
          } catch {
            // Background sync is best-effort; manual sync surfaces the error.
          }
        }
        await onChanged().catch(() => {});
      })();
    }, 10 * 60_000);
    return () => clearInterval(timer);
  }, [
    projectId,
    sources.map((x) => `${x.id}:${x.type}:${x.location}`).join("|"),
  ]);

  const addSource = async (type: Source["type"]) => {
    const location = window.prompt(
      type === "directory" ? "本地文件夹绝对路径" : "飞书文档链接或文档 ID",
    );
    if (!location?.trim()) return;
    const next: Source = {
      id: crypto.randomUUID(),
      type,
      location: location.trim(),
      name:
        type === "directory"
          ? location.trim().split(/[\\/]/).filter(Boolean).at(-1) || "本地文件夹"
          : "飞书文档",
    };
    const list = [...sources, next];
    await persist(list);
    await syncSource(next, list);
  };

  const doSearch = async () => {
    if (!query.trim()) return setResults([]);
    setResults(
      await api(
        `/knowledge/search?projectId=${encodeURIComponent(projectId)}&q=${encodeURIComponent(query)}`,
      ),
    );
  };
  const latestItems = useMemo(() => {
    const map = new Map<string, any>();
    for (const item of knowledge.items || []) {
      const key = `${item.requirementId || "project"}:${item.source}:${item.name}`;
      if (
        !map.has(key) ||
        (map.get(key).version || 0) < (item.version || 0)
      )
        map.set(key, item);
    }
    return [...map.values()].sort((a, b) =>
      (b.createdAt || "").localeCompare(a.createdAt || ""),
    );
  }, [knowledge.items]);

  return (
    <section className="page knowledge-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{project?.name}</p>
          <h1>知识库</h1>
          <p>连接已有资料源。AI 只读检索，不修改源文件。</p>
        </div>
        <div className="header-actions">
          <button className="ghost" onClick={() => addSource("directory")}>
            <FolderOpen size={16} /> 关联本地文件夹
          </button>
          <button className="primary" onClick={() => addSource("feishu")}>
            <ExternalLink size={16} /> 关联飞书文档
          </button>
        </div>
      </header>
      <div className="knowledge-grid">
        <div className="source-column">
          <div className="section-title">
            <b>资料源</b>
            <span>{sources.length}</span>
          </div>
          {sources.length === 0 && (
            <div className="mini-empty">还没有关联资料源。</div>
          )}
          {sources.map((source) => (
            <div className="source-card" key={source.id}>
              <div className="source-icon">
                {source.type === "directory" ? (
                  <Folder size={17} />
                ) : (
                  <FileText size={17} />
                )}
              </div>
              <div className="source-main">
                <b>{source.name}</b>
                <span title={source.location}>{source.location}</span>
                <small>
                  最后同步 {fmt(source.lastSynced)}
                  {source.lastChanges !== undefined
                    ? ` · ${source.lastChanges} 项变化`
                    : ""}
                </small>
              </div>
              <button
                className="icon-button"
                title="立即同步"
                onClick={() => syncSource(source)}
              >
                <RefreshCcw size={14} />
              </button>
              <button
                className="icon-button"
                title="解除资料源，不删除已索引资料"
                onClick={() =>
                  run(async () => {
                    await persist(sources.filter((x) => x.id !== source.id));
                  }, "资料源已解除")
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="knowledge-column">
          <div className="knowledge-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()}
              placeholder="测试 AI 能否找到某条项目规则…"
            />
            <button onClick={doSearch}>搜索</button>
          </div>
          <div className="knowledge-items">
            {(results.length ? results : latestItems).map((item: any) => (
              <KnowledgeItem
                key={item.id}
                item={item}
                matched={results.length > 0}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function KnowledgeItem({ item, matched = false }: any) {
  return (
    <div className="knowledge-item">
      <div>
        <b>{item.name}</b>
        <span>{item.source}</span>
      </div>
      <div className="knowledge-meta">
        <span>v{item.version}</span>
        <span>{item.status}</span>
        {matched && item.score !== undefined && (
          <span>相关度 {Math.round(item.score)}</span>
        )}
      </div>
      {matched && item.matchedChunks?.[0]?.text && (
        <p>{item.matchedChunks[0].text.slice(0, 260)}</p>
      )}
    </div>
  );
}

function SettingsView({
  data,
  status,
  setStatus,
  model,
  effort,
  setModel,
  setEffort,
  run,
}: any) {
  const template = data.extensions.find(
    (e: any) =>
      e.type === "template" &&
      (e.builtinKey === "template" ||
        e.release?.manifest?.stages?.includes("prd")),
  );
  const [templateText, setTemplateText] = useState(
    template?.release?.content || "",
  );
  const [roles, setRoles] = useState<Role[]>(
    data.settings?.defaults?.reviewRoles || DEFAULT_ROLES,
  );
  const effectiveModel = model || data.settings.model || "gpt-5.6-terra";
  const effectiveEffort =
    effort || data.settings.reasoningEffort || "medium";

  useEffect(
    () => setTemplateText(template?.release?.content || ""),
    [template?.release?.id],
  );
  useEffect(() => {
    setRoles(data.settings?.defaults?.reviewRoles || DEFAULT_ROLES);
  }, [JSON.stringify(data.settings?.defaults?.reviewRoles || [])]);

  const saveAssistant = () =>
    run(async () => {
      await api("/settings", "PATCH", {
        model: effectiveModel,
        executor: "codex",
        reasoningEffort: effectiveEffort,
      });
    }, "Codex 默认设置已保存");
  const saveTemplate = () =>
    run(async () => {
      if (!template) throw new Error("全局模板不存在");
      await api("/extensions/simple", "POST", {
        name: template.name || "研发执行版",
        type: "template",
        content: templateText,
        stages: ["prd"],
        existingId: template.id,
      });
    }, "全局 PRD 模板已更新");
  const saveRoles = () =>
    run(async () => {
      await api("/settings", "PATCH", {
        defaults: {
          ...(data.settings?.defaults || {}),
          reviewRoles: roles,
        },
      });
    }, "评审角色已保存");

  return (
    <section className="page settings-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">WORKBENCH</p>
          <h1>设置</h1>
          <p>只保留 Codex、全局 PRD 模板和评审角色。</p>
        </div>
      </header>
      <div className="settings-sections">
        <section className="setting-card">
          <div className="setting-title">
            <div>
              <Bot size={18} />
              <div>
                <b>Codex</b>
                <span>使用工作台绑定的 Codex</span>
              </div>
            </div>
            <span className={`status-dot ${status?.codex?.state || ""}`}>
              {status?.codex?.state === "configured" ? "已连接" : "待连接"}
            </span>
          </div>
          <div className="form-grid">
            <label>
              模型 ID
              <input
                value={effectiveModel}
                onChange={(e) => setModel(e.target.value)}
              />
            </label>
            <label>
              思考深度
              <select
                value={effectiveEffort}
                onChange={(e) => setEffort(e.target.value)}
              >
                {EFFORTS.map(([value, text]) => (
                  <option value={value} key={value}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="setting-actions">
            <button
              className="ghost"
              onClick={() => api("/status").then(setStatus)}
            >
              刷新状态
            </button>
            {status?.codex?.state === "configured" ? (
              <button
                className="ghost"
                onClick={() =>
                  run(async () => {
                    await api("/codex/logout", "POST", {});
                    setStatus(await api("/status"));
                  }, "Codex 已退出")
                }
              >
                <LogOut size={15} /> 退出登录
              </button>
            ) : (
              <button
                className="ghost"
                onClick={() =>
                  run(async () => {
                    const login = await api("/codex/login", "POST", {});
                    window.open(
                      login.verificationUri || login.verification_uri,
                      "_blank",
                    );
                    setStatus(await api("/status"));
                  }, "已发起 Codex 登录")
                }
              >
                使用 ChatGPT 登录
              </button>
            )}
            <button className="primary" onClick={saveAssistant}>
              保存
            </button>
          </div>
        </section>

        <section className="setting-card wide">
          <div className="setting-title">
            <div>
              <FileText size={18} />
              <div>
                <b>全局 PRD 模板</b>
                <span>所有项目共用；修改只影响之后生成的 PRD。</span>
              </div>
            </div>
            <button className="primary" onClick={saveTemplate}>
              保存模板
            </button>
          </div>
          <textarea
            className="template-editor"
            value={templateText}
            onChange={(e) => setTemplateText(e.target.value)}
          />
        </section>

        <section className="setting-card wide">
          <div className="setting-title">
            <div>
              <Sparkles size={18} />
              <div>
                <b>多 Agent 评审角色</b>
                <span>默认 3 个，可增加运营、数据、合规等视角。</span>
              </div>
            </div>
            <button className="primary" onClick={saveRoles}>
              保存角色
            </button>
          </div>
          <div className="role-list">
            {roles.map((role, index) => (
              <div className="role-row" key={role.id}>
                <input
                  value={role.name}
                  onChange={(e) =>
                    setRoles(
                      roles.map((x, i) =>
                        i === index ? { ...x, name: e.target.value } : x,
                      ),
                    )
                  }
                />
                <input
                  value={role.focus}
                  onChange={(e) =>
                    setRoles(
                      roles.map((x, i) =>
                        i === index ? { ...x, focus: e.target.value } : x,
                      ),
                    )
                  }
                />
                <button
                  className="icon-button"
                  onClick={() =>
                    setRoles(roles.filter((_, i) => i !== index))
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button
              className="ghost"
              onClick={() =>
                setRoles([
                  ...roles,
                  {
                    id: `role-${Date.now()}`,
                    name: "新角色",
                    focus: "填写该角色重点检查的内容",
                  },
                ])
              }
            >
              <Plus size={15} /> 添加角色
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
