import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import type { ApiRouteHandler } from "./routeHelpers";
import { writeJson, writeMethodNotAllowed, writeText } from "./routeHelpers";

// Phase 10.9.6 — expose exec-mode worker output logs through the
// CONVERSATIONS tab. Exec-mode workers write stdout/stderr to
// `.octogent/state/exec-output/<terminal-id>.log` (and optional JSON
// metadata to `<terminal-id>.json`). Before this fix those logs were
// operator-invisible — the CONVERSATIONS tab only rendered interactive-
// mode transcripts, and no endpoint exposed the exec logs to the UI.
//
// Two endpoints:
//   GET /api/exec-outputs               → list of { terminalId, bytes, mtime }
//   GET /api/exec-outputs/<terminalId>  → raw log content as text/plain
//
// Both read the filesystem directly. Listings are sorted by mtime
// descending (newest worker first). Content reads return the whole file;
// if operators need tail-only semantics later, add `?tail=<n>` support.

const LOG_SUFFIX = ".log";

type ExecOutputEntry = {
  terminalId: string;
  bytes: number;
  mtime: string;
};

const readExecOutputListing = (projectStateDir: string): ExecOutputEntry[] => {
  const dir = join(projectStateDir, "state", "exec-output");
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  const results: ExecOutputEntry[] = [];
  for (const file of entries) {
    if (!file.endsWith(LOG_SUFFIX)) continue;
    const terminalId = file.slice(0, -LOG_SUFFIX.length);
    if (terminalId.length === 0) continue;
    const filePath = join(dir, file);
    try {
      const stats = statSync(filePath);
      results.push({
        terminalId,
        bytes: stats.size,
        mtime: stats.mtime.toISOString(),
      });
    } catch {
      // Skip any file that raced a rm.
    }
  }

  results.sort((a, b) => (a.mtime < b.mtime ? 1 : a.mtime > b.mtime ? -1 : 0));
  return results;
};

export const handleExecOutputsCollectionRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { projectStateDir },
) => {
  if (requestUrl.pathname !== "/api/exec-outputs") return false;

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const entries = readExecOutputListing(projectStateDir);
  writeJson(response, 200, { entries }, corsOrigin);
  return true;
};

const EXEC_OUTPUT_ITEM_PATTERN = /^\/api\/exec-outputs\/([^/]+)$/;
// Guard against path-traversal: terminal IDs are expected to look like
// "terminal-<hex>" / "terminal-<slug>". Anything containing a slash, dot-
// dot, or unusual chars is rejected before we touch the filesystem.
const SAFE_TERMINAL_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export const handleExecOutputItemRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { projectStateDir },
) => {
  const match = requestUrl.pathname.match(EXEC_OUTPUT_ITEM_PATTERN);
  if (!match) return false;

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const terminalId = decodeURIComponent(match[1] ?? "");
  if (!SAFE_TERMINAL_ID_PATTERN.test(terminalId)) {
    writeJson(response, 400, { error: "Invalid terminal id." }, corsOrigin);
    return true;
  }

  const filePath = join(projectStateDir, "state", "exec-output", `${terminalId}.log`);
  if (!existsSync(filePath)) {
    writeJson(response, 404, { error: "Exec output log not found." }, corsOrigin);
    return true;
  }

  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch (error) {
    writeJson(
      response,
      500,
      { error: `Unable to read exec output: ${(error as Error).message}` },
      corsOrigin,
    );
    return true;
  }

  writeText(response, 200, content, corsOrigin);
  return true;
};
