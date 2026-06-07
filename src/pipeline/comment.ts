import { MODELS, generateText } from "../lib/anthropic";
import type { DigestConfig, LintReport, SelectedArticle } from "../lib/types";
import { lintComment, lintFeedback } from "./lint";

// Stage 3: generate the voice-mimicking FB post draft ("我的評論") for one
// article, enforcing 游舒帆_FB口吻風格指南.md via a programmatic lint + retry
// loop (SPEC §4.2, hard requirement).

export async function generateComment(opts: {
  article: SelectedArticle;
  styleGuide: string;
  cfg: DigestConfig;
  today: string;
}): Promise<{ comment: string; lint: LintReport }> {
  const { article, styleGuide, cfg, today } = opts;
  const isLife = article.tier === "life";
  const min = isLife ? cfg.comment.lifeMinChars : cfg.comment.minChars;
  const max = isLife ? cfg.comment.lifeMaxChars : cfg.comment.maxChars;

  const system =
    "你正在模擬游舒帆（Gipi）本人在 Facebook 發表長文貼文的口吻。今天是 " +
    today +
    "（台北時間）。你必須完全遵守下方《游舒帆 FB 口吻風格指南》的所有硬性規格。" +
    "只輸出貼文本文，不要任何前後綴、標題或說明。\n\n" +
    "=== 風格指南 ===\n" +
    styleGuide;

  const baseUser = `請依據以下素材，寫成一篇游舒帆口吻的 FB 貼文草稿。

【區塊】${isLife ? "生活版（語氣較輕鬆，可較短）" : "工作 / 商業"}
【篇幅】${min}–${max} 字
【標題（僅供你理解主題，不要寫進貼文）】${article.title}
【事實摘要】${article.factSummary}
【可發揮的觀點 Hook】${article.opinionHook}

寫作要求：
- 先把事實講完整（可佔一半篇幅），再進入個人評論。
- 結尾用觀察式陳述，禁止以反問句對讀者喊話結尾。
- 至少出現一次「我覺得／我認為／我的觀察是」，並至少一處保留語氣（或許／其實還是得看／可以再觀察…）。
- 「不是A而是B」式對仗金句最多一次。
- 不要用「我之前就說過」這類自誇。
- 維持短段、單行成段的節奏。`;

  let user = baseUser;
  let comment = "";
  let lint: LintReport = { ok: false, charCount: 0, checks: [] };

  for (let attempt = 0; attempt <= cfg.comment.maxRetries; attempt++) {
    comment = await generateText({
      model: MODELS.comment,
      system,
      user,
      maxTokens: 4000,
    });
    lint = lintComment(comment, article.tier, cfg.comment);
    if (lint.ok) break;
    // Feed the failures back for the next attempt.
    user = `${baseUser}\n\n${lintFeedback(lint)}`;
  }

  return { comment, lint };
}
