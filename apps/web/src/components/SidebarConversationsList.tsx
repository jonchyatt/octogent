import type { ConversationSessionSummary } from "../app/types";

type SidebarConversationsListProps = {
  sessions: ConversationSessionSummary[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
};

export const SidebarConversationsList = ({
  sessions,
  selectedSessionId,
  onSelectSession,
}: SidebarConversationsListProps) => (
  <section className="active-agents-section" aria-label="Sidebar section Conversations">
    <div className="active-agents-section-panel">
      {sessions.length === 0 ? (
        <p className="active-agents-status">No conversations yet.</p>
      ) : (
        <ol className="sidebar-conversations-list">
          {sessions.map((session) => (
            <li key={session.sessionId}>
              <button
                aria-current={session.sessionId === selectedSessionId ? "page" : undefined}
                className="sidebar-conversation-item"
                data-active={session.sessionId === selectedSessionId ? "true" : "false"}
                onClick={() => {
                  onSelectSession(session.sessionId);
                }}
                type="button"
              >
                <strong>{session.sessionId}</strong>
                <span>{`Tentacle ${session.tentacleId ?? "--"}`}</span>
                <span>{`${session.turnCount} turns`}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  </section>
);
