import { StatusBadge, type StatusBadgeTone } from "./ui/StatusBadge";

type AgentStateBadgeProps = {
  state: AgentRuntimeState;
};

export type AgentRuntimeState =
  | "idle"
  | "processing"
  | "waiting_for_permission"
  | "waiting_for_user";

export const isAgentRuntimeState = (value: unknown): value is AgentRuntimeState =>
  value === "idle" ||
  value === "processing" ||
  value === "waiting_for_permission" ||
  value === "waiting_for_user";

const stateLabel = (state: AgentRuntimeState): string => {
  switch (state) {
    case "waiting_for_permission":
      return "PERMISSION";
    case "waiting_for_user":
      return "WAITING";
    default:
      return state.toUpperCase();
  }
};

const stateTone = (state: AgentRuntimeState): StatusBadgeTone => {
  switch (state) {
    case "waiting_for_permission":
    case "waiting_for_user":
      return "warning";
    default:
      return state;
  }
};

export const AgentStateBadge = ({ state }: AgentStateBadgeProps) => (
  <StatusBadge className="terminal-state-badge" label={stateLabel(state)} tone={stateTone(state)} />
);
