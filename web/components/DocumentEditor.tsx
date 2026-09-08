import { ResizeHandle } from "./ResizeHandle";
import React, { useRef, useState } from "react";
import { api } from "../api";

// Render text as React nodes; source HTML and unsafe links never execute.
function Inline({ text, references = [] }: any) {
  return (
    <>
      {String(text)
        .split(/(\[K\d+\]|\*\*[^*]+\*\*|`[^`]+`)/g)
        .map((part, i) => {
          if (/^\[K\d+\]$/.test(part)) {
            const ref = references.find(
              (r: any) => `[${r.citationId}]` === part,
            );
            return <Citation key={i} label={part} reference={ref} />;
          }
          if (part.startsWith("**"))
            return <strong key={i}>{part.slice(2, -2)}</strong>;
          if (part.startsWith("`"))
            return <code key={i}>{part.slice(1, -1)}</code>;
          return part;
        })}
    </>
  );
}
function Citation({ label, reference }: any) {
  const [preview, setPreview] = useState("");
  const [loaded, setLoaded] = useState(false);
  const read = () => {
    if (loaded || !reference) return;
    setLoaded(true);
    if (reference.content) {
      setPreview(reference.content.slice(0, 500));
      return;
    }
    if (reference.knowledgeId)
      api(`/knowledge/${reference.knowledgeId}/document`)
        .then((data) => {
          const start = reference.heading
            ? data.text.indexOf(reference.heading)
            : 0;
          setPreview(
            data.text.slice(Math.max(0, start), Math.max(0, start) + 500) ||
              "此版本无文本预览",
          );
        })
        .catch(() => setPreview("无法读取该引用版本"));
  };
  return (
    <span className="citation" tabIndex={0} onMouseEnter={read} onFocus={read}>
      {label}
      <span role="tooltip">
        <b>{reference?.title || "此版本没有可追溯的引用"}</b>
        {reference && (
          <>
            <small>
              {reference.sourceType} · revision{" "}
              {reference.sourceRevision ?? "—"} · {reference.heading}
            </small>
            <small>{reference.sourceUrl || reference.sourcePath}</small>
            <p>{preview || "正在读取所引用版本…"}</p>
          </>
        )}
      </span>
    </span>
  );
}
export function MarkdownDocument({ content, references = [] }: any) {
  let fence = false;
  const lines = String(content).split("\n");
  const consumed = new Set<number>();
  return (
    <article className="markdown-document">
      {lines.map((line, i) => {
        if (consumed.has(i)) return null;
        if (
          !fence &&
          line.includes("|") &&
          /^\s*\|?\s*:?-{3}/.test(lines[i + 1] || "")
        ) {
          const cells = (row: string) =>
            row
              .trim()
              .replace(/^\||\|$/g, "")
              .split("|")
              .map((x) => x.trim());
          consumed.add(i + 1);
          const rows: string[][] = [];
          let next = i + 2;
          while (
            next < lines.length &&
            lines[next].includes("|") &&
            lines[next].trim()
          ) {
            rows.push(cells(lines[next]));
            consumed.add(next++);
          }
          return (
            <div className="doc-table-wrap" key={i}>
              <table>
                <thead>
                  <tr>
                    {cells(line).map((v, j) => (
                      <th key={j}>
                        <Inline text={v} references={references} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, j) => (
                    <tr key={j}>
                      {row.map((v, k) => (
                        <td key={k}>
                          <Inline text={v} references={references} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (!fence && /^>\s/.test(line))
          return (
            <blockquote key={i}>
              <Inline text={line.slice(2)} references={references} />
            </blockquote>
          );

        if (line.startsWith("```")) {
          fence = !fence;
          return (
            <div className="code-fence" key={i}>
              {line}
            </div>
          );
        }
        if (fence) return <pre key={i}>{line || " "}</pre>;
        const heading = line.match(/^(#{1,6})\s+(.*)/);
        if (heading)
          return React.createElement(
            `h${heading[1].length}`,
            { id: `section-${i}`, key: i },
            <Inline text={heading[2]} references={references} />,
          );
        if (/^\s*[-*]\s+/.test(line))
          return (
            <div className="doc-list-line" key={i}>
              •{" "}
              <Inline
                text={line.replace(/^\s*[-*]\s+/, "")}
                references={references}
              />
            </div>
          );
        if (!line.trim()) return <div className="doc-space" key={i} />;
        return (
          <p key={i}>
            <Inline text={line} references={references} />
          </p>
        );
      })}
    </article>
  );
}
export function DocumentEditor({
  content,
  onChange,
  label,
  dirty,
  references,
  previous,
  initialMode = "read",
  recoveryPending = false,
}: any) {
  const [mode, setMode] = useState(initialMode);
  const editor = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const headings = String(content)
    .split("\n")
    .flatMap((line, index) => {
      const m = line.match(/^(#{1,6})\s+(.*)/);
      return m ? [{ title: m[2], depth: m[1].length, index }] : [];
    });
  const beforeLines = new Set(String(previous?.content || "").split("\n"));
  const changed = String(content)
    .split("\n")
    .filter((line) => line.trim() && !beforeLines.has(line));
  const navigate = (index: number) => {
    root.current
      ?.querySelector(`#section-${index}`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
    if (mode === "edit") {
      const offset =
        content.split("\n").slice(0, index).join("\n").length + (index ? 1 : 0);
      editor.current?.focus();
      editor.current?.setSelectionRange(offset, offset);
    }
  };
  return (
    <div className="document-workspace" ref={root}>
      <div className="document-toolbar">
        <div className="segmented" aria-label="文档显示方式">
          {[
            ["read", "阅读"],
            ["edit", "编辑"],
            ["split", "对照"],
          ].map(([id, title]) => (
            <button
              key={id}
              className={mode === id ? "active" : ""}
              onClick={() => setMode(id)}
            >
              {title}
            </button>
          ))}
        </div>
        <span role="status">
          {dirty ? "有未保存的修改" : "已保存"} ·{" "}
          {content.length.toLocaleString()} 字符
        </span>
        {previous && (
          <details className="changes-pop">
            <summary>与 v{previous.number} 比较</summary>
            <div>
              <b>{changed.length} 行新增或修改</b>
              <p>
                上版 {previous.content.length} → 当前 {content.length} 字符
              </p>
              {changed.slice(0, 60).map((line: string, i: number) => (
                <p className="added-line" key={i}>
                  + {line}
                </p>
              ))}
              {changed.length > 60 && (
                <p>仅显示前 60 行，请结合历史版本核对。</p>
              )}
            </div>
          </details>
        )}
      </div>
      <div className={`document-layout ${mode}`}>
        <ResizeHandle
          name="大纲与正文分栏"
          target=".document-outline"
          variable="--outline-width"
          min={100}
          reserve={280}
        />
        {mode === "split" && (
          <ResizeHandle
            name="编辑与预览分栏"
            target=".doc-editor"
            variable="--editor-width"
            min={150}
            reserve={350}
          />
        )}
        <nav className="document-outline" aria-label="文档大纲">
          <small>文档大纲</small>
          {headings.map((h) => (
            <button
              key={h.index}
              style={{ paddingLeft: 10 + Math.min(h.depth - 1, 3) * 8 }}
              onClick={() => navigate(h.index)}
              title={h.title}
            >
              {h.title}
            </button>
          ))}
          {!headings.length && <span>添加 Markdown 标题后显示大纲</span>}
        </nav>
        {mode !== "read" && (
          <textarea
            ref={editor}
            aria-label={label}
            className="doc-editor"
            readOnly={recoveryPending}
            value={content}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
          />
        )}
        {mode !== "edit" && (
          <div className="document-preview">
            <MarkdownDocument content={content} references={references} />
          </div>
        )}
      </div>
    </div>
  );
}
