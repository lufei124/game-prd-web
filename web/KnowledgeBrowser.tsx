import React from "react";
import { Folder, FileText, Plus, Trash2, Download, Upload } from "lucide-react";
import { api } from "./api";
export function folderPath(id: string | null, folders: any[]): string {
  const seen = new Set<string>(),
    names: string[] = [];
  while (id && !seen.has(id)) {
    seen.add(id);
    const f = folders.find((x) => x.id === id);
    if (!f) break;
    names.unshift(f.name);
    id = f.parentId;
  }
  return "/" + names.join("/");
}
export function KnowledgeBrowser({
  projectId,
  data,
  folderId,
  setFolderId,
  open,
  run,
  upload,
}: any) {
  const [query, setQuery] = React.useState("");
  const folders = data.folders || [],
    items = data.items.filter((k: any) => !k.requirementId);
  const folderField = {
    name: "folderId",
    label: "目录",
    type: "select",
    value: folderId || "",
    options: [
      { value: "", label: "根目录" },
      ...folders.map((f: any) => ({
        value: f.id,
        label: folderPath(f.id, folders),
      })),
    ],
  };
  const send = (path: string, v: any) =>
    api(path, "POST", { ...v, projectId, folderId: v.folderId || null });
  const remove = (name: string, path: string) =>
    open({
      title: "删除" + name,
      description:
        "将移除目录或文件及需求中的引用。历史任务冻结的资料仍保留，此操作不会改写已有成果。",
      submit: "确认删除",
      fields: [],
      action: () => api(path, "DELETE", {}),
    });
  function branch(parentId: string | null, depth = 0): React.ReactNode {
    return folders
      .filter((f: any) => f.parentId === parentId)
      .map((f: any) => (
        <React.Fragment key={f.id}>
          <button
            className={folderId === f.id ? "active" : ""}
            style={{ paddingLeft: 12 + depth * 14 }}
            onClick={() => setFolderId(f.id)}
          >
            <Folder size={15} />
            {f.name}
          </button>
          {branch(f.id, depth + 1)}
        </React.Fragment>
      ));
  }
  return (
    <div className="page knowledge-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">PROJECT FILES</p>
          <h1>知识库</h1>
          <p>按目录整理文件，在需求资料或对话中引用。</p>
        </div>
        <button disabled={!projectId} className="primary" onClick={upload}>
          <Upload size={16} />
          添加资料
        </button>
      </div>
      {!projectId ? (
        <p>请先创建或选择项目。</p>
      ) : (
        <>
          <div className="list-toolbar">
            <input
              aria-label="搜索知识文件"
              placeholder="搜索文件名或内容"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div>
              <button
                onClick={() =>
                  open({
                    title: "新建目录",
                    fields: [
                      { name: "name", label: "目录名称", required: true },
                      { ...folderField, name: "parentId", label: "上级目录" },
                    ],
                    action: (v: any) =>
                      api("/knowledge/folders", "POST", {
                        projectId,
                        name: v.name,
                        parentId: v.parentId || null,
                      }),
                  })
                }
              >
                <Plus size={15} />
                新建目录
              </button>
              <button
                onClick={() =>
                  open({
                    title: "添加文本知识",
                    fields: [
                      { name: "name", label: "资料名称", required: true },
                      folderField,
                      {
                        name: "content",
                        label: "内容",
                        type: "textarea",
                        required: true,
                      },
                    ],
                    action: (v: any) => send("/knowledge/text", v),
                  })
                }
              >
                文本
              </button>
              <button
                onClick={() =>
                  open({
                    title: "导入知识目录",
                    description: "先在设置授权本地目录；导入保留子目录层级。",
                    fields: [
                      {
                        name: "path",
                        label: "本地目录绝对路径",
                        required: true,
                      },
                      folderField,
                    ],
                    action: (v: any) => send("/knowledge/directory", v),
                  })
                }
              >
                导入目录
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
                      folderField,
                    ],
                    action: (v: any) => send("/knowledge/feishu", v),
                  })
                }
              >
                飞书
              </button>
            </div>
          </div>
          <div className="knowledge-explorer">
            <nav aria-label="知识库目录">
              <button
                className={!folderId ? "active" : ""}
                onClick={() => setFolderId(null)}
              >
                <Folder size={15} />
                根目录
              </button>
              {branch(null)}
            </nav>
            <section>
              <div className="knowledge-location">
                <b>{folderPath(folderId, folders)}</b>
                <span>{items.length} 个文件</span>
                {folderId && (
                  <button
                    onClick={() =>
                      remove("目录", "/knowledge/folders/" + folderId)
                    }
                  >
                    删除目录
                  </button>
                )}
              </div>
              {!query &&
                folders
                  .filter((f: any) => f.parentId === (folderId || null))
                  .map((f: any) => (
                    <div className="knowledge-file" key={f.id}>
                      <button onClick={() => setFolderId(f.id)}>
                        <Folder size={19} />
                        <b>{f.name}</b>
                      </button>
                      <span>目录</span>
                      <button
                        aria-label={"删除目录 " + f.name}
                        onClick={() =>
                          remove("目录", "/knowledge/folders/" + f.id)
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
              {items
                .filter((k: any) =>
                  query
                    ? (k.name + " " + k.text)
                        .toLowerCase()
                        .includes(query.toLowerCase())
                    : (k.folderId || null) === (folderId || null),
                )
                .map((k: any) => (
                  <div className="knowledge-file" key={k.id}>
                    <button
                      onClick={() =>
                        open({
                          title: k.name,
                          description: `来源：${k.source} · v${k.version}`,
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
                      <FileText size={19} />
                      <span>
                        <b>{k.name}</b>
                        <small>
                          {folderPath(k.folderId, folders)} · v{k.version}
                        </small>
                      </span>
                    </button>
                    <span title={k.error}>
                      {(
                        {
                          parsed: "已解析",
                          image: "图片参考",
                          failed: "解析失败",
                          unparsed: "未解析",
                        } as any
                      )[k.status] || k.status}
                    </span>
                    <div>
                      <a
                        className="button icon"
                        href={"/api/knowledge/" + k.id + "/file"}
                        title="下载原文件"
                      >
                        <Download size={15} />
                      </a>
                      <button
                        onClick={() =>
                          open({
                            title: "移动文件",
                            fields: [
                              { ...folderField, value: k.folderId || "" },
                            ],
                            action: (v: any) =>
                              api("/knowledge/" + k.id, "PATCH", {
                                folderId: v.folderId || null,
                              }),
                          })
                        }
                      >
                        移动
                      </button>
                      <button
                        aria-label={"删除文件 " + k.name}
                        onClick={() => remove("文件", "/knowledge/" + k.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              {!items.some((k: any) =>
                query
                  ? (k.name + " " + k.text).includes(query)
                  : (k.folderId || null) === (folderId || null),
              ) && (
                <p className="knowledge-empty">
                  此目录没有文件，可新增文本或上传资料。
                </p>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
