import { useCallback, useEffect, useRef, useState } from "react";

import { buildTentacleRenameUrl, buildTentaclesUrl } from "../runtime/runtimeEndpoints";
import type { AgentRuntimeState } from "./AgentStateBadge";
import { TentacleTerminal } from "./TentacleTerminal";

type SandboxAgent = {
  tentacleId: string;
  terminalId: string;
};

type StateLogEntry = {
  state: AgentRuntimeState;
  timestamp: string;
};

const STATE_DESCRIPTIONS: Record<AgentRuntimeState, string> = {
  idle: "Agent is idle, waiting for a prompt.",
  processing: "Agent is actively processing a request.",
  waiting_for_permission: "Agent is asking for tool permission (Notification hook: permission_prompt).",
  waiting_for_user: "Agent needs user input (PreToolUse: AskUserQuestion or Notification: idle_prompt).",
};

const MAX_LOG_ENTRIES = 50;

export const StateSandboxPrimaryView = () => {
  const [agent, setAgent] = useState<SandboxAgent | null>(null);
  const [agentState, setAgentState] = useState<AgentRuntimeState>("idle");
  const [stateLog, setStateLog] = useState<StateLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const initializedRef = useRef(false);

  const handleStateChange = useCallback((state: AgentRuntimeState) => {
    setAgentState(state);
    setStateLog((prev) => {
      const entry: StateLogEntry = {
        state,
        timestamp: new Date().toISOString(),
      };
      const next = [entry, ...prev];
      if (next.length > MAX_LOG_ENTRIES) {
        next.length = MAX_LOG_ENTRIES;
      }
      return next;
    });
  }, []);

  const createAgent = useCallback(async () => {
    try {
      setIsCreating(true);
      setError(null);
      const response = await fetch(buildTentaclesUrl(), {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspaceMode: "shared",
          agentProvider: "claude-code",
          name: "state-sandbox",
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create tentacle (${response.status})`);
      }

      const snapshot = (await response.json()) as { tentacleId?: string };
      if (!snapshot.tentacleId) {
        throw new Error("Missing tentacleId in response");
      }

      setAgent({
        tentacleId: snapshot.tentacleId,
        terminalId: `${snapshot.tentacleId}-agent-1`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setIsCreating(false);
    }
  }, []);

  useEffect(() => {
    if (initializedRef.current) {
      return;
    }
    initializedRef.current = true;
    void createAgent();
  }, [createAgent]);

  const handleDelete = useCallback(async () => {
    if (!agent) return;
    try {
      await fetch(buildTentacleRenameUrl(agent.tentacleId), {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      setAgent(null);
      initializedRef.current = false;
    } catch {
      setError("Failed to delete agent");
    }
  }, [agent]);

  if (error && !agent) {
    return (
      <section className="state-sandbox-view" aria-label="State Sandbox">
        <div className="state-sandbox-status">
          <p>Failed to initialize: {error}</p>
          <button
            type="button"
            onClick={() => {
              void createAgent();
            }}
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  if (!agent) {
    return (
      <section className="state-sandbox-view" aria-label="State Sandbox">
        <div className="state-sandbox-status">
          <p>{isCreating ? "Initializing state sandbox agent..." : "No agent"}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="state-sandbox-view" aria-label="State Sandbox">
      <div className="state-sandbox-header">
        <span className="state-sandbox-title">State Detection Sandbox</span>
        <div className="state-sandbox-state-display">
          <span className="state-sandbox-state-label">Agent State:</span>
          <span className="state-sandbox-state-value" data-state={agentState}>
            {agentState.toUpperCase()}
          </span>
        </div>
      </div>
      <div className="state-sandbox-body">
        <div className="state-sandbox-terminal">
          <TentacleTerminal
            terminalId={agent.terminalId}
            terminalLabel="State Sandbox Agent"
            onDelete={() => {
              void handleDelete();
            }}
            onAgentRuntimeStateChange={handleStateChange}
          />
        </div>
        <div className="state-sandbox-panel">
          <div className="state-sandbox-panel-section">
            <h3 className="state-sandbox-panel-heading">Current State</h3>
            <div className="state-sandbox-current">
              <span className="state-sandbox-state-value state-sandbox-state-value--large" data-state={agentState}>
                {agentState.toUpperCase()}
              </span>
              <p className="state-sandbox-state-desc">{STATE_DESCRIPTIONS[agentState]}</p>
            </div>
          </div>
          <div className="state-sandbox-panel-section">
            <h3 className="state-sandbox-panel-heading">
              State Log <span className="state-sandbox-log-count">({stateLog.length})</span>
            </h3>
            <div className="state-sandbox-log">
              {stateLog.length === 0 && (
                <p className="state-sandbox-log-empty">No state changes yet.</p>
              )}
              {stateLog.map((entry, i) => (
                <div key={`${entry.timestamp}-${i}`} className="state-sandbox-log-entry">
                  <span className="state-sandbox-log-time">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="state-sandbox-state-value state-sandbox-state-value--compact" data-state={entry.state}>
                    {entry.state.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
