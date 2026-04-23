import { useCallback, useEffect, useState } from "react";

import {
  buildExecOutputItemUrl,
  buildExecOutputsListUrl,
} from "../../runtime/runtimeEndpoints";

// Phase 10.9.6 — hook that feeds the CONVERSATIONS tab exec-output panel.
// Exec-mode workers (codex exec, claude -p) write raw stdout/stderr to
// `.octogent/state/exec-output/<tid>.log` — before this hook those were
// invisible in the dashboard. See `apps/api/src/createApiServer/
// execOutputRoutes.ts` for the backend.
//
// Behaviors:
//   - `entries` is refreshed on-demand (manual `refresh()`) + once on
//     `enabled` flip. No polling by default — exec logs are append-only
//     and operators hit refresh when they want a fresh listing.
//   - `loadContent(terminalId)` fetches the raw log; result lives in
//     `selectedContent`. Setting `selectedTerminalId` to null clears it.
//   - Errors surfaced via `error` string. No retry loop (same rationale
//     as the S39 doctrine — retries mask persistent failures).

export type ExecOutputEntry = {
  terminalId: string;
  bytes: number;
  mtime: string;
};

export type UseExecOutputsResult = {
  entries: ExecOutputEntry[];
  selectedTerminalId: string | null;
  selectedContent: string;
  isLoadingEntries: boolean;
  isLoadingContent: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  selectTerminal: (terminalId: string | null) => Promise<void>;
};

export const useExecOutputs = ({ enabled }: { enabled: boolean }): UseExecOutputsResult => {
  const [entries, setEntries] = useState<ExecOutputEntry[]>([]);
  const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(null);
  const [selectedContent, setSelectedContent] = useState<string>("");
  const [isLoadingEntries, setIsLoadingEntries] = useState(false);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setIsLoadingEntries(true);
    setError(null);
    try {
      const response = await fetch(buildExecOutputsListUrl());
      if (!response.ok) {
        throw new Error(`GET /api/exec-outputs failed: HTTP ${response.status}`);
      }
      const data = (await response.json()) as { entries?: ExecOutputEntry[] };
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load exec outputs");
      setEntries([]);
    } finally {
      setIsLoadingEntries(false);
    }
  }, [enabled]);

  const selectTerminal = useCallback(
    async (terminalId: string | null) => {
      setSelectedTerminalId(terminalId);
      setSelectedContent("");
      if (terminalId === null) return;
      setIsLoadingContent(true);
      setError(null);
      try {
        const response = await fetch(buildExecOutputItemUrl(terminalId));
        if (!response.ok) {
          throw new Error(
            `GET /api/exec-outputs/${terminalId} failed: HTTP ${response.status}`,
          );
        }
        const text = await response.text();
        setSelectedContent(text);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load exec log");
        setSelectedContent("");
      } finally {
        setIsLoadingContent(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  return {
    entries,
    selectedTerminalId,
    selectedContent,
    isLoadingEntries,
    isLoadingContent,
    error,
    refresh,
    selectTerminal,
  };
};
