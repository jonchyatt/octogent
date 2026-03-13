import type { ConversationSessionDetail, ConversationSessionSummary } from "../app/types";
import { ActionButton } from "./ui/ActionButton";

type ConversationsPrimaryViewProps = {
  sessions: ConversationSessionSummary[];
  selectedSession: ConversationSessionDetail | null;
  isLoadingSessions: boolean;
  isLoadingSelectedSession: boolean;
  isExporting: boolean;
  isClearing: boolean;
  errorMessage: string | null;
  onRefresh: () => void;
  onClearAll: () => void;
  onExport: (format: "json" | "md") => void;
};

const formatTimestamp = (value: string | null) => {
  if (!value) {
    return "--";
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

export const ConversationsPrimaryView = ({
  sessions,
  selectedSession,
  isLoadingSessions,
  isLoadingSelectedSession,
  isExporting,
  isClearing,
  errorMessage,
  onRefresh,
  onClearAll,
  onExport,
}: ConversationsPrimaryViewProps) => (
  <section className="conversations-view" aria-label="Conversations primary view">
    <header className="conversations-header">
      <div className="conversations-header-copy">
        <h2>Conversations</h2>
        <p>Durable coding-agent history from transcript events.</p>
      </div>
      <div className="conversations-header-actions">
        <ActionButton
          aria-label="Refresh conversations"
          className="conversations-refresh"
          disabled={isLoadingSessions}
          onClick={onRefresh}
          size="dense"
          variant="accent"
        >
          {isLoadingSessions ? "Refreshing..." : "Refresh"}
        </ActionButton>
        <ActionButton
          aria-label="Clear all conversations"
          className="conversations-clear-all"
          disabled={sessions.length === 0 || isClearing}
          onClick={onClearAll}
          size="dense"
          variant="danger"
        >
          {isClearing ? "Clearing..." : "Clear All"}
        </ActionButton>
      </div>
    </header>

    {errorMessage ? <p className="conversations-error">{errorMessage}</p> : null}

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
              <li className="conversations-turn" data-role={turn.role} key={turn.turnId}>
                <header>
                  <span>{turn.role === "user" ? "User" : "Assistant"}</span>
                  <time dateTime={turn.startedAt}>{formatTimestamp(turn.startedAt)}</time>
                </header>
                <pre>{turn.content}</pre>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="conversations-empty">Select a conversation from the sidebar.</p>
      )}
    </section>
  </section>
);
