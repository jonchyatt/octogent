import { useCallback, useEffect, useRef, useState } from "react";

import type { DeckTentacleSummary } from "@octogent/core";
import type { ConversationSessionSummary, TentacleView } from "../types";
import type { GraphEdge, GraphNode } from "../canvas/types";
import { buildConversationsUrl, buildDeckTentaclesUrl } from "../../runtime/runtimeEndpoints";
import { normalizeConversationSessionSummary } from "../normalizers";

const TENTACLE_RADIUS = 40;
const ACTIVE_SESSION_RADIUS = 12;
const INACTIVE_SESSION_RADIUS = 10;

// Obsidian-style palette: teals, cyans, yellows, greens
const NODE_COLORS = [
  "#00b8d4",
  "#4dd0e1",
  "#66bb6a",
  "#cddc39",
  "#26c6da",
  "#81c784",
  "#aed581",
  "#ffee58",
  "#4db6ac",
  "#7986cb",
];

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

const tentacleColor = (tentacleId: string, deckColor: string | null | undefined) =>
  deckColor && deckColor.length > 0
    ? deckColor
    : (NODE_COLORS[hashString(tentacleId) % NODE_COLORS.length] as string);

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

type DeckTentacleMinimal = Pick<DeckTentacleSummary, "tentacleId" | "displayName" | "color">;

export const useCanvasGraphData = ({
  columns,
  enabled,
}: UseCanvasGraphDataOptions): UseCanvasGraphDataResult => {
  const [deckTentacles, setDeckTentacles] = useState<DeckTentacleMinimal[]>([]);
  const [inactiveSessions, setInactiveSessions] = useState<ConversationSessionSummary[]>([]);
  const prevNodesRef = useRef<Map<string, GraphNode>>(new Map());

  const fetchDeckTentacles = useCallback(async () => {
    try {
      const response = await fetch(buildDeckTentaclesUrl(), {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return;
      const payload = (await response.json()) as unknown;
      if (!Array.isArray(payload)) return;
      const items: DeckTentacleMinimal[] = payload
        .filter(
          (t: unknown): t is { tentacleId: string; displayName: string; color: string | null } =>
            t !== null &&
            typeof t === "object" &&
            typeof (t as Record<string, unknown>).tentacleId === "string",
        )
        .map((t) => ({
          tentacleId: t.tentacleId,
          displayName: t.displayName ?? t.tentacleId,
          color: t.color ?? null,
        }));
      setDeckTentacles(items);
    } catch {
      // silent
    }
  }, []);

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
      setDeckTentacles([]);
      setInactiveSessions([]);
      return;
    }
    void fetchDeckTentacles();
    void fetchInactiveSessions();
  }, [enabled, fetchDeckTentacles, fetchInactiveSessions]);

  const activeAgentIds = new Set(
    columns.flatMap((col) => col.agents.map((agent) => agent.agentId)),
  );

  // Build a map of deck tentacles for color/label lookup
  const deckMap = new Map<string, DeckTentacleMinimal>();
  for (const dt of deckTentacles) {
    deckMap.set(dt.tentacleId, dt);
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const prevNodes = prevNodesRef.current;
  const seenTentacleIds = new Set<string>();

  // Merge: start with all deck tentacles, overlay active agent data from columns
  const activeTentacleMap = new Map(columns.map((col) => [col.tentacleId, col]));

  // Build tentacle list: all deck tentacles + any columns-only tentacles
  const allTentacleIds: string[] = [];
  for (const dt of deckTentacles) {
    allTentacleIds.push(dt.tentacleId);
    seenTentacleIds.add(dt.tentacleId);
  }
  for (const col of columns) {
    if (!seenTentacleIds.has(col.tentacleId)) {
      allTentacleIds.push(col.tentacleId);
      seenTentacleIds.add(col.tentacleId);
    }
  }

  const totalTentacles = allTentacleIds.length;

  for (let i = 0; i < allTentacleIds.length; i++) {
    const tentacleId = allTentacleIds[i]!;
    const tentacleNodeId = buildTentacleNodeId(tentacleId);
    const prev = prevNodes.get(tentacleNodeId);
    const deck = deckMap.get(tentacleId);
    const activeCol = activeTentacleMap.get(tentacleId);
    const color = tentacleColor(tentacleId, deck?.color);
    const label = deck?.displayName ?? activeCol?.tentacleName ?? tentacleId;

    const angle = (2 * Math.PI * i) / Math.max(totalTentacles, 1);
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
      tentacleId,
      label,
      color,
      workspaceMode: activeCol?.tentacleWorkspaceMode,
    };
    nodes.push(node);

    // Active agents from columns
    if (activeCol) {
      for (const agent of activeCol.agents) {
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
          tentacleId,
          label: agent.label || agent.agentId,
          color,
          sessionId: agent.agentId,
          agentState: agent.state,
        };
        nodes.push(sessionNode);
        edges.push({ source: tentacleNodeId, target: sessionNodeId });
      }
    }
  }

  // Inactive sessions from conversations
  for (const session of inactiveSessions) {
    if (!session.tentacleId || !seenTentacleIds.has(session.tentacleId)) continue;
    if (activeAgentIds.has(session.sessionId)) continue;

    const tentacleNodeId = buildTentacleNodeId(session.tentacleId);
    const sessionNodeId = buildInactiveSessionNodeId(session.sessionId);
    const prevSession = prevNodes.get(sessionNodeId);

    const parentNode = nodes.find((n) => n.id === tentacleNodeId);
    const parentX = parentNode?.x ?? 0;
    const parentY = parentNode?.y ?? 0;
    const color = tentacleColor(session.tentacleId, deckMap.get(session.tentacleId)?.color);
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
      color,
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
