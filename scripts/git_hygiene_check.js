"use strict";

const { execFileSync } = require("child_process");

function runGit(args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trimEnd();
  } catch (error) {
    const stderr = error && error.stderr ? String(error.stderr).trim() : "";
    const stdout = error && error.stdout ? String(error.stdout).trim() : "";
    const detail = stderr || stdout || String(error);
    console.error(`git_hygiene_check: failed to run git ${args.join(" ")}\n${detail}`);
    process.exit(2);
  }
}

function normalizeLines(text) {
  if (!text) {
    return [];
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function extractStatusPath(line) {
  const body = line.slice(3).trim();
  const renameMarker = " -> ";
  if (body.includes(renameMarker)) {
    return body.split(renameMarker).pop().trim();
  }
  return body;
}

const suspiciousMatchers = [
  { re: /^node_modules(?:\/|$)/, reason: "dependency directory" },
  { re: /^dist(?:\/|$)/, reason: "build output" },
  { re: /^artifacts(?:\/|$)/, reason: "packaged or generated artifacts" },
  { re: /^\.swarm(?:\/|$)/, reason: "local swarm state" },
  { re: /^\.swarm-worktrees(?:\/|$)/, reason: "local worktree state" },
  { re: /^\.npm-cache(?:\/|$)/, reason: "local npm cache" },
  { re: /^\.tmp[^/]*(?:\/|$)/, reason: "temporary probe output" },
  { re: /(?:^|\/)debug\.log$/, reason: "debug log" },
  { re: /(?:^|\/).+\.log$/, reason: "log file" },
  { re: /(?:^|\/).+\.stdout$/, reason: "stdout dump" },
  { re: /(?:^|\/).+\.stderr$/, reason: "stderr dump" },
  { re: /(?:^|\/).+\.stdout\.log$/, reason: "stdout log dump" },
  { re: /(?:^|\/).+\.stderr\.log$/, reason: "stderr log dump" },
  { re: /^owner_profiles\/owner-cache\.local\.json$/, reason: "local owner cache" },
  { re: /^RC1_DAILY_DRIVER_LOG\.json$/, reason: "local daily-driver log" },
  { re: /^Coding_sessions\/github_access_tokens\.md$/, reason: "token file" },
  { re: /(?:^|\/)\.env(?:\.|$)/, reason: "dotenv secret file" },
  { re: /token/i, reason: "token-like filename" },
  { re: /secret/i, reason: "secret-like filename" }
];

function classifyPath(filePath) {
  for (const matcher of suspiciousMatchers) {
    if (matcher.re.test(filePath)) {
      return matcher.reason;
    }
  }
  return null;
}

const repoRoot = runGit(["rev-parse", "--show-toplevel"]);
const untracked = normalizeLines(runGit(["ls-files", "--others", "--exclude-standard"]));
const trackedIgnored = normalizeLines(runGit(["ls-files", "-ci", "--exclude-standard"]));
const statusLines = normalizeLines(runGit(["status", "--porcelain=v1"]));
const statusPaths = statusLines.map(extractStatusPath);

const suspiciousUntracked = untracked
  .map((filePath) => ({ filePath, reason: classifyPath(filePath) }))
  .filter((entry) => entry.reason);

const suspiciousStatus = statusPaths
  .map((filePath) => ({ filePath, reason: classifyPath(filePath) }))
  .filter((entry) => entry.reason);

const trackedIgnoredInteresting = trackedIgnored
  .map((filePath) => ({ filePath, reason: classifyPath(filePath) || "tracked file now covered by ignore rules" }));

console.log(`git_hygiene_check: repo root ${repoRoot}`);
console.log(`git_hygiene_check: ${untracked.length} non-ignored untracked path(s), ${trackedIgnored.length} tracked ignored path(s), ${statusLines.length} status row(s).`);

if (untracked.length > 0) {
  console.log("\nNon-ignored untracked paths:");
  for (const filePath of untracked) {
    console.log(`- ${filePath}`);
  }
}

let failed = false;

if (suspiciousUntracked.length > 0) {
  failed = true;
  console.error("\nSuspicious untracked paths that should usually be ignored or removed before commit:");
  for (const entry of suspiciousUntracked) {
    console.error(`- ${entry.filePath} (${entry.reason})`);
  }
}

if (suspiciousStatus.length > 0) {
  failed = true;
  console.error("\nSuspicious changed/staged paths detected in git status:");
  for (const entry of suspiciousStatus) {
    console.error(`- ${entry.filePath} (${entry.reason})`);
  }
}

if (trackedIgnoredInteresting.length > 0) {
  failed = true;
  console.error("\nTracked paths that now match ignore rules and need review:");
  for (const entry of trackedIgnoredInteresting) {
    console.error(`- ${entry.filePath} (${entry.reason})`);
  }
}

if (failed) {
  console.error("\ngit_hygiene_check: FAIL");
  process.exit(1);
}

console.log("\ngit_hygiene_check: PASS");
