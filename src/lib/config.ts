import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "./db";
import type { DigestConfig } from "./types";

// Settings are stored in the DB (editable from the /settings page) and seeded
// from the files in config/ on first run. These functions are the single
// read/write path so the pipeline and the UI never disagree.

const CONFIG_DIR = join(process.cwd(), "config");

export function readConfigFile(name: string): string {
  return readFileSync(join(CONFIG_DIR, name), "utf8");
}

async function getSetting(key: string, fallbackFile: string): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (row) return row.value;
  // Lazy-seed from the bundled config file.
  const seed = readConfigFile(fallbackFile);
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: seed },
    update: {},
  });
  return seed;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

export async function getInterestProfile(): Promise<string> {
  return getSetting("interest_profile", "interest_profile.md");
}

export async function getStyleGuide(): Promise<string> {
  return getSetting("style_guide", "style_guide.md");
}

export async function getDigestConfig(): Promise<DigestConfig> {
  const raw = await getSetting("digest_config", "digest_config.json");
  return JSON.parse(raw) as DigestConfig;
}

export async function setDigestConfig(cfg: DigestConfig): Promise<void> {
  await setSetting("digest_config", JSON.stringify(cfg, null, 2));
}
