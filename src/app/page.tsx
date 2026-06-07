import { getLatestDigest } from "@/lib/digest-data";
import DigestView from "@/components/DigestView";
import GenerateButton from "@/components/GenerateButton";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const digest = await getLatestDigest();

  if (!digest) {
    return (
      <div className="wrap">
        <header className="masthead">
          <h1>內容摘要日報</h1>
          <div className="meta">尚無日報</div>
        </header>
        <div className="card-pad" style={{ marginTop: 20 }}>
          <p>目前還沒有任何日報。可手動產生第一期，或等每日 08:00（台北）的排程。</p>
          <GenerateButton />
        </div>
      </div>
    );
  }

  return (
    <>
      <DigestView digest={digest} />
      <div className="wrap" style={{ paddingTop: 0 }}>
        <GenerateButton />
      </div>
    </>
  );
}
