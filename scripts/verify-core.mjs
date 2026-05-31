// Compile the dependency-free core with TypeScript and run its runtime
// verification on plain Node. Requires NO installed npm packages, so it works
// in fully network-isolated environments and as a fast CI gate.
//
// Usage: node scripts/verify-core.mjs   (or: npm run verify:core)
import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, ".core-dist");
// Clear NODE_OPTIONS so child processes are never broken by a --require preload.
const env = { ...process.env, NODE_OPTIONS: "" };

function run(cmd, args) {
  const label = [cmd, ...args].join(" ");
  console.log(`\n$ ${label}`);
  const res = spawnSync(cmd, args, { cwd: root, env, stdio: "inherit", shell: false });
  if (res.error) {
    console.error(`Failed to launch "${label}": ${res.error.message}`);
    process.exit(1);
  }
  if (typeof res.status === "number" && res.status !== 0) {
    process.exit(res.status);
  }
}

rmSync(distDir, { recursive: true, force: true });

// 1) Type-check + emit CommonJS for the core. `moduleResolution: node` (node10)
//    is the simplest way to get runnable CommonJS with extensionless imports,
//    but newer TypeScript flags it as deprecated and refuses without an explicit
//    acknowledgement. Detect the compiler major version and pass the matching
//    `--ignoreDeprecations` value so this works on both TS 5.x and 6.x.
function tscMajor() {
  const r = spawnSync("tsc", ["--version"], { cwd: root, env, shell: false });
  const out = (r.stdout?.toString() ?? "") + (r.stderr?.toString() ?? "");
  const m = /Version (\d+)\./.exec(out);
  return m ? Number(m[1]) : 5;
}
const ignoreDeprecations = tscMajor() >= 6 ? "6.0" : "5.0";

run("tsc", ["-p", "tsconfig.core.json", "--ignoreDeprecations", ignoreDeprecations]);

// 2) Force Node to treat the emitted .js as CommonJS even though the project's
//    package.json declares "type": "module".
mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, "package.json"), JSON.stringify({ type: "commonjs" }, null, 2));

// 3) Execute the compiled verification entrypoint.
run("node", [".core-dist/core/devtools/verify.js"]);
