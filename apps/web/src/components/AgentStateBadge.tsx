import { StatusBadge } from "./ui/StatusBadge";

type AgentStateBadgeProps = {
  state: AgentRuntimeState;
};

export type AgentRuntimeState = "idle" | "processing";

export const isAgentRuntimeState = (value: unknown): value is AgentRuntimeState =>
  value === "idle" || value === "processing";

export const AgentStateBadge = ({ state }: AgentStateBadgeProps) => (
  <StatusBadge className="terminal-state-badge" label={state.toUpperCase()} tone={state} />
);
