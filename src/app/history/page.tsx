import Link from "next/link";
import { listDigests } from "@/lib/digest-data";
import { formatChineseDate } from "@/lib/date";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const digests = await listDigests();
  return (
    <div className="wrap">
      <header className="masthead">
        <h1>歷史存檔</h1>
        <div className="meta">共 {digests.length} 期日報</div>
      </header>
      <div className="card-pad" style={{ marginTop: 20 }}>
        {digests.length === 0 ? (
          <p className="muted">尚無日報。</p>
        ) : (
          digests.map((d) => (
            <div className="history-item" key={d.id}>
              <Link href={`/digest/${d.id}`}>
                {formatChineseDate(d.date)} 第 {d.edition} 期
              </Link>
              <span className="muted">{d.count} 篇</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
