import { ActionButton } from "./ui/ActionButton";

type ConsoleHeaderProps = {
  isAgentsSidebarVisible: boolean;
  onToggleAgentsSidebar: () => void;
  normalizedTicker: string;
  activeNavLabel: string;
  backendLivenessStatus: "live" | "offline";
  isCreatingTentacle: boolean;
  onCreateSharedTentacle: () => void;
  onCreateWorktreeTentacle: () => void;
};

export const ConsoleHeader = ({
  isAgentsSidebarVisible,
  onToggleAgentsSidebar,
  normalizedTicker,
  activeNavLabel,
  backendLivenessStatus,
  isCreatingTentacle,
  onCreateSharedTentacle,
  onCreateWorktreeTentacle,
}: ConsoleHeaderProps) => (
  <header className="chrome">
    <div className="chrome-left">
      <button
        aria-label={
          isAgentsSidebarVisible ? "Hide Active Agents sidebar" : "Show Active Agents sidebar"
        }
        className="chrome-sidebar-toggle"
        data-active={isAgentsSidebarVisible ? "true" : "false"}
        onClick={onToggleAgentsSidebar}
        type="button"
      >
        <svg
          aria-hidden="true"
          className="chrome-sidebar-toggle-icon"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect
            fill="none"
            height="12"
            stroke="currentColor"
            strokeWidth="1.5"
            width="12"
            x="2"
            y="2"
          />
          <rect height="12" width="6" x="2" y="2" />
        </svg>
      </button>
      <h1>Octogent Terminal</h1>
    </div>

    <div className="chrome-brand">{`${normalizedTicker} | ${activeNavLabel.toUpperCase()}`}</div>

    <div className="chrome-right">
      <span className="console-live-indicator" data-live-state={backendLivenessStatus}>
        <span
          className="console-live-dot"
          data-live-state={backendLivenessStatus}
          aria-hidden="true"
        />
        {backendLivenessStatus === "live" ? "LIVE" : "OFFLINE"}
      </span>
      <ActionButton
        aria-label="Create tentacle in main codebase"
        className="chrome-create-tentacle chrome-create-tentacle--shared"
        disabled={isCreatingTentacle}
        onClick={onCreateSharedTentacle}
        size="dense"
        variant="primary"
      >
        {isCreatingTentacle ? "Creating..." : "+ Main Tentacle"}
      </ActionButton>
      <ActionButton
        aria-label="Create tentacle with isolated worktree"
        className="chrome-create-tentacle chrome-create-tentacle--worktree"
        disabled={isCreatingTentacle}
        onClick={onCreateWorktreeTentacle}
        size="dense"
        variant="info"
      >
        {isCreatingTentacle ? "Creating..." : "+ Worktree Tentacle"}
      </ActionButton>
    </div>
  </header>
);
