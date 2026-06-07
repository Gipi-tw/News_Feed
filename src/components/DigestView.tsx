import type { DigestView as DigestData } from "@/lib/digest-data";
import { getTierMeta } from "@/lib/digest-data";
import { formatChineseDate } from "@/lib/date";
import CommentBlock from "./CommentBlock";

// Renders one digest with the verified template layout (SPEC §5.2):
// masthead, TOC, four colored tier sections, cards with fact/hook/links, and
// the expandable 我的評論 block.
export default async function DigestView({ digest }: { digest: DigestData }) {
  const tiers = await getTierMeta();
  const byTier = new Map<string, typeof digest.articles>();
  for (const a of digest.articles) {
    (byTier.get(a.tier) ?? byTier.set(a.tier, []).get(a.tier)!).push(a);
  }

  const tocParts = tiers
    .map((t) => {
      const n = byTier.get(t.key)?.length ?? 0;
      return n ? `${t.emoji} ${t.label.split("：")[0]} ${n} 篇` : null;
    })
    .filter(Boolean)
    .join("｜");
  const total = digest.articles.length;

  return (
    <div className="wrap">
      <header className="masthead">
        <h1>內容摘要日報</h1>
        <div className="meta">
          {formatChineseDate(digest.date)} 第 {digest.edition} 期｜依《游舒帆興趣輪廓分析》產出｜
          格式：事實摘要 ＋ 觀點 hook ＋ 原始連結 ＋ 我的評論
        </div>
      </header>

      <div className="toc">
        本期 {total} 篇：{tocParts}
      </div>

      {tiers.map((t) => {
        const items = byTier.get(t.key) ?? [];
        if (!items.length) return null;
        return (
          <section key={t.key} className={`tier ${t.tierClass}`}>
            <div className="tier-head">
              <h2>
                {t.emoji} {t.label}
              </h2>
              <span className="count">
                {items.length} 篇｜{t.subtitle}
              </span>
            </div>
            {items.map((a) => (
              <article className="card" key={a.id}>
                <h3>
                  <span className="num">{String(a.position).padStart(2, "0")}</span>
                  {a.urls[0] ? (
                    <a href={a.urls[0]} target="_blank" rel="noreferrer">
                      {a.title}
                    </a>
                  ) : (
                    a.title
                  )}
                </h3>
                <div className="src">
                  {a.sourceName}
                  {a.sourceDate ? `｜${a.sourceDate}` : ""}
                </div>
                <p className="fact">
                  <span className="label">事實</span>
                  {a.factSummary}
                </p>
                <p className="hook">
                  <span className="label">Hook</span>
                  {a.opinionHook}
                </p>
                {a.urls.length ? (
                  <div className="links">
                    {a.urls.map((u, i) => (
                      <a key={i} href={u} target="_blank" rel="noreferrer">
                        {hostOf(u, i)}
                      </a>
                    ))}
                  </div>
                ) : null}
                <CommentBlock article={a} />
              </article>
            ))}
          </section>
        );
      })}

      <footer>
        <p>
          依《游舒帆興趣輪廓分析》產出。配比：企業動態 12 ＋ AI × 工作方式 8 ＋ 第二級 10 ＋ 生活版 5。
          去重以 URL 為硬條件、事件相似為軟條件，窗口 30 天。「我的評論」經程式化風格 lint 檢核。
        </p>
      </footer>
    </div>
  );
}

function hostOf(u: string, i: number): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return `連結 ${i + 1}`;
  }
}
