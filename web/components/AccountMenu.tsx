import React, { useEffect, useId, useRef } from "react";
import { ChevronDown, LogIn, LogOut } from "lucide-react";
import { api } from "../api";

export function AccountMenu({
  status,
  setStatus,
  run,
}: {
  status: any;
  setStatus: (status: any) => void;
  run: (fn: () => Promise<void>, ok?: string) => Promise<void>;
}) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const login = status?.codex?.login;
  const connected = status?.codex?.state === "configured";
  const waiting = login?.state === "waiting";
  const failed = login?.state === "failed";
  const label = connected ? "已登录" : waiting ? "登录中" : "登录";

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      api("/status")
        .then(setStatus)
        .catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [waiting, setStatus]);

  function toggle() {
    const node = menu.current;
    const button = trigger.current;
    if (!node || !button) return;
    if (node.matches(":popover-open")) {
      node.hidePopover();
      return;
    }
    node.showPopover();
    const anchor = button.getBoundingClientRect();
    node.style.left = `${Math.max(12, anchor.right - node.offsetWidth)}px`;
    node.style.top = `${Math.min(innerHeight - node.offsetHeight - 12, anchor.bottom + 8)}px`;
  }

  const startLogin = () =>
    run(
      async () => {
        const next = await api("/codex/login", "POST", {});
        setStatus(await api("/status"));
        if (next.login?.url) window.open(next.login.url, "_blank");
      },
      waiting || connected ? "" : "已发起 Codex 登录",
    );

  const signOut = () => {
    if (
      !window.confirm(
        connected ? "将移除网站的独立登录状态。" : "将取消进行中的登录。",
      )
    )
      return;
    run(
      async () => {
        await api("/codex/logout", "POST", {});
        setStatus(await api("/status"));
      },
      connected ? "Codex 已退出" : "已取消登录",
    );
  };

  return (
    <div className="account-menu">
      <button
        ref={trigger}
        type="button"
        className="account-trigger"
        aria-label={label}
        aria-haspopup="dialog"
        aria-controls={id}
        onClick={toggle}
      >
        <LogIn size={14} />
        <span>{label}</span>
        <ChevronDown size={13} />
      </button>
      <div
        id={id}
        ref={menu}
        popover="auto"
        role="dialog"
        aria-label="ChatGPT 登录"
        className="list-popover account-popover"
      >
        <div className="list-popover-label">ChatGPT</div>
        <div className="list-popover-heading">
          {connected ? "已连接 Codex" : "订阅登录"}
        </div>
        <p className="account-detail">
          {connected
            ? status?.codex?.detail || "订阅登录已就绪。"
            : login?.detail ||
              status?.codex?.detail ||
              "使用 ChatGPT 订阅账号登录 Codex。"}
        </p>
        {waiting && login?.url && (
          <a
            className="account-link"
            href={login.url}
            target="_blank"
            rel="noreferrer"
          >
            打开官方登录页面
          </a>
        )}
        {waiting && login?.code && (
          <p className="account-code">
            一次性代码 <strong>{login.code}</strong>
          </p>
        )}
        {failed && <p className="account-detail">{login.detail}</p>}
        <div className="account-actions">
          {connected || waiting ? (
            <button type="button" className="ghost" onClick={signOut}>
              <LogOut size={14} />
              {connected ? "退出登录" : "取消登录"}
            </button>
          ) : (
            <button type="button" className="primary" onClick={startLogin}>
              使用 ChatGPT 登录
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
