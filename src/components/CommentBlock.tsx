"use client";
import { useState } from "react";
import type { ArticleView } from "@/lib/digest-data";

// The "💬 我的評論" expandable block — copy-to-clipboard + inline edit + status.
export default function CommentBlock({ article }: { article: ArticleView }) {
  const [comment, setComment] = useState(article.myComment);
  const [status, setStatus] = useState(article.commentStatus);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(article.myComment);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(comment);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function save(nextStatus?: "edited" | "published") {
    setSaving(true);
    const res = await fetch(`/api/comments/${article.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ myComment: draft, commentStatus: nextStatus }),
    });
    setSaving(false);
    if (res.ok) {
      setComment(draft);
      if (nextStatus) setStatus(nextStatus);
      setEditing(false);
    }
  }

  const lintFail = article.lintReport && !article.lintReport.ok;

  return (
    <details className="mycomment">
      <summary>
        💬 我的評論（點擊展開）
        <span className={`badge ${status}`}>
          {status === "draft" ? "草稿" : status === "edited" ? "已編輯" : "已發佈"}
        </span>
        {lintFail ? <span className="badge lintfail">lint 未過</span> : null}
      </summary>

      {editing ? (
        <>
          <textarea
            rows={16}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{ marginTop: 10 }}
          />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" disabled={saving} onClick={() => save("edited")}>
              {saving ? "儲存中…" : "儲存"}
            </button>
            <button
              className="btn secondary"
              onClick={() => {
                setDraft(comment);
                setEditing(false);
              }}
            >
              取消
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="post-body">{comment}</div>
          <div className="row">
            <button className="copybtn" onClick={copy}>
              {copied ? "已複製 ✓" : "複製全文"}
            </button>
            <button
              className="editbtn"
              onClick={() => {
                setDraft(comment);
                setEditing(true);
              }}
            >
              編輯
            </button>
            <button
              className="editbtn"
              disabled={saving || status === "published"}
              onClick={() => save("published")}
            >
              標記為已發佈
            </button>
          </div>
          {article.lintReport ? (
            <ul className="lint-list">
              {article.lintReport.checks.map((c) => (
                <li key={c.id} className={c.pass ? "ok" : "bad"}>
                  {c.pass ? "✓" : "✗"} {c.label}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </details>
  );
}
