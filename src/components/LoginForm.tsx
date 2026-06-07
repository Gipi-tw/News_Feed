"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    setBusy(false);
    if (res.ok) {
      router.replace(next || "/");
      router.refresh();
    } else {
      setError("帳號或密碼錯誤");
    }
  }

  return (
    <form onSubmit={submit} className="card-pad" style={{ maxWidth: 360, margin: "10vh auto" }}>
      <h1 style={{ marginTop: 0, fontSize: 22 }}>📰 內容摘要日報</h1>
      <p className="muted" style={{ marginTop: -6 }}>請登入</p>
      <label className="field">帳號</label>
      <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
      <label className="field">密碼</label>
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {error ? (
        <p style={{ color: "#c0392b", fontSize: 14, marginBottom: 0 }}>{error}</p>
      ) : null}
      <div style={{ marginTop: 16 }}>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "登入中…" : "登入"}
        </button>
      </div>
    </form>
  );
}
