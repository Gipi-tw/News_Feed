import { MODELS, generateJSON } from "../lib/anthropic";

// One video → a Traditional Chinese brief with timestamped points, so Gipi can
// decide in a minute whether to watch, and where to jump in.

export interface VideoSummary {
  oneLiner: string;
  keyPoints: { t: number; point: string }[]; // 3–5, t = seconds into the video
  quotes: { t: number; text: string }[]; // data points or memorable lines, 0–3
  hook: string;
  verdict: "full" | "segments" | "skip"; // 值得看全片 / 看重點段落 / 略過也行
  verdictReason: string;
  segments: { from: number; to: number; why: string }[];
}

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
        properties: { t: { type: "integer" }, point: { type: "string" } },
        required: ["t", "point"],
      },
    },
    quotes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { t: { type: "integer" }, text: { type: "string" } },
        required: ["t", "text"],
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
        properties: { from: { type: "integer" }, to: { type: "integer" }, why: { type: "string" } },
        required: ["from", "to", "why"],
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

export async function summarizeVideo(opts: {
  title: string;
  channelName: string;
  durationSec: number;
  lines: [number, string][];
  interestProfile: string;
}): Promise<VideoSummary> {
  const { title, channelName, durationSec, lines, interestProfile } = opts;

  // Stable across videos (cached): role, output rules, full interest profile.
  const system = `你是游舒帆（Gipi）的影音重點整理員。Gipi 沒時間看完每支長片，你讀逐字稿，幫他用一分鐘判斷值不值得看、從哪裡開始看。
全部用繁體中文；人名、公司名、專有名詞可保留原文。逐字稿是 YouTube 自動字幕，會有聽錯的字，請依上下文理解，不要照抄錯字。

輸出：
- oneLiner：一句話講這集最重要的東西（不是介紹來賓）。
- keyPoints：3–5 個關鍵觀點，每個附開始秒數 t（取自逐字稿的時間標記），寫成可以單獨看懂的一句到兩句。
- quotes：0–3 則具體數據或值得記下的原話（翻成中文，保留數字），附秒數。沒有就給空陣列。
- hook：一句話把這集連到 Gipi 關心的脈絡（商業思維、教練式領導、學習與成長、AI 改變組織、長線複利、心理與親子），講出他可以怎麼用。
- verdict：full＝值得看全片；segments＝看重點段落就好；skip＝看完摘要就夠了。verdictReason 一句話說理由。
- segments：建議看的段落（from/to 秒數＋為什麼），verdict 為 segments 時給 1–3 段，其他情況可給空陣列。

# 興趣輪廓（全文）
${interestProfile}`;

  const transcript = lines.map(([t, text]) => `[${mmss(t)}|${t}] ${text}`).join("\n");
  const user = `# ${channelName}｜${title}
片長 ${mmss(durationSec)}。每行開頭是 [時間|秒數]，t 請填秒數。

${transcript}`;

  return generateJSON<VideoSummary>({
    model: MODELS.summarize,
    system,
    user,
    schema: SCHEMA,
    maxTokens: 16000,
    cacheSystem: true,
  });
}
