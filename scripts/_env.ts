// Minimal .env loader for tsx scripts (Next.js loads .env on its own for the
// web app; standalone scripts don't). No dependency, supports KEY=VALUE lines,
// comments, and surrounding quotes.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const path = join(process.cwd(), ".env");
if (existsSync(path)) {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    // Match @next/env behaviour: \$ is a literal $ (so escaped bcrypt hashes
    // load identically in the CLI and the web app).
    val = val.replace(/\\\$/g, "$");
    if (!(key in process.env)) process.env[key] = val;
  }
}
