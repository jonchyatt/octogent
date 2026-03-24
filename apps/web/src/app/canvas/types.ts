import type { AgentState, TentacleWorkspaceMode } from "@octogent/core";

export type GraphNode = {
  id: string;
  type: "tentacle" | "active-session" | "inactive-session";
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned: boolean;
  radius: number;
  tentacleId: string;
  label: string;
  sessionId?: string;
  agentState?: AgentState;
  workspaceMode?: TentacleWorkspaceMode;
  firstPromptPreview?: string;
};

export type GraphEdge = {
  source: string;
  target: string;
};
