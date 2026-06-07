import "./_env";
import { getDigestConfig, getInterestProfile, getStyleGuide } from "../src/lib/config";

// Seeds the editable settings (interest profile / style guide / digest config)
// into the DB from the bundled config/ files, if not already present.
async function main() {
  const profile = await getInterestProfile();
  const guide = await getStyleGuide();
  const cfg = await getDigestConfig();
  console.log("✓ Seeded settings:");
  console.log(`  interest_profile: ${profile.length} chars`);
  console.log(`  style_guide: ${guide.length} chars`);
  console.log(`  digest_config: ${cfg.tiers.length} tiers, provider=${cfg.search.provider}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
