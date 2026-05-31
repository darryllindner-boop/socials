// Cross-platform local setup: create .env from .env.example (if missing) and
// fill in a strong TOKEN_ENCRYPTION_KEY when it's empty. Uses Node's crypto so
// it works on Windows/macOS/Linux without openssl. Safe to run repeatedly.
import { existsSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
const examplePath = join(root, ".env.example");

if (!existsSync(envPath)) {
  if (!existsSync(examplePath)) {
    console.error("Missing .env.example; cannot create .env.");
    process.exit(1);
  }
  copyFileSync(examplePath, envPath);
  console.log("Created .env from .env.example");
} else {
  console.log(".env already exists; leaving it in place.");
}

let env = readFileSync(envPath, "utf8");

// Inject a key only if the var is present but empty.
if (/^TOKEN_ENCRYPTION_KEY\s*=\s*""?\s*$/m.test(env)) {
  const key = randomBytes(32).toString("base64");
  env = env.replace(/^TOKEN_ENCRYPTION_KEY\s*=.*$/m, `TOKEN_ENCRYPTION_KEY="${key}"`);
  writeFileSync(envPath, env);
  console.log("Generated TOKEN_ENCRYPTION_KEY.");
} else {
  console.log("TOKEN_ENCRYPTION_KEY already set; leaving it in place.");
}

console.log("\nEnv ready. Next:");
console.log("  1) make sure Postgres + Redis are running");
console.log("  2) npm run db:push && npm run db:seed");
console.log("  3) npm run dev:all   (or: npm run dev  +  npm run worker in two terminals)");
