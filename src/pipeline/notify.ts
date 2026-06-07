import { env } from "../lib/env";

// Optional post-run notification (SPEC §6 — leave a hook). Uses Resend's REST
// API when RESEND_API_KEY is set; otherwise it's a no-op that logs.
export async function notifyDigestReady(opts: {
  date: string;
  edition: number;
  count: number;
  digestId: string;
  failures: number;
}): Promise<void> {
  const { date, edition, count, digestId, failures } = opts;
  const link = `${env.appBaseUrl}/`;
  const subject = `📰 內容摘要日報 ${date} 第 ${edition} 期已產出（${count} 篇）`;
  const body =
    `今日日報已完成：${count} 篇` +
    (failures ? `，其中 ${failures} 篇未通過風格 lint（已標記）。` : "。") +
    `\n\n查看：${link}\nDigest ID：${digestId}`;

  if (!env.resendKey || !env.notifyEmail) {
    console.log(`[notify] (skipped — no RESEND_API_KEY) ${subject}`);
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "gipi-digest <onboarding@resend.dev>",
        to: [env.notifyEmail],
        subject,
        text: body,
      }),
    });
    if (!res.ok) console.error(`[notify] Resend failed (${res.status}):`, await res.text());
  } catch (err) {
    console.error("[notify] email error:", err);
  }
}
