// Assemble the packaged desktop payload from a completed Next.js build.
//
// Run AFTER `next build` (which, with output: "standalone", produces
// .next/standalone/server.js). This collects everything the Electron app needs
// at runtime into dist-desktop/app/, laid out exactly how electron/main.cjs and
// electron/db.cjs expect to find it once electron-builder copies it to
// resources/app (see electron-builder.yml -> extraResources):
//
//   dist-desktop/app/
//     .next/standalone/server.js          <- the embedded Next server
//     .next/standalone/.next/static/...    <- static assets (served by server.js)
//     .next/standalone/public/...          <- public assets (if any)
//     .next/standalone/node_modules/.prisma + @prisma/client  <- query engine
//     prisma/schema.sqlite.prisma          <- schema for `prisma db push`
//     node_modules/prisma + @prisma + .prisma  <- Prisma CLI + engines (db push)
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist-desktop", "app");
const standaloneSrc = join(root, ".next", "standalone");

function copy(from, to, { optional = false } = {}) {
  const src = join(root, from);
  if (!existsSync(src)) {
    if (optional) {
      console.log(`· skip (absent): ${from}`);
      return;
    }
    throw new Error(
      `Required path missing: ${from}\n` +
        `Did you run "next build" (with output: "standalone") and "prisma generate" first?`,
    );
  }
  const dest = join(out, to);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`✓ ${from} -> dist-desktop/app/${to}`);
}

console.log("Assembling desktop payload into dist-desktop/app …");
rmSync(join(root, "dist-desktop", "app"), { recursive: true, force: true });
mkdirSync(out, { recursive: true });

if (!existsSync(standaloneSrc)) {
  throw new Error(
    'No .next/standalone output. Set output: "standalone" in next.config.mjs and run "next build".',
  );
}

// 1) The standalone server itself.
copy(".next/standalone", ".next/standalone");
// 2) Static + public assets must sit relative to server.js.
copy(".next/static", ".next/standalone/.next/static");
copy("public", ".next/standalone/public", { optional: true });

// 3) Prisma Client + query engine inside the server's node_modules (externalized
//    packages aren't always traced into standalone, so copy them explicitly).
copy("node_modules/.prisma", ".next/standalone/node_modules/.prisma", { optional: true });
copy("node_modules/@prisma/client", ".next/standalone/node_modules/@prisma/client", {
  optional: true,
});

// 4) Schema for runtime `prisma db push`.
copy("prisma/schema.sqlite.prisma", "prisma/schema.sqlite.prisma");
copy("prisma/migrations", "prisma/migrations", { optional: true });

// 5) Prisma CLI + engines used by ensureDatabase() at first run.
copy("node_modules/prisma", "node_modules/prisma");
copy("node_modules/@prisma", "node_modules/@prisma");
copy("node_modules/.prisma", "node_modules/.prisma", { optional: true });

console.log("\nDone. electron-builder will package dist-desktop/app -> resources/app.");
