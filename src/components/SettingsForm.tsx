"use client";
import { useState } from "react";

// Edits the source-of-truth settings (SPEC §5.7): interest profile md, style
// guide md, and the digest config JSON (ratios / exclusions / queries /
// schedule / search provider).
export default function SettingsForm({
  interestProfile,
  styleGuide,
  digestConfig,
}: {
  interestProfile: string;
  styleGuide: string;
  digestConfig: string;
}) {
  const [profile, setProfile] = useState(interestProfile);
  const [guide, setGuide] = useState(styleGuide);
  const [config, setConfig] = useState(digestConfig);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setMsg("");
    // Validate the config JSON locally before sending.
    try {
      JSON.parse(config);
    } catch {
      setMsg("✗ 設定 JSON 格式錯誤，請修正後再儲存");
      setBusy(false);
      return;
    }
    const res = await fetch("/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        interest_profile: profile,
        style_guide: guide,
        digest_config: config,
      }),
    });
    setBusy(false);
    setMsg(res.ok ? "✓ 已儲存" : "✗ 儲存失敗");
  }

  return (
    <div className="card-pad" style={{ marginTop: 20 }}>
      <label className="field">興趣輪廓（source of truth，Markdown）</label>
      <textarea rows={12} value={profile} onChange={(e) => setProfile(e.target.value)} />

      <label className="field">口吻風格指南（Markdown — 評論生成規則 + 檢核清單）</label>
      <textarea rows={12} value={guide} onChange={(e) => setGuide(e.target.value)} />

      <label className="field">
        日報設定（JSON — 各區篇數配比、排除規則、查詢字串、搜尋來源、排程）
      </label>
      <textarea
        rows={20}
        value={config}
        onChange={(e) => setConfig(e.target.value)}
        style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 13 }}
      />

      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn" onClick={save} disabled={busy}>
          {busy ? "儲存中…" : "儲存設定"}
        </button>
        {msg ? <span className="muted">{msg}</span> : null}
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>
        提示：排程時間在 <code>scheduleCron</code>（預設 <code>0 8 * * *</code>，台北 08:00）；
        搜尋來源在 <code>search.provider</code>（brave / serper / mock）。
      </p>
    </div>
  );
}
