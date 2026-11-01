import type { DigestConfig } from "@/lib/types";
import type { SignalExample } from "@/lib/engagement";
import { MIN_LIKED, WINDOW_DAYS, loadReadingSignals } from "@/lib/engagement";

// /settings: what the reading tracker has learned, so the automatic feedback
// is visible (and checkable) without Gipi having to curate anything.
export default async function ReadingSignalsCard({ cfg }: { cfg: DigestConfig }) {
  const s = await loadReadingSignals(cfg);
  const active = s.likedTotal >= MIN_LIKED;
  return (
    <div className="card-pad signals" style={{ marginTop: 20 }}>
      <label className="field" style={{ marginTop: 0 }}>閱讀紀錄（自動記錄，不用手動評分）</label>
      <p>
        最近 {WINDOW_DAYS} 天：看過 {s.seen} 篇、讀了或點開 {s.likedTotal} 篇、直接滑過 {s.skippedTotal} 篇。
      </p>
      <p className="muted">
        {active
          ? "每天評分與選文時，會把下面這些當參考範例：相近的主題加分、常滑過的減分（只微調，不推翻區塊與排除規則）。"
          : `累積到 ${MIN_LIKED} 篇「讀了或點開」後才開始影響評分與選文（還差 ${MIN_LIKED - s.likedTotal} 篇）。`}
      </p>
      <Examples title="讀了或點開" list={s.liked} />
      <Examples title="直接滑過" list={s.skipped} />
    </div>
  );
}

function Examples({ title, list }: { title: string; list: SignalExample[] }) {
  if (!list.length) return null;
  return (
    <details>
      <summary>
        {title}（{list.length}）
      </summary>
      <ul>
        {list.map((e, i) => (
          <li key={i}>
            {e.title} <span className="muted">｜{e.tierLabel}｜{e.how}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
