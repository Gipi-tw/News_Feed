import { MODELS, generateJSON } from "../lib/anthropic";

// One video → a Traditional Chinese brief with timestamped points, so Gipi can
// decide in a minute whether to watch, and where to jump in.
//
// Timestamps are clickable, so they have to be right. The model's own `t` was
// sometimes off by half an hour (10/21: a YC talk's Hugging Face example,
// discussed at 6:09, was linked at 32:10), so every point also quotes a few
// words of the transcript (`anchor`) and the code moves `t` to the line where
// those words actually are.

export interface VideoSummary {
  oneLiner: string;
  keyPoints: { t: number; point: string }[]; // 3–5, t = seconds into the video
  quotes: { t: number; text: string }[]; // data points or memorable lines, 0–3
  hook: string;
  verdict: "full" | "segments" | "skip"; // 值得看全片 / 看重點段落 / 略過也行
  verdictReason: string;
  segments: { from: number; to: number; why: string }[];
}

/** What the model returns: every timestamp carries an `anchor` quote. */
interface RawSummary extends Omit<VideoSummary, "keyPoints" | "quotes" | "segments"> {
  keyPoints: { anchor: string; t: number; point: string }[];
  quotes: { anchor: string; t: number; text: string }[];
  segments: { anchor: string; from: number; to: number; why: string }[];
}

const ANCHOR = { type: "string" } as const;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    oneLiner: { type: "string" },
    keyPoints: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { anchor: ANCHOR, t: { type: "integer" }, point: { type: "string" } },
        required: ["anchor", "t", "point"],
      },
    },
    quotes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { anchor: ANCHOR, t: { type: "integer" }, text: { type: "string" } },
        required: ["anchor", "t", "text"],
      },
    },
    hook: { type: "string" },
    verdict: { type: "string", enum: ["full", "segments", "skip"] },
    verdictReason: { type: "string" },
    segments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { anchor: ANCHOR, from: { type: "integer" }, to: { type: "integer" }, why: { type: "string" } },
        required: ["anchor", "from", "to", "why"],
      },
    },
  },
  required: ["oneLiner", "keyPoints", "quotes", "hook", "verdict", "verdictReason", "segments"],
};

const mmss = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : String(m)) + `:${String(s).padStart(2, "0")}`;
};

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const MIN_ANCHOR = 10; // normalized chars; shorter quotes ("yeah, so") match anywhere

/**
 * Returns a finder for "the start of the transcript line containing these
 * words". Lines are joined so a quote spanning two lines still matches; with
 * several matches, the one nearest the model's own guess wins.
 */
export function anchorLocator(lines: [number, string][]): (anchor: string, guess: number) => number | null {
  const starts: number[] = [];
  let text = "";
  for (const [, s] of lines) {
    starts.push(text.length);
    text += norm(s) + " ";
  }
  const lineAt = (pos: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lines[lo][0];
  };
  return (anchor, guess) => {
    const a = norm(anchor);
    if (a.length < MIN_ANCHOR) return null;
    let best: number | null = null;
    for (let i = text.indexOf(a); i !== -1; i = text.indexOf(a, i + 1)) {
      const t = lineAt(i);
      if (best == null || Math.abs(t - guess) < Math.abs(best - guess)) best = t;
    }
    return best;
  };
}

/**
 * Model output → stored summary: timestamps moved to their anchors (or, when
 * an anchor isn't found, clamped into the video), points and quotes in video
 * order, segments in order with overlaps merged.
 */
export function tidySummary(
  raw: RawSummary,
  lines: [number, string][],
  durationSec: number,
): { summary: VideoSummary; anchored: number; total: number } {
  const locate = anchorLocator(lines);
  const clamp = (t: number) => Math.max(0, Math.min(Math.round(t) || 0, durationSec));
  let anchored = 0;
  let total = 0;
  const fix = (anchor: string, t: number) => {
    total++;
    const found = locate(anchor, t);
    if (found == null) return clamp(t);
    anchored++;
    return found;
  };

  const keyPoints = raw.keyPoints.map((k) => ({ t: fix(k.anchor, k.t), point: k.point })).sort((a, b) => a.t - b.t);
  const quotes = raw.quotes.map((q) => ({ t: fix(q.anchor, q.t), text: q.text })).sort((a, b) => a.t - b.t);
  const moved = raw.segments
    .map((g) => {
      const from = fix(g.anchor, g.from);
      const len = g.to > g.from ? g.to - g.from : 120; // keep the suggested length when `from` moves
      return { from, to: clamp(from + len), why: g.why };
    })
    .filter((g) => g.to > g.from)
    .sort((a, b) => a.from - b.from);
  const segments: VideoSummary["segments"] = [];
  for (const g of moved) {
    const prev = segments[segments.length - 1];
    if (prev && g.from <= prev.to) {
      prev.to = Math.max(prev.to, g.to);
      prev.why = `${prev.why}；${g.why}`;
    } else {
      segments.push({ ...g });
    }
  }

  const { oneLiner, hook, verdict, verdictReason } = raw;
  return { summary: { oneLiner, keyPoints, quotes, hook, verdict, verdictReason, segments }, anchored, total };
}

export async function summarizeVideo(opts: {
  title: string;
  channelName: string;
  durationSec: number;
  lines: [number, string][];
  interestProfile: string;
}): Promise<{ summary: VideoSummary; anchored: number; total: number }> {
  const { title, channelName, durationSec, lines, interestProfile } = opts;

  // Stable across videos (cached): role, output rules, full interest profile.
  const system = `你是游舒帆（Gipi）的影音重點整理員。Gipi 沒時間看完每支長片，你讀逐字稿，幫他用一分鐘判斷值不值得看、從哪裡開始看。
全部用繁體中文；人名、公司名、專有名詞可保留原文。逐字稿是 YouTube 自動字幕，會有聽錯的字，請依上下文理解，不要照抄錯字。

# 只寫逐字稿裡有的東西
年份、日期、數字、頭銜、因果關係，都要逐字稿裡講到才寫。逐字稿沒講的背景（例如某件事發生在哪一年）不要憑記憶補上，寧可不寫。

# 時間要對
每個 keyPoint、quote、segment 都附 anchor：從逐字稿照抄 5–12 個英文字（中文逐字稿則 8–20 字），必須一字不差地出現在逐字稿裡。
anchor 要取自「真正在講這件事」的那一行，不是開場預告、也不是結尾回顧時順帶提到的地方；t（segment 則是 from）填那一行開頭的秒數。程式會用 anchor 校正時間。

# 輸出
- oneLiner：一句話講這集最重要的東西（不是介紹來賓）。
- keyPoints：3–5 個關鍵觀點，照影片時間先後排，寫成可以單獨看懂的一句到兩句。
- quotes：0–3 則具體數據或值得記下的原話（翻成中文，保留數字）。沒有就給空陣列。
- hook：直接對 Gipi 說話、用「你」稱呼（例如「對你來說……」），一句話把這集連到你關心的脈絡（商業思維、教練式領導、學習與成長、AI 改變組織、長線複利、心理與親子），講出可以怎麼用。
- verdict：三種都要用，依內容判斷，不要每支都給 segments。
  - full：大部分內容都直接連到上述脈絡，而且前後環環相扣，跳著看會漏掉脈絡。
  - segments：只有部分段落值得看。
  - skip：只有零星幾句和上述脈絡有關（例如以運動、娛樂、八卦或閒聊為主），看完摘要就夠了。
  verdictReason 一句話說理由。
- segments：verdict 為 segments 時給 1–3 段（from/to 秒數＋為什麼），照時間排、不要重疊；full 或 skip 給空陣列。

# 興趣輪廓（全文）
${interestProfile}`;

  const transcript = lines.map(([t, text]) => `[${mmss(t)}|${t}] ${text}`).join("\n");
  const user = `# ${channelName}｜${title}
片長 ${mmss(durationSec)}。每行開頭是 [時間|秒數]，t 請填秒數。

${transcript}`;

  const raw = await generateJSON<RawSummary>({
    model: MODELS.summarize,
    system,
    user,
    schema: SCHEMA,
    maxTokens: 16000,
    cacheSystem: true,
  });
  return tidySummary(raw, lines, durationSec);
}
