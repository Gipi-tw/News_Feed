import type { DigestView, VideoView } from "./digest-data";
import type { TierConfig } from "./types";
import { watchUrl } from "../videos/youtube";

// The daily digest as an email: the same five tiers and 🎬 section as the web
// page, laid out for a phone (one column, inline styles only — many mail
// clients drop <style> blocks). Gmail clips messages over ~102 KB, so when the
// full version is too big the videos shrink to one line each; the page still
// has everything.

const INK = "#1c2733";
const MUTED = "#6b7a88";
const LINE = "#e4e9ee";
const LINK = "#1a5fb4";
const COLORS: Record<string, [string, string]> = {
  tier0: ["#1f3a93", "#edf1fb"],
  tier1: ["#c0392b", "#fdf0ee"],
  tier2: ["#b9770e", "#fdf6e8"],
  tier3: ["#1e8449", "#edf7f0"],
  tier4: ["#d35400", "#fdf2e9"],
  tier5: ["#5b4a8b", "#f1eef8"],
};
const VERDICT: Record<string, string> = { full: "值得看全片", segments: "看重點段落就好", skip: "看完摘要就夠" };
const NOT_SUMMARIZED: Record<string, string> = {
  no_transcript: "沒有字幕",
  skipped_budget: "Supadata 額度不足",
  failed: "處理失敗",
};

/** Gmail clips bigger messages behind a "View entire message" link. */
export const CLIP_BYTES = 95_000;

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const mmss = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return (h ? `${h}:${String(m).padStart(2, "0")}` : String(m)) + `:${String(s).padStart(2, "0")}`;
};

const CARD = `background:#fff;border:1px solid ${LINE};border-radius:8px;padding:12px 14px;margin:0 0 10px`;
const META = `font-size:12.5px;color:${MUTED}`;
const P = "margin:6px 0 0";
const LABEL = `font-size:12px;color:${MUTED}`;
const A = `color:${LINK}`;

const heading = (cls: string, text: string, count: string) => {
  const [border, bg] = COLORS[cls] ?? COLORS.tier0;
  return `<h2 style="font-size:16px;margin:28px 0 10px;padding:6px 10px;border-left:4px solid ${border};background:${bg}">${text} <span style="font-size:13px;font-weight:400;color:${MUTED}">${count}</span></h2>`;
};

function articleCard(a: DigestView["articles"][number], n: number): string {
  const url = a.urls[0];
  const title = url ? `<a href="${esc(url)}" style="color:${INK};text-decoration:none">${esc(a.title)}</a>` : esc(a.title);
  return `<div style="${CARD}">
<div style="font-weight:700;font-size:15.5px;line-height:1.5"><span style="color:${MUTED};font-weight:500">${String(n).padStart(2, "0")}</span> ${title}</div>
<div style="${META}">${esc(a.sourceName)} · ${esc(a.sourceDate)}</div>
<p style="${P}"><b style="${LABEL}">事實</b> ${esc(a.factSummary)}</p>
<p style="${P}"><b style="${LABEL}">Hook</b> ${esc(a.opinionHook)}</p>
</div>`;
}

function videoCard(v: VideoView, compact: boolean): string {
  const s = v.summary!;
  const ts = (t: number) => `<a href="${esc(watchUrl(v.id, t))}" style="${A}">${mmss(t)}</a>`;
  const head = `<div style="font-weight:700;font-size:15.5px;line-height:1.5"><a href="${esc(watchUrl(v.id))}" style="color:${INK};text-decoration:none">${esc(v.title)}</a></div>
<div style="${META}">${esc(v.channelName)} · ${mmss(v.durationSec)} · <b style="color:${COLORS.tier5[0]}">${VERDICT[s.verdict] ?? s.verdict}</b></div>
<p style="${P}"><b style="${LABEL}">重點</b> ${esc(s.oneLiner)}</p>`;
  if (compact) return `<div style="${CARD}">${head}</div>`;
  const points = s.keyPoints.length
    ? `<ul style="margin:6px 0 0;padding-left:18px">${s.keyPoints.map((k) => `<li>${ts(k.t)} ${esc(k.point)}</li>`).join("")}</ul>`
    : "";
  const segments = s.segments.length
    ? `<p style="${P}"><b style="${LABEL}">建議看</b> ${s.segments
        .map((g) => `<a href="${esc(watchUrl(v.id, g.from))}" style="${A}">${mmss(g.from)}–${mmss(g.to)}</a> ${esc(g.why)}`)
        .join("<br>")}</p>`
    : "";
  return `<div style="${CARD}">${head}${points}${segments}
<p style="${P}"><b style="${LABEL}">Hook</b> ${esc(s.hook)}</p>
</div>`;
}

export function renderHtml(view: DigestView, tiers: TierConfig[], pageUrl: string, compactVideos: boolean): string {
  let n = 0;
  const sections = tiers
    .map((t) => {
      const list = view.articles.filter((a) => a.tier === t.key).sort((a, b) => a.position - b.position);
      if (!list.length) return "";
      return heading(t.tierClass, `${t.emoji} ${esc(t.label)}`, `${list.length} 篇`) + list.map((a) => articleCard(a, ++n)).join("\n");
    })
    .join("\n");

  const done = view.videos.filter((v) => v.status === "summarized" && v.summary);
  const rest = view.videos.filter((v) => !(v.status === "summarized" && v.summary));
  const videos = view.videos.length
    ? heading("tier5", "🎬 影音重點", `${done.length} 支，不佔 45 篇`) +
      done.map((v) => videoCard(v, compactVideos)).join("\n") +
      (compactVideos ? `<p style="${META}">影片的時間戳重點與建議段落，請到<a href="${esc(pageUrl)}" style="${A}">網站</a>看。</p>` : "") +
      (rest.length
        ? `<p style="${META};margin-top:10px">沒有摘要：${rest
            .map((v) => `<a href="${esc(watchUrl(v.id))}" style="${A}">${esc(v.channelName)}｜${esc(v.title)}</a>（${NOT_SUMMARIZED[v.status] ?? v.status}）`)
            .join("、")}</p>`
        : "")
    : "";

  const notes = view.notes.length
    ? `<p style="margin:0 0 6px"><b>關於篇數</b></p><ul style="margin:0;padding-left:18px">${view.notes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`
    : "";

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>內容摘要日報 ${esc(view.date)}</title></head>
<body style="margin:0;background:#f5f7f9">
<div style="max-width:640px;margin:0 auto;padding:16px;font-family:-apple-system,'PingFang TC','Noto Sans TC','Microsoft JhengHei',sans-serif;font-size:15px;line-height:1.7;color:${INK}">
<h1 style="font-size:20px;margin:0">內容摘要日報</h1>
<div style="${META}">${esc(view.date)} 第 ${view.edition} 期｜${view.articles.length} 篇${done.length ? `｜🎬 ${done.length} 支` : ""}｜<a href="${esc(pageUrl)}" style="${A}">在網站上看</a></div>
${sections}
${videos}
<div style="margin-top:28px;padding-top:12px;border-top:1px solid ${LINE};${META}">${notes}<p style="margin:10px 0 0">gipi-digest 每天 08:00 自動寄出。<a href="${esc(pageUrl)}" style="${A}">網站版</a>可以搜尋與看過去的日報。</p></div>
</div></body></html>`;
}

function renderText(view: DigestView, tiers: TierConfig[], pageUrl: string): string {
  let n = 0;
  const out = [`內容摘要日報 ${view.date} 第 ${view.edition} 期｜${view.articles.length} 篇`, pageUrl, ""];
  for (const t of tiers) {
    const list = view.articles.filter((a) => a.tier === t.key).sort((a, b) => a.position - b.position);
    if (!list.length) continue;
    out.push(`■ ${t.emoji} ${t.label}（${list.length} 篇）`, "");
    for (const a of list) {
      out.push(`${String(++n).padStart(2, "0")} ${a.title}`, `${a.sourceName} · ${a.sourceDate}`, `事實：${a.factSummary}`, `Hook：${a.opinionHook}`);
      if (a.urls[0]) out.push(a.urls[0]);
      out.push("");
    }
  }
  const done = view.videos.filter((v) => v.status === "summarized" && v.summary);
  if (done.length) {
    out.push(`■ 🎬 影音重點（${done.length} 支，不佔 45 篇）`, "");
    for (const v of done) {
      out.push(`${v.title}`, `${v.channelName} · ${mmss(v.durationSec)} · ${VERDICT[v.summary!.verdict] ?? ""}`, `重點：${v.summary!.oneLiner}`, watchUrl(v.id), "");
    }
  }
  if (view.notes.length) out.push("關於篇數", ...view.notes.map((x) => `- ${x}`));
  return out.join("\n");
}

export function digestEmail(
  view: DigestView,
  tiers: TierConfig[],
  pageUrl: string,
): { subject: string; html: string; text: string; compactVideos: boolean } {
  const [, m, d] = view.date.split("-");
  const vids = view.videos.filter((v) => v.status === "summarized" && v.summary).length;
  const subject = `📰 內容摘要日報 ${Number(m)}/${Number(d)}｜${view.articles.length} 篇${vids ? `＋🎬 ${vids} 支` : ""}`;
  let html = renderHtml(view, tiers, pageUrl, false);
  const compactVideos = Buffer.byteLength(html) > CLIP_BYTES;
  if (compactVideos) html = renderHtml(view, tiers, pageUrl, true);
  return { subject, html, text: renderText(view, tiers, pageUrl), compactVideos };
}
