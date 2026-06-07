"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Manual "produce today's digest now" trigger (SPEC §5.6). Async: starts a
// background run and polls status, so the UI never blocks waiting.
export default function GenerateButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/digest/run", { method: "GET", cache: "no-store" });
      const data = await res.json();
      if (data.status === "running") {
        setRunning(true);
        setMsg(data.message || "產生中…");
      } else if (data.status === "success") {
        setRunning(false);
        setMsg(`完成：${data.message ?? ""}`);
        stopPolling();
        router.refresh();
      } else if (data.status === "failed") {
        setRunning(false);
        setMsg(`失敗：${data.message ?? "未知錯誤"}`);
        stopPolling();
      } else {
        setRunning(false);
        stopPolling();
      }
    } catch {
      /* transient — keep polling */
    }
  }, [router]);

  const startPolling = useCallback(() => {
    stopPolling();
    poll();
    timer.current = setInterval(poll, 4000);
  }, [poll]);

  // On mount, resume tracking if a run is already in progress.
  useEffect(() => {
    poll();
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run() {
    setRunning(true);
    setMsg("啟動中…");
    try {
      await fetch("/api/digest/run", { method: "POST" });
      startPolling();
    } catch (e) {
      setRunning(false);
      setMsg(`失敗：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="row" style={{ marginTop: 8 }}>
      <button className="btn" onClick={run} disabled={running}>
        {running ? "產生中…" : "⚡ 立即產生今日日報"}
      </button>
      {msg ? <span className="muted">{msg}</span> : null}
    </div>
  );
}
