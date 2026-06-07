import type { LintReport, TierKey } from "../lib/types";

// Programmatic enforcement of the hard rules in 游舒帆_FB口吻風格指南.md §一 + §四.
// Hard checks gate acceptance (and drive regeneration); advisory checks are
// surfaced but don't block.

const SUBJECTIVE = ["我覺得", "我認為", "我的觀察是", "我的看法是"];
const HEDGING = [
  "或許",
  "我持保留態度",
  "保留態度",
  "其實還是得看",
  "可以再觀察",
  "再觀察",
  "我不急著下結論",
  "不見得",
  "未必",
];
const BANNED = ["我之前就說過", "正如我所預言", "我早就說過", "如我所料"];

function charCount(s: string): number {
  return Array.from(s.replace(/\s/g, "")).length;
}

function endsWithQuestion(s: string): boolean {
  const t = s.trimEnd();
  const last = t.slice(-1);
  return last === "?" || last === "？";
}

export function lintComment(
  comment: string,
  tier: TierKey,
  cfg: { minChars: number; maxChars: number; lifeMinChars: number; lifeMaxChars: number },
): LintReport {
  const isLife = tier === "life";
  const min = isLife ? cfg.lifeMinChars : cfg.minChars;
  const max = isLife ? cfg.lifeMaxChars : cfg.maxChars;
  const n = charCount(comment);

  const hasSubjective = SUBJECTIVE.some((k) => comment.includes(k));
  const hasHedging = HEDGING.some((k) => comment.includes(k));
  const banned = BANNED.find((k) => comment.includes(k));
  const antithesis = (comment.match(/而是/g) ?? []).length;

  const checks: (LintReport["checks"][number] & { hard: boolean })[] = [
    {
      id: "length",
      label: `字數 ${min}–${max}（實際 ${n}）`,
      pass: n >= min && n <= max,
      hard: true,
      detail: `${n} 字`,
    },
    {
      id: "ending",
      label: "結尾為陳述、非反問句",
      pass: !endsWithQuestion(comment),
      hard: true,
    },
    {
      id: "subjective",
      label: "含主觀標記（我覺得／我認為／我的觀察是）",
      pass: hasSubjective,
      hard: true,
    },
    {
      id: "hedging",
      label: "含保留語氣（或許／再觀察／其實還是得看…）",
      pass: hasHedging,
      hard: true,
    },
    {
      id: "no_self_citation",
      label: "未使用「我之前就說過」式自誇",
      pass: !banned,
      hard: true,
      detail: banned ? `命中：${banned}` : undefined,
    },
    {
      id: "antithesis",
      label: `對仗金句「不是A而是B」≤1（偵測「而是」${antithesis} 次）`,
      pass: antithesis <= 1,
      hard: false,
    },
  ];

  const ok = checks.filter((c) => c.hard).every((c) => c.pass);
  return {
    ok,
    charCount: n,
    checks: checks.map(({ hard: _hard, ...rest }) => rest),
  };
}

/** A compact instruction the model can use to fix a failed comment. */
export function lintFeedback(report: LintReport): string {
  const fails = report.checks.filter((c) => !c.pass);
  if (!fails.length) return "";
  return (
    "上一稿未通過下列風格檢核，請修正後重寫整篇（保留事實與觀點，只調整風格）：\n" +
    fails.map((c) => `- ${c.label}${c.detail ? `（${c.detail}）` : ""}`).join("\n")
  );
}
