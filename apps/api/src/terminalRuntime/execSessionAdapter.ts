import { spawn as spawnChild } from "node:child_process";
import { constants as osConstants } from "node:os";

import type { TerminalProcessHandle } from "./types";

// Map a POSIX signal name ("SIGTERM") to its numeric value, matching node-pty's
// IPty.onExit contract which hands back a number. Returns undefined if the
// signal name is unknown OR if we got null from child_process.on("exit").
const signalNameToNumber = (name: NodeJS.Signals | null | undefined): number | undefined => {
  if (!name) {
    return undefined;
  }
  const signals = osConstants.signals as unknown as Record<string, number>;
  const value = signals[name];
  return typeof value === "number" ? value : undefined;
};

type SpawnExecChildOptions = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  // Prompt to pipe on stdin. Written immediately after spawn, then stdin is
  // closed so the agent sees EOF and can proceed. Passing stdin avoids the
  // Windows argv-quoting problem for prompts with spaces / special chars.
  stdin?: string | undefined;
  // Override the default shell selection. Default behavior:
  //   win32 → shell:true (required to launch .cmd shims like codex.cmd)
  //   else  → shell:false
  // Callers that spawn an .exe directly (like node.exe against a resolved
  // .mjs path) pass `useShell=false` to bypass cmd.exe entirely. Used by the
  // openclaw Windows .cmd-shim argv-quoting bypass in `buildExecCommand`.
  useShell?: boolean | undefined;
};

// Adapter that wraps a child_process and exposes the TerminalProcessHandle
// contract (onData / onExit / write / kill / resize / pid) so the rest of
// sessionRuntime.ts can stay provider-agnostic.
//
// Semantics for exec mode:
//   - prompt is passed as argv by the caller (no typed-in bootstrap)
//   - write() is a no-op: mid-turn writes don't exist. New messages queue
//     in the SQLite channel store and are delivered in the NEXT turn
//     (Option #2 explicit-turn channel delivery, see P1b)
//   - resize() is a no-op: exec mode has no TTY
//   - kill() forwards a signal to the child process (used for timeouts
//     and operator-initiated teardown)
export const spawnExecChild = (options: SpawnExecChildOptions): TerminalProcessHandle => {
  // Windows distributes agent CLIs as `.cmd` batch wrappers (codex.cmd,
  // claude.cmd). Node's child_process.spawn with shell=false cannot execute
  // .cmd files — CreateProcess doesn't know how. Setting shell=true on
  // Windows routes through `cmd.exe /d /s /c`; Node handles argv escaping
  // for CMD automatically (security-hardened since Node 18.20.2 /
  // CVE-2024-27980 patch).
  const useShell = options.useShell ?? process.platform === "win32";
  const wantsStdin = typeof options.stdin === "string" && options.stdin.length > 0;
  const child = spawnChild(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: [wantsStdin ? "pipe" : "ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: useShell,
  });

  if (wantsStdin && child.stdin) {
    child.stdin.on("error", () => {
      // Stdin closed by the child before we finished writing — ignore.
    });
    child.stdin.end(options.stdin);
  }

  const dataListeners = new Set<(data: string) => void>();
  const exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>();
  let exited = false;

  const emitChunk = (chunk: Buffer | string) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    for (const listener of dataListeners) {
      try {
        listener(text);
      } catch {
        // Don't let a misbehaving listener tear down the adapter.
      }
    }
  };

  child.stdout?.on("data", emitChunk);
  child.stderr?.on("data", emitChunk);

  const fireExit = (exitCode: number, signal?: number) => {
    if (exited) {
      return;
    }
    exited = true;
    for (const listener of exitListeners) {
      try {
        listener({ exitCode, ...(signal !== undefined ? { signal } : {}) });
      } catch {
        // Ignore listener failures during teardown.
      }
    }
  };

  child.on("exit", (code, signal) => {
    // child_process hands us a signal NAME ("SIGTERM") or null. Translate to
    // the numeric value IPty callers expect. This keeps the MED-3 shape match
    // with Number.isFinite(signal) checks downstream.
    fireExit(code ?? 0, signalNameToNumber(signal));
  });

  child.on("error", (err) => {
    emitChunk(`\r\n[exec-spawn error: ${err.message}]\r\n`);
    fireExit(1);
  });

  return {
    get pid() {
      return child.pid ?? 0;
    },
    onData(listener) {
      dataListeners.add(listener);
      return { dispose: () => void dataListeners.delete(listener) };
    },
    onExit(listener) {
      exitListeners.add(listener);
      return { dispose: () => void exitListeners.delete(listener) };
    },
    write() {
      // No-op: exec workers receive their prompt as argv. Channel messages
      // that arrive during a run queue and are delivered on the next turn.
    },
    kill(signal) {
      try {
        child.kill((signal ?? "SIGTERM") as NodeJS.Signals);
      } catch {
        // If the child is already gone, killing is a no-op.
      }
    },
    resize() {
      // No-op: exec mode has no TTY, nothing to resize.
    },
  };
};
