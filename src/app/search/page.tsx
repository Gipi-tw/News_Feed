import Link from "next/link";
import { searchArticles } from "@/lib/digest-data";
import { formatChineseDate } from "@/lib/date";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const results = q ? await searchArticles(q) : [];

  return (
    <div className="wrap">
      <header className="masthead">
        <h1>搜尋</h1>
        <div className="meta">標題／摘要／Hook／我的評論 全文關鍵字</div>
      </header>

      <form method="get" className="row" style={{ marginTop: 20 }}>
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="輸入關鍵字…"
          style={{ flex: 1, minWidth: 200 }}
        />
        <button className="btn" type="submit">
          搜尋
        </button>
      </form>

      {q ? (
        <p className="muted" style={{ marginTop: 14 }}>
          「{q}」找到 {results.length} 篇
        </p>
      ) : null}

      <div style={{ marginTop: 8 }}>
        {results.map((a) => (
          <article className="card" key={a.id}>
            <h3>
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
              {a.sourceDate ? `｜${a.sourceDate}` : ""}｜
              <Link href={`/digest/${a.digestId}`}>
                {formatChineseDate(a.date)} 第 {a.edition} 期
              </Link>
            </div>
            <p className="fact">
              <span className="label">事實</span>
              {a.factSummary}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
