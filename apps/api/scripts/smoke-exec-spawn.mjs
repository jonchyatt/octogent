#!/usr/bin/env node
// Standalone smoke for P1a-5: proves the exec-mode spawn path can actually
// drive codex from a cwd, let it write PROOF.txt, and return a clean exit.
//
// Usage: node apps/api/scripts/smoke-exec-spawn.mjs <cwd>
// If <cwd> is omitted, defaults to /tmp/octogent-smoke.
//
// This intentionally does NOT route through the dashboard — it exercises
// just spawnExecChild + buildExecCommand to isolate whether the exec plumbing
// works before we restart the running dashboard.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const cwd = process.argv[2] ?? "/tmp/octogent-smoke";
if (!existsSync(cwd)) {
  console.error(`[smoke] cwd does not exist: ${cwd}`);
  process.exit(2);
}

const outfile = join(cwd, ".codex-last-message.json");
const prompt = [
  "Do exactly these steps in the current working directory:",
  "1. Write a file named PROOF.txt containing the current UTC ISO-8601 timestamp on a single line (nothing else).",
  "2. Run `git add PROOF.txt` and `git commit -m \"smoke: exec-mode PROOF\"` to commit it.",
  "3. Print `SMOKE_DONE` on stdout and exit.",
].join("\n");

// Mirror buildExecCommand("codex", prompt, outfile) — prompt via stdin
const command = "codex";
const args = [
  "exec",
  "--dangerously-bypass-approvals-and-sandbox",
  "--output-last-message",
  outfile,
  "-", // read prompt from stdin
];

console.log(`[smoke] cwd=${cwd}`);
console.log(`[smoke] command=${command} args=${JSON.stringify(args)}`);
console.log(`[smoke] prompt=${JSON.stringify(prompt)}`);

const startedAt = Date.now();
// Windows .cmd fix: must use shell=true to execute codex.cmd
const useShell = process.platform === "win32";
const child = spawn(command, args, {
  cwd,
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
  shell: useShell,
});

// Pipe prompt on stdin + close so codex sees EOF
if (child.stdin) {
  child.stdin.on("error", () => {});
  child.stdin.end(prompt);
}

let stdoutBytes = 0;
let stderrBytes = 0;

child.stdout?.on("data", (chunk) => {
  stdoutBytes += chunk.length;
  process.stdout.write(chunk);
});

child.stderr?.on("data", (chunk) => {
  stderrBytes += chunk.length;
  process.stderr.write(chunk);
});

child.on("error", (err) => {
  console.error(`[smoke] spawn error: ${err.message}`);
  process.exit(3);
});

child.on("exit", (code, signal) => {
  const elapsedMs = Date.now() - startedAt;
  console.log(
    `\n[smoke] exit code=${code} signal=${signal} elapsedMs=${elapsedMs} stdoutBytes=${stdoutBytes} stderrBytes=${stderrBytes}`,
  );

  const proofPath = join(cwd, "PROOF.txt");
  if (existsSync(proofPath)) {
    const contents = readFileSync(proofPath, "utf8");
    console.log(`[smoke] PROOF.txt exists (${contents.length} bytes):`);
    console.log(contents);
  } else {
    console.log("[smoke] PROOF.txt NOT written");
  }

  if (existsSync(outfile)) {
    const lastMsg = readFileSync(outfile, "utf8");
    console.log(`[smoke] last-message (${lastMsg.length} bytes):`);
    console.log(lastMsg.slice(0, 500));
  } else {
    console.log("[smoke] last-message file NOT written");
  }

  // Verify commit landed
  const logResult = spawnSync("git", ["log", "--oneline", "-5"], {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  console.log(`[smoke] git log --oneline -5:\n${logResult.stdout}`);

  const lastCommitMsg = spawnSync("git", ["log", "-1", "--pretty=%s"], {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const hasSmokeCommit = lastCommitMsg.stdout.includes("smoke");
  console.log(`[smoke] last commit message: ${lastCommitMsg.stdout.trim()}`);
  console.log(`[smoke] COMMIT VERIFIED: ${hasSmokeCommit ? "YES" : "NO"}`);

  process.exit(code ?? 0);
});
