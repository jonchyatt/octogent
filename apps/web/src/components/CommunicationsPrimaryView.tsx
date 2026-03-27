import { useCallback, useEffect, useRef, useState } from "react";

import { buildChannelMessagesUrl, buildTerminalSnapshotsUrl, buildTerminalsUrl } from "../runtime/runtimeEndpoints";
import type { AgentRuntimeState } from "./AgentStateBadge";
import { Terminal } from "./Terminal";

type ChannelMessage = {
  messageId: string;
  fromTerminalId: string;
  toTerminalId: string;
  content: string;
  timestamp: string;
  delivered: boolean;
};

type TerminalSnapshot = {
  terminalId: string;
  tentacleName: string;
};

type CommsAgent = {
  tentacleId: string;
  terminalId: string;
};

const POLL_INTERVAL_MS = 3_000;

const COMMS_INITIAL_PROMPT = `You are a parent agent in the Octogent communication channel sandbox.

Your terminal ID is available in the environment variable OCTOGENT_SESSION_ID.

You can create child agents and communicate with them using the Octogent CLI:

## Create a child terminal
\`\`\`bash
node bin/octogent terminal create --name "child-task-1" --initial-prompt "You are a child agent spawned by parent terminal $OCTOGENT_SESSION_ID. Your job is to respond to messages from your parent. To send a message back, run: node bin/octogent channel send $OCTOGENT_SESSION_ID \\"your reply here\\""
\`\`\`

## Send a message to a terminal
\`\`\`bash
node bin/octogent channel send <targetTerminalId> "your message" --from $OCTOGENT_SESSION_ID
\`\`\`

## List messages for a terminal
\`\`\`bash
node bin/octogent channel list <terminalId>
\`\`\`

Try it now: create a child agent, then send it a message. The child will receive the message when it becomes idle.
`;

export const CommunicationsPrimaryView = () => {
  const [agent, setAgent] = useState<CommsAgent | null>(null);
  const [agentState, setAgentState] = useState<AgentRuntimeState>("idle");
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [terminals, setTerminals] = useState<TerminalSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const initializedRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track terminal IDs that existed before the parent was created.
  const preExistingTerminalIdsRef = useRef<Set<string> | null>(null);

  const handleStateChange = useCallback((state: AgentRuntimeState) => {
    setAgentState(state);
  }, []);

  const createAgent = useCallback(async () => {
    try {
      setIsCreating(true);
      setError(null);

      // Snapshot current terminals so we can detect new ones later.
      try {
        const snap = await fetch(buildTerminalSnapshotsUrl());
        if (snap.ok) {
          const existing: TerminalSnapshot[] = await snap.json();
          preExistingTerminalIdsRef.current = new Set(existing.map((t) => t.terminalId));
        }
      } catch {
        preExistingTerminalIdsRef.current = new Set();
      }

      const response = await fetch(buildTerminalsUrl(), {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceMode: "shared",
          agentProvider: "claude-code",
          tentacleName: "comms-sandbox",
          initialPrompt: COMMS_INITIAL_PROMPT,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create terminal (${response.status})`);
      }

      const snapshot = (await response.json()) as {
        tentacleId?: string;
        terminalId?: string;
      };
      if (!snapshot.tentacleId) {
        throw new Error("Missing tentacleId in response");
      }

      const parentId = snapshot.terminalId ?? snapshot.tentacleId;
      // Also include the parent in the pre-existing set so it's shown as the parent, not a child.
      preExistingTerminalIdsRef.current?.add(parentId);

      setAgent({
        tentacleId: snapshot.tentacleId,
        terminalId: parentId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setIsCreating(false);
    }
  }, []);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    void createAgent();
  }, [createAgent]);

  // Poll channel messages and terminals.
  const fetchMessages = useCallback(async (terminalIds: string[]) => {
    const allMessages: ChannelMessage[] = [];
    for (const id of terminalIds) {
      try {
        const res = await fetch(buildChannelMessagesUrl(id));
        if (res.ok) {
          const data = await res.json();
          const msgs = data.messages ?? [];
          allMessages.push(...msgs);
        }
      } catch {
        // Skip failures for individual terminals.
      }
    }
    allMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    setMessages(allMessages);
  }, []);

  const fetchTerminals = useCallback(async () => {
    try {
      const res = await fetch(buildTerminalSnapshotsUrl());
      if (!res.ok) return [];
      const data: TerminalSnapshot[] = await res.json();
      setTerminals(data);
      return data.map((t) => t.terminalId);
    } catch {
      return [];
    }
  }, []);

  const refresh = useCallback(async () => {
    const ids = await fetchTerminals();
    if (ids.length > 0) {
      await fetchMessages(ids);
    }
  }, [fetchTerminals, fetchMessages]);

  useEffect(() => {
    void refresh();
    pollRef.current = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refresh]);

  const terminalLabel = (id: string) => {
    const t = terminals.find((t) => t.terminalId === id);
    return t?.tentacleName ?? id;
  };

  const formatTimestamp = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return ts;
    }
  };

  // Compute child terminals: any terminal that appeared after the parent was created.
  const childTerminals = terminals.filter((t) => {
    if (!preExistingTerminalIdsRef.current) return false;
    return !preExistingTerminalIdsRef.current.has(t.terminalId);
  });

  if (error && !agent) {
    return (
      <section className="communications-view" aria-label="Communications">
        <div className="communications-view__init-status">
          <p>Failed to initialize: {error}</p>
          <button type="button" onClick={() => void createAgent()}>
            Retry
          </button>
        </div>
      </section>
    );
  }

  if (!agent) {
    return (
      <section className="communications-view" aria-label="Communications">
        <div className="communications-view__init-status">
          <p>{isCreating ? "Initializing comms sandbox agent..." : "No agent"}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="communications-view" aria-label="Communications channel sandbox">
      <div className="communications-view__header">
        <h2>Communications Channel</h2>
        <div className="communications-view__header-info">
          <span className="communications-view__agent-id">{agent.terminalId}</span>
          <span className="communications-view__agent-state" data-state={agentState}>
            {agentState.toUpperCase()}
          </span>
          <span className="communications-view__count">
            {childTerminals.length} child{childTerminals.length !== 1 ? "ren" : ""}
          </span>
          <span className="communications-view__count">
            {messages.length} msg{messages.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      <div className="communications-view__body">
        <div className="communications-view__terminals">
          <div className="communications-view__terminal-col">
            <div className="communications-view__terminal-label">
              Parent &mdash; {agent.terminalId}
            </div>
            <div className="communications-view__terminal-embed">
              <Terminal
                terminalId={agent.terminalId}
                terminalLabel="Comms Sandbox — Parent Agent"
                onAgentRuntimeStateChange={handleStateChange}
              />
            </div>
          </div>

          {childTerminals.map((child) => (
            <div key={child.terminalId} className="communications-view__terminal-col">
              <div className="communications-view__terminal-label communications-view__terminal-label--child">
                Child &mdash; {child.tentacleName || child.terminalId}
              </div>
              <div className="communications-view__terminal-embed">
                <Terminal
                  terminalId={child.terminalId}
                  terminalLabel={`Child — ${child.tentacleName || child.terminalId}`}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="communications-view__panel">
          <div className="communications-view__panel-header">
            <h3>Channel Log</h3>
          </div>
          <div className="communications-view__log">
            {messages.length === 0 && (
              <div className="communications-view__empty">
                No channel messages yet.
              </div>
            )}
            {messages.map((m) => (
              <div
                key={m.messageId}
                className={`communications-view__message ${m.delivered ? "communications-view__message--delivered" : "communications-view__message--pending"}`}
              >
                <span className="communications-view__time">{formatTimestamp(m.timestamp)}</span>
                <span className="communications-view__from">
                  {terminalLabel(m.fromTerminalId) || "external"}
                </span>
                <span className="communications-view__arrow">&rarr;</span>
                <span className="communications-view__to">{terminalLabel(m.toTerminalId)}</span>
                <span className="communications-view__msg-status">
                  {m.delivered ? "[delivered]" : "[pending]"}
                </span>
                <span className="communications-view__content">{m.content}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
