// Generate a bcrypt hash for AUTH_PASSWORD_HASH.
// Usage: npm run hash -- 'your-password'
import bcrypt from "bcryptjs";

const pw = process.argv[2];
if (!pw) {
  console.error("Usage: npm run hash -- 'your-password'");
  process.exit(1);
}
const hash = bcrypt.hashSync(pw, 12);
console.log(hash);
// Paste-ready .env line ($ escaped so dotenv-expand keeps it literal):
console.log(`\nAUTH_PASSWORD_HASH=${hash.replace(/\$/g, "\\$")}`);
