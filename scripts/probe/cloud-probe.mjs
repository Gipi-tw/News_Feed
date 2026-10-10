// One-off cloud probe (runs in GitHub Actions, never locally): checks from a
// datacenter IP whether our planned sources are reachable, and trials Supadata
// on 3 videos to measure credit cost and transcript quality.
//
// Writes ./probe-out/report.json, ./probe-out/<videoId>.json and appends a
// markdown summary to $GITHUB_STEP_SUMMARY. Never prints the API key.
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";

const OUT = "probe-out";
mkdirSync(OUT, { recursive: true });
const KEY = process.env.SUPADATA_API_KEY;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const md = [];
const report = { at: new Date().toISOString(), feeds: [], youtube: {}, supadata: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, opts = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      redirect: opts.redirect ?? "follow",
      headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", ...opts.headers },
      signal: AbortSignal.timeout(opts.timeout ?? 30000),
    });
    const body = opts.noBody ? "" : await res.text();
    return { status: res.status, body, location: res.headers.get("location"), finalUrl: res.url, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 0, body: "", error: String(e?.cause?.code ?? e?.message ?? e), ms: Date.now() - t0 };
  }
}

// ---------- 1. RSS / Google News reachability ----------
const FEEDS = [
  ["woshipm", "https://www.woshipm.com/feed"],
  ["Inside", "https://www.inside.com.tw/feed/rss"],
  ["TechCrunch", "https://techcrunch.com/feed/"],
  ["極客公園", "https://www.geekpark.net/rss"],
  ["Bloomberg Tech", "https://feeds.bloomberg.com/technology/news.rss"],
  ["Wired", "https://www.wired.com/feed/rss"],
  ["Wired Gear", "https://www.wired.com/feed/category/gear/latest/rss"],
  ["Gizmodo", "https://gizmodo.com/rss"],
  ["InfoQ", "https://feed.infoq.com"],
  ["iThome", "https://www.ithome.com.tw/rss"],
  ["Slashdot", "https://rss.slashdot.org/Slashdot/slashdotMain"],
  ["The Verge", "https://www.theverge.com/rss/index.xml"],
  ["Fast Company", "https://www.fastcompany.com/latest/rss"],
  ["HBR (http)", "http://feeds.hbr.org/harvardbusiness"],
  ["Lifehacker", "https://lifehacker.com/feed/rss"],
  ["MIT SMR", "https://sloanreview.mit.edu/feed/"],
  ["TechNews", "https://technews.tw/feed/"],
  ["PsyPost", "https://www.psypost.org/feed/"],
  ["NRN", "https://www.nrn.com/rss.xml"],
];
const gn = (q, lang = "zh-TW") =>
  lang === "zh-TW"
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`
    : `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
const GNEWS = [
  ["GN 數位時代", gn("site:bnext.com.tw when:2d")],
  ["GN 經理人", gn("site:managertoday.com.tw when:2d")],
  ["GN 親子天下", gn("site:parenting.cwgv.com.tw when:2d")],
  ["GN Restaurant Business", gn("site:restaurantbusinessonline.com when:2d", "en")],
  ["GN 企業: Restaurant Brands International", gn('"Restaurant Brands International" when:2d', "en")],
];

function feedStats(xml) {
  const items = (xml.match(/<item[\s>]/g) || []).length + (xml.match(/<(?:\w+:)?entry[\s>]/g) || []).length;
  const dates = [...xml.matchAll(/<(?:pubDate|(?:\w+:)?updated|(?:\w+:)?published|dc:date)>([^<]+)</g)]
    .map((m) => Date.parse(m[1].trim()))
    .filter((d) => !Number.isNaN(d));
  const newest = dates.length ? new Date(Math.max(...dates)).toISOString() : null;
  return { items, newest };
}

md.push("## 1. RSS／Google News（從 GitHub Actions 機房連線）", "", "| 來源 | HTTP | 篇數 | 最新一篇（UTC） | 耗時 |", "|---|---|---|---|---|");
let gnSampleLink = null;
for (const [name, url] of [...FEEDS, ...GNEWS]) {
  const r = await get(url);
  const s = r.status === 200 ? feedStats(r.body) : { items: 0, newest: null };
  report.feeds.push({ name, url, status: r.status, error: r.error, ...s, ms: r.ms });
  md.push(`| ${name} | ${r.status || r.error} | ${s.items} | ${s.newest?.slice(0, 16) ?? "—"} | ${r.ms}ms |`);
  if (!gnSampleLink && name.startsWith("GN") && r.status === 200) {
    gnSampleLink = r.body.match(/<item>[\s\S]*?<link>([^<]+)<\/link>/)?.[1] ?? null;
  }
}
if (gnSampleLink) {
  const r1 = await get(gnSampleLink, { redirect: "manual", noBody: false });
  const r2 = await get(gnSampleLink);
  const hint = r2.body.match(/data-n-a-sg="[^"]+"/) ? "頁面含 data-n-a-sg（需走 batchexecute 解碼）" : "";
  report.googleNewsRedirect = { sample: gnSampleLink, manualStatus: r1.status, location: r1.location, followedTo: r2.finalUrl, hint };
  md.push("", `Google News 轉址：不跟隨時 HTTP ${r1.status}${r1.location ? ` → ${r1.location.slice(0, 80)}` : ""}；跟隨後落在 ${new URL(r2.finalUrl || gnSampleLink).host}。${hint}`);
}

// ---------- 2. YouTube from datacenter ----------
const CHANNELS = [
  ["joerogan", "JRE"],
  ["TheDiaryOfACEO", "Diary of a CEO"],
  ["ycombinator", "Y Combinator"],
  ["timferriss", "Tim Ferriss"],
];
md.push("", "## 2. YouTube（機房 IP）", "", "| 頻道 | @handle→頻道ID | 頻道 RSS | 最新幾支 |", "|---|---|---|---|");
const latest = {};
for (const [handle, label] of CHANNELS) {
  const page = await get(`https://www.youtube.com/@${handle}`);
  const id = page.body.match(/"externalId":"(UC[\w-]+)"/)?.[1] ?? null;
  const consent = /consent\.youtube\.com|before you continue/i.test(page.finalUrl + page.body.slice(0, 5000));
  let feedStatus = "—";
  let vids = [];
  if (id) {
    const f = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`);
    feedStatus = f.status;
    vids = [...f.body.matchAll(/<entry>[\s\S]*?<yt:videoId>([^<]+)<\/yt:videoId>[\s\S]*?<title>([^<]+)<\/title>[\s\S]*?<published>([^<]+)<\/published>/g)].map(
      (m) => ({ id: m[1], title: m[2].replace(/&quot;/g, '"').replace(/&amp;/g, "&"), published: m[3] }),
    );
  }
  latest[label] = vids;
  report.youtube[label] = { handle, pageStatus: page.status, consent, channelId: id, feedStatus, videos: vids.length };
  md.push(`| ${label} | ${page.status}${consent ? "（同意頁）" : ""} → ${id ?? "抓不到"} | ${feedStatus} | ${vids.length} |`);
}

// Shorts detection: /shorts/<id> answers 200 for a Short and redirects (303) for a normal video.
async function isShort(id) {
  const r = await get(`https://www.youtube.com/shorts/${id}`, { redirect: "manual", noBody: true });
  return { short: r.status === 200, status: r.status, location: r.location };
}

// Caption ground truth from the watch page: kind "asr" = YouTube auto-generated.
async function captionTracks(id) {
  const r = await get(`https://www.youtube.com/watch?v=${id}&hl=en`);
  const i = r.body.indexOf('"captionTracks":');
  if (i < 0) {
    const reason = /Sign in to confirm/i.test(r.body) ? "被要求登入（機器人檢查）" : r.status === 200 ? "頁面無 captionTracks" : `HTTP ${r.status}`;
    return { ok: false, reason };
  }
  let depth = 0, j = i + '"captionTracks":'.length, start = j;
  for (; j < r.body.length; j++) {
    if (r.body[j] === "[") depth++;
    else if (r.body[j] === "]" && --depth === 0) break;
  }
  try {
    const tracks = JSON.parse(r.body.slice(start, j + 1));
    return { ok: true, tracks: tracks.map((t) => ({ lang: t.languageCode, kind: t.kind ?? "manual" })) };
  } catch {
    return { ok: false, reason: "captionTracks 解析失敗" };
  }
}

const shortsChecks = [];
async function pick(label, pred = () => true) {
  for (const v of latest[label] ?? []) {
    if (!pred(v)) continue;
    const s = await isShort(v.id);
    shortsChecks.push({ label, id: v.id, title: v.title, ...s });
    if (!s.short) return v;
  }
  return null;
}
const picks = [
  ["JRE", await pick("JRE", (v) => /^Joe Rogan Experience #/.test(v.title))],
  ["Y Combinator", await pick("Y Combinator")],
  ["Tim Ferriss", await pick("Tim Ferriss")],
].filter(([, v]) => v);
report.youtube.shortsChecks = shortsChecks;
md.push("", "Shorts 判斷（/shorts/ 網址：200=Short、303=一般影片）：", "");
for (const s of shortsChecks) md.push(`- ${s.label}｜${s.title.slice(0, 50)}｜HTTP ${s.status} → ${s.short ? "Short，跳過" : "一般影片"}`);

// ---------- 3. Supadata trial ----------
md.push("", "## 3. Supadata 試抓（mode=native）", "");
if (!KEY) {
  md.push("⚠️ 沒有 SUPADATA_API_KEY，略過。");
} else {
  const H = { "x-api-key": KEY };
  const api = async (path) => {
    const res = await fetch(`https://api.supadata.ai/v1${path}`, { headers: H, signal: AbortSignal.timeout(120000) });
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, json };
  };
  const credits = async () => (await api("/me")).json?.usedCredits ?? null;
  const me = await api("/me");
  report.supadata.plan = me.json ? { plan: me.json.plan, maxCredits: me.json.maxCredits, usedCredits: me.json.usedCredits } : { status: me.status };
  md.push(`帳戶：/me HTTP ${me.status}，方案 ${me.json?.plan ?? "?"}，本期已用 ${me.json?.usedCredits ?? "?"} / ${me.json?.maxCredits ?? "?"} 點`, "");
  md.push("| 影片 | 字幕軌（watch 頁） | 首次回應 | 輪詢 | 扣點 | 段數 | 字數 | 片長(估) | 標點密度 | 語言 |", "|---|---|---|---|---|---|---|---|---|---|");
  report.supadata.videos = [];
  for (const [label, v] of picks) {
    const url = `https://www.youtube.com/watch?v=${v.id}`;
    const tracks = await captionTracks(v.id);
    const before = await credits();
    const t0 = Date.now();
    let r = await api(`/transcript?url=${encodeURIComponent(url)}&mode=native`);
    const first = r.status;
    let polls = 0, result = r.json;
    if (result?.jobId) {
      const jobId = result.jobId;
      while (polls < 120) {
        await sleep(5000);
        polls++;
        const p = await api(`/transcript/${jobId}`);
        result = p.json;
        if (result?.status === "completed" || result?.status === "failed") break;
      }
    }
    await sleep(3000); // let the credit counter settle
    const after = await credits();
    const chunks = Array.isArray(result?.content) ? result.content : [];
    const text = chunks.map((c) => c.text).join(" ");
    const last = chunks.at(-1);
    const minutes = last ? Math.round((last.offset + last.duration) / 60000) : null;
    const punct = text.length ? ((text.match(/[.,?!]/g) || []).length / (text.split(/\s+/).length || 1)).toFixed(3) : "—";
    const row = {
      label, id: v.id, title: v.title, published: v.published, tracks,
      firstStatus: first, polls, jobStatus: result?.status ?? null, error: result?.error ?? (first >= 400 || first === 206 ? result : null),
      creditsBefore: before, creditsAfter: after, cost: before != null && after != null ? after - before : null,
      chunks: chunks.length, chars: text.length, minutes, punctPerWord: punct, lang: result?.lang, availableLangs: result?.availableLangs,
      seconds: Math.round((Date.now() - t0) / 1000),
    };
    report.supadata.videos.push(row);
    writeFileSync(`${OUT}/${v.id}.json`, JSON.stringify({ ...row, content: result?.content ?? null }, null, 1));
    const trackStr = tracks.ok ? tracks.tracks.map((t) => `${t.lang}:${t.kind}`).join(", ") || "無" : `查不到（${tracks.reason}）`;
    md.push(`| ${label}｜${v.title.slice(0, 40)} | ${trackStr} | ${first} | ${polls} 次 | ${row.cost ?? "?"} | ${row.chunks} | ${row.chars} | ${minutes ?? "?"} 分 | ${punct} | ${row.lang ?? "—"} |`);
  }
  md.push("");
  for (const v of report.supadata.videos) {
    md.push(`<details><summary>${v.label} 逐字稿開頭 1,200 字</summary>`, "", "```");
    const content = JSON.parse(readFileSync(`${OUT}/${v.id}.json`, "utf8")).content;
    const sample = Array.isArray(content) ? content.map((c) => c.text).join(" ").slice(0, 1200) : String(content ?? "").slice(0, 1200);
    md.push(sample.replace(/```/g, "'''"), "```", "</details>", "");
  }
  report.supadata.finalUsed = await credits();
  md.push(`試抓後本期已用：${report.supadata.finalUsed ?? "?"} 點`);
}

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
const summary = md.join("\n") + "\n";
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);
