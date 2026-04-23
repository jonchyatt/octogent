import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { formatTimestamp } from "../app/formatTimestamp";
import { useConversationsRuntime } from "../app/hooks/useConversationsRuntime";
import { useExecOutputs } from "../app/hooks/useExecOutputs";
import { ClearAllConversationsDialog } from "./ClearAllConversationsDialog";
import { SidebarConversationsList } from "./SidebarConversationsList";
import { ActionButton } from "./ui/ActionButton";
import { MarkdownContent } from "./ui/MarkdownContent";

type ActiveTab = "transcripts" | "exec-outputs";

// Phase 10.9.6 — sub-tab inside the CONVERSATIONS view: interactive-mode
// transcripts (the original behavior) plus exec-mode worker output logs.
// Before this fix, exec-mode workers were operator-invisible: their
// stdout/stderr lived in `.octogent/state/exec-output/<tid>.log` and no
// UI surface exposed them. That's a direct blind spot for Octogent's
// main use case — running Codex swarms in exec mode where every worker
// fires a single turn and exits, leaving only the log behind.
const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

type ConversationsPrimaryViewProps = {
  enabled: boolean;
  onSidebarContent?: (content: ReactNode) => void;
  onActionPanel?: (content: ReactNode) => void;
};

export const ConversationsPrimaryView = ({
  enabled,
  onSidebarContent,
  onActionPanel,
}: ConversationsPrimaryViewProps) => {
  const {
    sessions,
    selectedSessionId,
    selectedSession,
    isLoadingSessions: isLoadingConversationSessions,
    isLoadingSelectedSession,
    isExporting,
    isClearing: isClearingConversations,
    isSearching: isSearchingConversations,
    searchQuery,
    searchHits: conversationsSearchHits,
    highlightedTurnId,
    errorMessage,
    selectSession,
    refreshSessions,
    clearAllSessions,
    deleteSession,
    exportSession,
    searchConversations,
    clearSearch: clearConversationsSearch,
    navigateToSearchHit: navigateToConversationSearchHit,
  } = useConversationsRuntime({ enabled });

  const [isPendingClearAll, setIsPendingClearAll] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("transcripts");

  const execOutputs = useExecOutputs({ enabled: enabled && activeTab === "exec-outputs" });

  const onDeleteSession = useCallback(() => {
    if (selectedSessionId) {
      void deleteSession(selectedSessionId);
    }
  }, [selectedSessionId, deleteSession]);

  const onExport = useCallback(
    (format: "json" | "md") => {
      if (!selectedSessionId) {
        return;
      }

      void exportSession(selectedSessionId, format).then((result) => {
        if (!result) {
          return;
        }

        const blob = new Blob([result.content], { type: result.contentType });
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = result.filename;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(objectUrl);
      });
    },
    [selectedSessionId, exportSession],
  );

  // Push sidebar content — Phase 10.9.6 adds a sub-tab switcher above the
  // transcripts list so operators can flip between interactive sessions
  // and exec-mode log entries without losing their selection.
  const tabSwitcher = (
    <div className="conversations-tab-switcher" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "transcripts"}
        className={`conversations-tab${activeTab === "transcripts" ? " conversations-tab--active" : ""}`}
        onClick={() => setActiveTab("transcripts")}
      >
        Transcripts
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "exec-outputs"}
        className={`conversations-tab${activeTab === "exec-outputs" ? " conversations-tab--active" : ""}`}
        onClick={() => setActiveTab("exec-outputs")}
      >
        Exec logs
        {execOutputs.entries.length > 0 ? ` (${execOutputs.entries.length})` : ""}
      </button>
    </div>
  );

  const transcriptsSidebar = (
    <SidebarConversationsList
      sessions={sessions}
      selectedSessionId={selectedSessionId}
      isLoadingSessions={isLoadingConversationSessions}
      isSearching={isSearchingConversations}
      searchQuery={searchQuery}
      searchHits={conversationsSearchHits}
      onSelectSession={selectSession}
      onRefresh={() => {
        void refreshSessions();
      }}
      onClearAll={() => {
        setIsPendingClearAll(true);
      }}
      onSearch={(query) => {
        void searchConversations(query);
      }}
      onClearSearch={clearConversationsSearch}
      onNavigateToHit={navigateToConversationSearchHit}
    />
  );

  const execOutputsSidebar = (
    <div className="exec-outputs-sidebar">
      <div className="exec-outputs-sidebar-header">
        <span className="exec-outputs-sidebar-title">Exec workers</span>
        <button
          type="button"
          className="exec-outputs-refresh"
          onClick={() => void execOutputs.refresh()}
          disabled={execOutputs.isLoadingEntries}
          aria-label="Refresh exec outputs"
        >
          ↻
        </button>
      </div>
      {execOutputs.error ? (
        <p className="exec-outputs-error">{execOutputs.error}</p>
      ) : null}
      {execOutputs.isLoadingEntries && execOutputs.entries.length === 0 ? (
        <p className="exec-outputs-empty">Loading…</p>
      ) : execOutputs.entries.length === 0 ? (
        <p className="exec-outputs-empty">No exec-mode workers yet.</p>
      ) : (
        <ul className="exec-outputs-list">
          {execOutputs.entries.map((entry) => (
            <li
              key={entry.terminalId}
              className={`exec-outputs-item${execOutputs.selectedTerminalId === entry.terminalId ? " exec-outputs-item--selected" : ""}`}
            >
              <button
                type="button"
                className="exec-outputs-item-button"
                onClick={() => void execOutputs.selectTerminal(entry.terminalId)}
              >
                <span className="exec-outputs-item-id">{entry.terminalId}</span>
                <span className="exec-outputs-item-meta">
                  {formatBytes(entry.bytes)} · {formatTimestamp(entry.mtime)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const sidebarContent = (
    <div className="conversations-sidebar-with-tabs">
      {tabSwitcher}
      {activeTab === "transcripts" ? transcriptsSidebar : execOutputsSidebar}
    </div>
  );

  useEffect(() => {
    onSidebarContent?.(sidebarContent);
    return () => onSidebarContent?.(null);
  });

  // Push action panel for clear-all dialog
  const actionPanelContent = isPendingClearAll ? (
    <ClearAllConversationsDialog
      sessionCount={sessions.length}
      isClearing={isClearingConversations}
      onCancel={() => {
        setIsPendingClearAll(false);
      }}
      onConfirm={() => {
        void clearAllSessions().then(() => {
          setIsPendingClearAll(false);
        });
      }}
    />
  ) : null;

  useEffect(() => {
    onActionPanel?.(actionPanelContent);
    return () => onActionPanel?.(null);
  });

  const isDeletingSession = false;
  const highlightedRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (highlightedTurnId && highlightedRef.current) {
      highlightedRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightedTurnId]);

  const execOutputsPane = activeTab === "exec-outputs" ? (
    <section className="conversations-transcript" aria-label="Exec worker log pane">
      {execOutputs.error ? (
        <p className="conversations-error">{execOutputs.error}</p>
      ) : null}
      {execOutputs.isLoadingContent ? (
        <p className="conversations-empty">Loading log…</p>
      ) : execOutputs.selectedTerminalId === null ? (
        <p className="conversations-empty">
          Select an exec worker from the sidebar to view its output log.
        </p>
      ) : (
        <>
          <header className="conversations-transcript-header">
            <div className="conversations-transcript-header-top">
              <h3>{execOutputs.selectedTerminalId} · exec-output log</h3>
            </div>
          </header>
          <pre className="exec-outputs-content">{execOutputs.selectedContent || "(empty log)"}</pre>
        </>
      )}
    </section>
  ) : null;

  return (
    <section className="conversations-view" aria-label="Conversations primary view">
      {errorMessage ? <p className="conversations-error">{errorMessage}</p> : null}
      {execOutputsPane}
      {activeTab === "transcripts" ? (
      <section className="conversations-transcript" aria-label="Conversation transcript pane">
        {isLoadingSelectedSession ? (
          <p className="conversations-empty">Loading conversation...</p>
        ) : selectedSession ? (
          <>
            <header className="conversations-transcript-header">
              <div className="conversations-transcript-header-top">
                <h3>{selectedSession.sessionId}</h3>
                <div className="conversations-transcript-header-actions">
                  <ActionButton
                    aria-label="Export conversation as JSON"
                    className="conversations-export"
                    disabled={isExporting}
                    onClick={() => {
                      onExport("json");
                    }}
                    size="dense"
                    variant="info"
                  >
                    {isExporting ? "Exporting..." : "Export JSON"}
                  </ActionButton>
                  <ActionButton
                    aria-label="Export conversation as Markdown"
                    className="conversations-export"
                    disabled={isExporting}
                    onClick={() => {
                      onExport("md");
                    }}
                    size="dense"
                    variant="info"
                  >
                    {isExporting ? "Exporting..." : "Export Markdown"}
                  </ActionButton>
                  <button
                    aria-label="Delete this conversation"
                    className="conversations-delete-btn"
                    disabled={isDeletingSession}
                    onClick={onDeleteSession}
                    type="button"
                  >
                    <svg
                      aria-hidden="true"
                      focusable="false"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 4h10" />
                      <path d="M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" />
                      <path d="M4.5 4l.5 9a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1l.5-9" />
                      <path d="M6.5 7v4" />
                      <path d="M9.5 7v4" />
                    </svg>
                  </button>
                </div>
              </div>
              <dl>
                <div>
                  <dt>Started</dt>
                  <dd>{formatTimestamp(selectedSession.startedAt)}</dd>
                </div>
                <div>
                  <dt>Ended</dt>
                  <dd>{formatTimestamp(selectedSession.endedAt)}</dd>
                </div>
                <div>
                  <dt>Events</dt>
                  <dd>{selectedSession.eventCount}</dd>
                </div>
              </dl>
            </header>
            <ol className="conversations-turn-list">
              {selectedSession.turns.map((turn) => (
                <li
                  className="conversations-turn"
                  data-role={turn.role}
                  data-highlighted={turn.turnId === highlightedTurnId ? "true" : undefined}
                  key={turn.turnId}
                  ref={turn.turnId === highlightedTurnId ? highlightedRef : undefined}
                >
                  <time className="conversations-turn-time" dateTime={turn.startedAt}>
                    {formatTimestamp(turn.startedAt)}
                  </time>
                  <MarkdownContent
                    content={turn.content}
                    className="conversations-turn-content"
                    {...(turn.turnId === highlightedTurnId && searchQuery.length > 0
                      ? { highlightTerm: searchQuery }
                      : {})}
                  />
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="conversations-empty">Select a conversation from the sidebar.</p>
        )}
      </section>
      ) : null}
    </section>
  );
};
