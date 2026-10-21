import type { VideoView } from "@/lib/digest-data";

// 🎬 影音重點: one card per new long upload, timestamps link straight into the
// video. Not part of the 45-article count. Videos that couldn't be summarized
// are listed at the end so nothing silently disappears.

const VERDICT: Record<string, string> = {
  full: "值得看全片",
  segments: "看重點段落就好",
  skip: "看完摘要就夠",
};

const NOT_SUMMARIZED: Record<string, string> = {
  no_transcript: "沒有字幕",
  skipped_budget: "Supadata 額度不足",
  failed: "處理失敗",
};

function clock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return (h ? `${h}:${String(m).padStart(2, "0")}` : String(m)) + `:${String(s).padStart(2, "0")}`;
}

const at = (id: string, sec?: number) =>
  `https://www.youtube.com/watch?v=${id}${sec ? `&t=${Math.floor(sec)}s` : ""}`;

function Ts({ id, t }: { id: string; t: number }) {
  return (
    <a className="ts" href={at(id, t)} target="_blank" rel="noreferrer">
      {clock(t)}
    </a>
  );
}

export default function VideoSection({ videos }: { videos: VideoView[] }) {
  const done = videos.filter((v) => v.summary);
  const rest = videos.filter((v) => !v.summary);
  if (!videos.length) return null;

  return (
    <section className="tier tier5" id="videos">
      <div className="tier-head">
        <h2>🎬 影音重點</h2>
        <span className="count">
          {done.length} 支｜訂閱頻道的新長片，不佔 45 篇名額
        </span>
      </div>

      {done.map((v) => {
        const s = v.summary!;
        return (
          <article className="card video" key={v.id}>
            <h3>
              <a href={at(v.id)} target="_blank" rel="noreferrer">
                {v.title}
              </a>
            </h3>
            <div className="src">
              {v.channelName}｜片長 {clock(v.durationSec)}
              {v.publishedAt ? `｜約 ${v.publishedAt.toISOString().slice(5, 10).replace("-", "/")} 上片` : ""}
            </div>
            <p className="verdict">
              <span className={`pill ${s.verdict}`}>{VERDICT[s.verdict] ?? s.verdict}</span>
              {s.verdictReason}
            </p>
            <p className="fact">
              <span className="label">重點</span>
              {s.oneLiner}
            </p>
            {s.keyPoints.length ? (
              <ul className="points">
                {s.keyPoints.map((k, i) => (
                  <li key={i}>
                    <Ts id={v.id} t={k.t} />
                    <span>{k.point}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {s.quotes.length ? (
              <ul className="points quotes">
                {s.quotes.map((q, i) => (
                  <li key={i}>
                    <Ts id={v.id} t={q.t} />
                    <span>「{q.text}」</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="hook">
              <span className="label">Hook</span>
              {s.hook}
            </p>
            {s.segments.length ? (
              <div className="links segments">
                建議看：
                {s.segments.map((g, i) => (
                  <a key={i} href={at(v.id, g.from)} target="_blank" rel="noreferrer" title={g.why}>
                    {clock(g.from)}–{clock(g.to)} {g.why}
                  </a>
                ))}
              </div>
            ) : null}
          </article>
        );
      })}

      {rest.length ? (
        <div className="card video-rest">
          <div className="src">沒有摘要的新片（{rest.length} 支）</div>
          <ul>
            {rest.map((v) => (
              <li key={v.id}>
                <a href={at(v.id)} target="_blank" rel="noreferrer">
                  {v.title}
                </a>
                <span className="why">
                  {v.channelName}｜{clock(v.durationSec)}｜{NOT_SUMMARIZED[v.status] ?? v.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
