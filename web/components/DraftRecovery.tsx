import React from "react";
export function DraftRecovery({ draft, version }: any) {
  return (
    <>
      {draft.error && (
        <div className="draft-conflict" role="alert">
          {draft.error}
        </div>
      )}
      {draft.recovery.map((item: any) => (
        <section
          className="draft-conflict"
          aria-label="本地草稿恢复"
          key={item.base}
        >
          <div>
            <b>
              {item.base === version.id
                ? "发现未保存草稿"
                : `草稿基于旧版本 v${item.number}，当前为 v${version.number}`}
            </b>
            <p>
              仅保存在此浏览器，不属于正式版本。请先恢复或放弃同版本草稿，再继续编辑。
            </p>
            <details>
              <summary>查看草稿</summary>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  maxHeight: 300,
                  overflow: "auto",
                }}
              >
                {item.content}
              </pre>
            </details>
          </div>
          {item.base === version.id && (
            <button
              className="ghost"
              disabled={draft.dirty}
              onClick={() => draft.restoreRecovery(item)}
            >
              恢复草稿
            </button>
          )}
          <button
            className="ghost"
            onClick={() => draft.discardRecovery(item.base)}
          >
            放弃
          </button>
        </section>
      ))}
    </>
  );
}
