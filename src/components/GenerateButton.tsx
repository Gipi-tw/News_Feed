"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Manual "produce today's digest now" trigger (SPEC §5.6 — cron fallback).
export default function GenerateButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState("");

  async function run() {
    setRunning(true);
    setMsg("產生中…可能需要數分鐘（搜尋 → 選文 → 摘要 → 評論）");
    try {
      const res = await fetch("/api/digest/run", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setMsg(`完成：${data.count} 篇（${data.failures} 篇未過 lint）`);
        router.refresh();
      } else {
        setMsg(`失敗：${data.error ?? res.status}`);
      }
    } catch (e) {
      setMsg(`失敗：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
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
