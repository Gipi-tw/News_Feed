import "./_env";
import { runDigest } from "../src/pipeline";

// CLI: run one full digest end-to-end. Useful for cron-less environments and
// for local verification.  Usage: npm run digest
async function main() {
  const started = Date.now();
  const result = await runDigest({ trigger: "manual" });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log("\n=== 完成 ===");
  console.log(JSON.stringify(result, null, 2));
  console.log(`耗時 ${secs}s`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
