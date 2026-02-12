import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const rootDir = process.cwd();
const gitDir = path.join(rootDir, ".git");
const hooksDir = path.join(rootDir, ".githooks");
const prePushHook = path.join(hooksDir, "pre-push");

if (!fs.existsSync(gitDir)) {
  console.log("[setup:hooks] .git not found, skipping hook installation.");
  process.exit(0);
}

if (!fs.existsSync(prePushHook)) {
  console.log("[setup:hooks] .githooks/pre-push not found, skipping hook installation.");
  process.exit(0);
}

try {
  fs.chmodSync(prePushHook, 0o755);
} catch (error) {
  console.warn("[setup:hooks] could not set executable bit on pre-push hook:", error.message);
}

try {
  execSync("git config core.hooksPath .githooks", {
    cwd: rootDir,
    stdio: "ignore",
  });
  console.log("[setup:hooks] configured core.hooksPath=.githooks");
} catch (error) {
  console.warn("[setup:hooks] failed to configure core.hooksPath:", error.message);
}
