import { env } from "../lib/env";
import { getDigestById, getTierMeta } from "../lib/digest-data";
import { digestEmail, esc } from "../lib/digest-email";

// Daily email via Resend's REST API: the whole digest after each run, or a
// short notice when a run fails (so a dead key or empty credit balance doesn't
// go unnoticed for days, as in June and on 10/19–20). A logged no-op until
// RESEND_API_KEY and NOTIFY_EMAIL are set. Without a verified domain, Resend's
// shared sender (onboarding@resend.dev) only delivers to the address the
// Resend account was opened with — so open the account with NOTIFY_EMAIL.

const recipients = () =>
  env.notifyEmail
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** Returns a short status for the run log: sent / skipped… / failed…. */
async function send(subject: string, html: string, text: string): Promise<string> {
  if (!env.resendKey || !recipients().length) return "skipped（沒有設定 RESEND_API_KEY／NOTIFY_EMAIL）";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.notifyFrom, to: recipients(), subject, html, text }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return `failed（Resend ${res.status}：${(await res.text()).slice(0, 160)}）`;
    return "sent";
  } catch (err) {
    return `failed（${(err instanceof Error ? err.message : String(err)).slice(0, 160)}）`;
  }
}

/** Email the finished digest. Never throws. */
export async function sendDigestEmail(digestId: string): Promise<string> {
  try {
    const view = await getDigestById(digestId);
    if (!view) return "failed（找不到這期日報）";
    const page = `${env.appBaseUrl}/digest/${digestId}`;
    const { subject, html, text, compactVideos } = digestEmail(view, await getTierMeta(), page);
    const status = await send(subject, html, text);
    return status === "sent" && compactVideos ? "sent（信太大，影片改精簡版）" : status;
  } catch (err) {
    return `failed（${(err instanceof Error ? err.message : String(err)).slice(0, 160)}）`;
  }
}

/** Tell the reader today's digest didn't come out, and why. Never throws. */
export async function sendFailureEmail(date: string, reason: string): Promise<string> {
  const home = `${env.appBaseUrl}/`;
  const subject = `⚠️ 內容摘要日報 ${date} 產生失敗`;
  const text = `今天的日報沒有產生成功。\n\n原因：${reason}\n\n修好之後，可以到網站首頁按「⚡ 立即產生今日日報」重跑：${home}`;
  const html = `<div style="font-family:sans-serif;font-size:15px;line-height:1.7;color:#1c2733;max-width:640px;padding:16px">
<p>今天的日報沒有產生成功。</p>
<p style="color:#6b7a88">原因：${esc(reason)}</p>
<p>修好之後，可以到<a href="${esc(home)}" style="color:#1a5fb4">網站首頁</a>按「⚡ 立即產生今日日報」重跑。</p>
</div>`;
  return send(subject, html, text);
}
