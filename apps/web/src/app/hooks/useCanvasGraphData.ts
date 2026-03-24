import { useCallback, useEffect, useRef, useState } from "react";

import type { ConversationSessionSummary, TentacleView } from "../types";
import type { GraphEdge, GraphNode } from "../canvas/types";
import { buildConversationsUrl } from "../../runtime/runtimeEndpoints";
import { normalizeConversationSessionSummary } from "../normalizers";

const TENTACLE_RADIUS = 40;
const ACTIVE_SESSION_RADIUS = 12;
const INACTIVE_SESSION_RADIUS = 10;

type UseCanvasGraphDataOptions = {
  columns: TentacleView;
  enabled: boolean;
};

type UseCanvasGraphDataResult = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

const buildTentacleNodeId = (tentacleId: string) => `t:${tentacleId}`;
const buildActiveSessionNodeId = (agentId: string) => `a:${agentId}`;
const buildInactiveSessionNodeId = (sessionId: string) => `i:${sessionId}`;

export const useCanvasGraphData = ({
  columns,
  enabled,
}: UseCanvasGraphDataOptions): UseCanvasGraphDataResult => {
  const [inactiveSessions, setInactiveSessions] = useState<ConversationSessionSummary[]>([]);
  const prevNodesRef = useRef<Map<string, GraphNode>>(new Map());

  const fetchInactiveSessions = useCallback(async () => {
    try {
      const response = await fetch(buildConversationsUrl(), {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) return;

      const payload = (await response.json()) as unknown;
      const normalized = Array.isArray(payload)
        ? payload
            .map((entry) => normalizeConversationSessionSummary(entry))
            .filter((entry): entry is ConversationSessionSummary => entry !== null)
        : [];
      setInactiveSessions(normalized);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setInactiveSessions([]);
      return;
    }
    void fetchInactiveSessions();
  }, [enabled, fetchInactiveSessions]);

  const activeAgentIds = new Set(
    columns.flatMap((col) => col.agents.map((agent) => agent.agentId)),
  );

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const prevNodes = prevNodesRef.current;

  const tentacleCount = columns.length;

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i]!;
    const tentacleNodeId = buildTentacleNodeId(col.tentacleId);
    const prev = prevNodes.get(tentacleNodeId);

    const angle = (2 * Math.PI * i) / Math.max(tentacleCount, 1);
    const spread = 200;

    const node: GraphNode = {
      id: tentacleNodeId,
      type: "tentacle",
      x: prev?.x ?? Math.cos(angle) * spread,
      y: prev?.y ?? Math.sin(angle) * spread,
      vx: prev?.vx ?? 0,
      vy: prev?.vy ?? 0,
      pinned: prev?.pinned ?? false,
      radius: TENTACLE_RADIUS,
      tentacleId: col.tentacleId,
      label: col.tentacleName,
      workspaceMode: col.tentacleWorkspaceMode,
    };
    nodes.push(node);

    for (let j = 0; j < col.agents.length; j++) {
      const agent = col.agents[j]!;
      const sessionNodeId = buildActiveSessionNodeId(agent.agentId);
      const prevSession = prevNodes.get(sessionNodeId);
      const jitter = () => (Math.random() - 0.5) * 60;

      const sessionNode: GraphNode = {
        id: sessionNodeId,
        type: "active-session",
        x: prevSession?.x ?? node.x + jitter(),
        y: prevSession?.y ?? node.y + jitter(),
        vx: prevSession?.vx ?? 0,
        vy: prevSession?.vy ?? 0,
        pinned: prevSession?.pinned ?? false,
        radius: ACTIVE_SESSION_RADIUS,
        tentacleId: col.tentacleId,
        label: agent.label || agent.agentId,
        sessionId: agent.agentId,
        agentState: agent.state,
      };
      nodes.push(sessionNode);
      edges.push({ source: tentacleNodeId, target: sessionNodeId });
    }
  }

  // Inactive sessions from conversations
  const tentacleIdSet = new Set(columns.map((col) => col.tentacleId));

  for (const session of inactiveSessions) {
    if (!session.tentacleId || !tentacleIdSet.has(session.tentacleId)) continue;

    // Skip if there's an active agent matching this session
    if (activeAgentIds.has(session.sessionId)) continue;

    const tentacleNodeId = buildTentacleNodeId(session.tentacleId);
    const sessionNodeId = buildInactiveSessionNodeId(session.sessionId);
    const prevSession = prevNodes.get(sessionNodeId);

    const parentNode = nodes.find((n) => n.id === tentacleNodeId);
    const parentX = parentNode?.x ?? 0;
    const parentY = parentNode?.y ?? 0;
    const jitter = () => (Math.random() - 0.5) * 60;

    const sessionNode: GraphNode = {
      id: sessionNodeId,
      type: "inactive-session",
      x: prevSession?.x ?? parentX + jitter(),
      y: prevSession?.y ?? parentY + jitter(),
      vx: prevSession?.vx ?? 0,
      vy: prevSession?.vy ?? 0,
      pinned: prevSession?.pinned ?? false,
      radius: INACTIVE_SESSION_RADIUS,
      tentacleId: session.tentacleId,
      label: session.firstUserTurnPreview
        ? session.firstUserTurnPreview.slice(0, 40)
        : session.sessionId.slice(0, 12),
      sessionId: session.sessionId,
      ...(session.firstUserTurnPreview !== null
        ? { firstPromptPreview: session.firstUserTurnPreview }
        : {}),
    };
    nodes.push(sessionNode);
    edges.push({ source: tentacleNodeId, target: sessionNodeId });
  }

  // Update position cache
  const nextMap = new Map<string, GraphNode>();
  for (const n of nodes) {
    nextMap.set(n.id, n);
  }
  prevNodesRef.current = nextMap;

  return { nodes, edges };
};
