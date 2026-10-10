// Follow-up cloud probe: the YC video came back as an Arabic-only transcript
// (likely YouTube auto-dubbing). Check whether lang=en fixes it, and whether a
// heavily-dubbed channel (Diary of a CEO) has the same problem. ≤3 credits.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";

const KEY = process.env.SUPADATA_API_KEY;
if (!KEY) throw new Error("SUPADATA_API_KEY missing");
mkdirSync("probe-out", { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path) => {
  const res = await fetch(`https://api.supadata.ai/v1${path}`, {
    headers: { "x-api-key": KEY },
    signal: AbortSignal.timeout(120000),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
};
const used = async () => (await api("/me")).json?.usedCredits ?? null;

async function trial(label, id, lang) {
  const url = `https://www.youtube.com/watch?v=${id}`;
  const before = await used();
  let r = await api(`/transcript?url=${encodeURIComponent(url)}&mode=native${lang ? `&lang=${lang}` : ""}`);
  let result = r.json, polls = 0;
  while (result?.jobId && polls < 120) {
    await sleep(5000);
    polls++;
    const p = await api(`/transcript/${result.jobId}`);
    if (p.json?.status === "completed" || p.json?.status === "failed") result = p.json;
  }
  await sleep(3000);
  const after = await used();
  const chunks = Array.isArray(result?.content) ? result.content : [];
  const text = chunks.map((c) => c.text).join(" ");
  const row = { label, id, lang: lang ?? "(未指定)", status: r.status, gotLang: result?.lang, available: result?.availableLangs, cost: after - before, chars: text.length, sample: text.slice(0, 400) };
  writeFileSync(`probe-out/${label.replace(/\W+/g, "_")}.json`, JSON.stringify({ ...row, content: result?.content ?? result }, null, 1));
  return row;
}

const rows = [];
rows.push(await trial("YC lang=en", "ofxAtQhV-xA", "en"));
const doac = await trial("DOAC 未指定語言", "qDzg-xvkeXw");
rows.push(doac);
if (doac.gotLang && doac.gotLang !== "en") rows.push(await trial("DOAC lang=en", "qDzg-xvkeXw", "en"));

const md = ["## Supadata 語言追測", "", "| 測試 | HTTP | 回傳語言 | 可用語言 | 扣點 | 字數 |", "|---|---|---|---|---|---|"];
for (const r of rows) md.push(`| ${r.label} | ${r.status} | ${r.gotLang ?? "—"} | ${JSON.stringify(r.available ?? [])} | ${r.cost} | ${r.chars} |`);
md.push("");
for (const r of rows) md.push(`**${r.label}** 開頭：`, "", "```", r.sample.replace(/```/g, "'''"), "```", "");
md.push(`本期累計已用：${await used()} 點`);
const out = md.join("\n") + "\n";
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out);
console.log(out);
