import { useCallback, useState } from "react";

import type { GraphNode } from "../../app/canvas/types";
import type { TerminalView } from "../../app/types";
import { type AgentRuntimeState, AgentStateBadge } from "../AgentStateBadge";
import { Terminal } from "../Terminal";

type CanvasTerminalColumnProps = {
  node: GraphNode;
  terminals: TerminalView;
  isFocused?: boolean;
  onClose: () => void;
  onFocus?: () => void;
};

export const CanvasTerminalColumn = ({
  node,
  terminals,
  isFocused,
  onClose,
  onFocus,
}: CanvasTerminalColumnProps) => {
  const [agentState, setAgentState] = useState<AgentRuntimeState>("idle");

  const terminal = terminals.find((t) => t.tentacleId === node.tentacleId);
  const tentacleName = terminal?.tentacleName ?? node.tentacleId;
  const workspaceMode = terminal?.workspaceMode ?? "shared";

  const handleFocus = useCallback(() => {
    onFocus?.();
  }, [onFocus]);

  if (!node.sessionId) return null;

  return (
    <section
      className={`canvas-terminal-column${isFocused ? " canvas-terminal-column--focused" : ""}`}
      onPointerDown={handleFocus}
      onFocusCapture={handleFocus}
    >
      <div className="canvas-terminal-column-header">
        <div className="canvas-terminal-column-heading">
          <h2>
            <span className="canvas-terminal-column-name">{tentacleName}</span>
            {workspaceMode === "worktree" && (
              <span className="canvas-terminal-column-badge">WT</span>
            )}
          </h2>
        </div>
        <div className="canvas-terminal-column-actions">
          <span className="canvas-terminal-column-tentacle-tag" style={{ background: node.color }}>
            {node.tentacleId}
          </span>
          <AgentStateBadge state={agentState} />
          <button
            type="button"
            className="canvas-terminal-column-close"
            onClick={onClose}
            aria-label="Close terminal"
          >
            &times;
          </button>
        </div>
      </div>
      <div className="canvas-terminal-column-body">
        <Terminal
          terminalId={node.sessionId}
          terminalLabel={node.label}
          onAgentRuntimeStateChange={setAgentState}
        />
      </div>
    </section>
  );
};
