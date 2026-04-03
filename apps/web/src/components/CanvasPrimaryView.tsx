import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { GraphNode } from "../app/canvas/types";
import { useCanvasGraphData } from "../app/hooks/useCanvasGraphData";
import { useCanvasTransform } from "../app/hooks/useCanvasTransform";
import { DEFAULT_FORCE_PARAMS, useForceSimulation } from "../app/hooks/useForceSimulation";
import type { PendingDeleteTerminal } from "../app/hooks/useTerminalMutations";
import type { TerminalView } from "../app/types";
import { DeleteTentacleDialog } from "./DeleteTentacleDialog";
import { CanvasTentaclePanel } from "./canvas/CanvasTentaclePanel";
import { CanvasTerminalColumn } from "./canvas/CanvasTerminalColumn";
import { DeleteAllTerminalsDialog } from "./canvas/DeleteAllTerminalsDialog";
import { OctopusNode } from "./canvas/OctopusNode";
import { SessionNode } from "./canvas/SessionNode";

type ContextMenuState =
  | { kind: "canvas"; x: number; y: number }
  | { kind: "tentacle"; x: number; y: number; tentacleId: string }
  | { kind: "octoboss"; x: number; y: number }
  | {
      kind: "active-session";
      x: number;
      y: number;
      nodeId: string;
      tentacleId: string;
      sessionId: string;
      label: string;
      workspaceMode?: string;
    };

type CanvasPrimaryViewProps = {
  columns: TerminalView;
  isUiStateHydrated?: boolean;
  canvasOpenTerminalIds?: string[];
  canvasOpenTentacleIds?: string[];
  canvasTerminalsPanelWidth?: number | null;
  onCanvasOpenTerminalIdsChange?: (ids: string[]) => void;
  onCanvasOpenTentacleIdsChange?: (ids: string[]) => void;
  onCanvasTerminalsPanelWidthChange?: (width: number | null) => void;
  onCreateAgent?: (tentacleId: string) => Promise<string | undefined> | void;
  onCreateTerminal?: () => Promise<string | undefined> | void;
  onCreateTentacle?: () => void;
  onSpawnSwarm?: (tentacleId: string) => Promise<void>;
  onOctobossAction?: (action: string) => Promise<string | undefined> | void;
  onNavigateToConversation?: (sessionId: string) => void;
  onDeleteActiveSession?: (
    terminalId: string,
    terminalName: string,
    workspaceMode?: string,
  ) => void;
  pendingDeleteTerminal?: PendingDeleteTerminal | null;
  isDeletingTerminalId?: string | null;
  onCancelDelete?: () => void;
  onConfirmDelete?: () => void;
  onTerminalRenamed?: ((terminalId: string, tentacleName: string) => void) | undefined;
  onTerminalActivity?: ((terminalId: string) => void) | undefined;
  onRefreshColumns?: () => void;
};

const CLICK_THRESHOLD = 5;
const GRAPH_MIN_WIDTH = 300;
const TERMINAL_MIN_WIDTH = 370;

export const CanvasPrimaryView = ({
  columns,
  isUiStateHydrated,
  canvasOpenTerminalIds,
  canvasOpenTentacleIds,
  canvasTerminalsPanelWidth: persistedTerminalsPanelWidth,
  onCanvasOpenTerminalIdsChange,
  onCanvasOpenTentacleIdsChange,
  onCanvasTerminalsPanelWidthChange,
  onCreateAgent,
  onCreateTerminal,
  onCreateTentacle,
  onSpawnSwarm,
  onOctobossAction,
  onNavigateToConversation,
  onDeleteActiveSession,
  pendingDeleteTerminal,
  isDeletingTerminalId,
  onCancelDelete,
  onConfirmDelete,
  onTerminalRenamed,
  onTerminalActivity,
  onRefreshColumns,
}: CanvasPrimaryViewProps) => {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isDeleteAllDialogOpen, setIsDeleteAllDialogOpen] = useState(false);
  const [openTerminals, setOpenTerminals] = useState<Map<string, GraphNode>>(new Map());
  const [openTentacles, setOpenTentacles] = useState<Map<string, GraphNode>>(new Map());
  const [dragNodeId, setDragNodeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [terminalsPanelWidth, setTerminalsPanelWidth] = useState<number | null>(null);
  const [pendingOpenAgentId, setPendingOpenAgentId] = useState<string | null>(null);
  const [hideIdleTerminals, setHideIdleTerminals] = useState(false);
  const hasHydratedTerminals = useRef(false);
  const hasHydratedTentacles = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const nodeClickedRef = useRef(false);
  const dividerDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const containerRef = useRef<HTMLElement>(null);
  const terminalsPanelRef = useRef<HTMLDivElement>(null);

  const { nodes, edges, refresh: refreshGraphData } = useCanvasGraphData({ columns, enabled: true });

  const {
    transform,
    isPanning,
    svgRef,
    handleWheel,
    handlePointerDown: handleCanvasPointerDown,
    handlePointerMove: handleCanvasPointerMove,
    handlePointerUp: handleCanvasPointerUp,
    screenToGraph,
    fitAll,
  } = useCanvasTransform();

  const { simulatedNodes, pinNode, unpinNode, moveNode, reheat } = useForceSimulation({
    nodes,
    edges,
    centerX: 0,
    centerY: 0,
  });

  const nodesById = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const n of simulatedNodes) {
      map.set(n.id, n);
    }
    return map;
  }, [simulatedNodes]);

  // Hydrate open terminals after a settling delay so all async data (columns,
  // graph nodes, simulation) has time to land before we attempt the lookup.
  const [isHydratingTerminals, setIsHydratingTerminals] = useState(false);

  useEffect(() => {
    if (hasHydratedTerminals.current) return;
    if (!isUiStateHydrated) return;
    if (!canvasOpenTerminalIds || canvasOpenTerminalIds.length === 0) {
      hasHydratedTerminals.current = true;
      return;
    }

    setIsHydratingTerminals(true);
    const timer = window.setTimeout(() => {
      setIsHydratingTerminals(false);
      hasHydratedTerminals.current = true;
    }, 800);

    return () => window.clearTimeout(timer);
  }, [isUiStateHydrated, canvasOpenTerminalIds]);

  // Once the settling timer fires, perform the actual hydration from the
  // simulation graph which should now be fully populated.
  useEffect(() => {
    if (isHydratingTerminals) return;
    if (!hasHydratedTerminals.current) return;
    if (openTerminals.size > 0) return;
    if (!canvasOpenTerminalIds || canvasOpenTerminalIds.length === 0) return;

    const restoredMap = new Map<string, GraphNode>();
    for (const nodeId of canvasOpenTerminalIds) {
      const node = nodesById.get(nodeId);
      if (node && node.type === "active-session") {
        restoredMap.set(nodeId, { ...node });
      }
    }
    if (restoredMap.size > 0) {
      setOpenTerminals(restoredMap);
    }

    if (persistedTerminalsPanelWidth != null && persistedTerminalsPanelWidth > 0) {
      setTerminalsPanelWidth(persistedTerminalsPanelWidth);
    }
  }, [
    isHydratingTerminals,
    canvasOpenTerminalIds,
    persistedTerminalsPanelWidth,
    nodesById,
  ]);

  // Persist open terminal IDs when they change
  useEffect(() => {
    if (!hasHydratedTerminals.current) return;
    onCanvasOpenTerminalIdsChange?.(Array.from(openTerminals.keys()));
  }, [openTerminals, onCanvasOpenTerminalIdsChange]);

  // Hydrate open tentacles from persisted IDs.
  // Gate on tentacle-type nodes being present (deck API fetch is async).
  const hasTentacleNodes = simulatedNodes.some((n) => n.type === "tentacle");
  useEffect(() => {
    if (hasHydratedTentacles.current) return;
    if (!isUiStateHydrated) return;
    if (!hasTentacleNodes) return;

    if (canvasOpenTentacleIds && canvasOpenTentacleIds.length > 0) {
      const restoredMap = new Map<string, GraphNode>();
      for (const nodeId of canvasOpenTentacleIds) {
        const node = nodesById.get(nodeId);
        if (node && (node.type === "tentacle" || node.type === "octoboss")) {
          restoredMap.set(nodeId, { ...node });
        }
      }
      if (restoredMap.size > 0) {
        setOpenTentacles(restoredMap);
      }
    }

    hasHydratedTentacles.current = true;
  }, [isUiStateHydrated, canvasOpenTentacleIds, hasTentacleNodes, nodesById]);

  // Persist open tentacle IDs when they change
  useEffect(() => {
    if (!hasHydratedTentacles.current) return;
    onCanvasOpenTentacleIdsChange?.(Array.from(openTentacles.keys()));
  }, [openTentacles, onCanvasOpenTentacleIdsChange]);

  // Persist terminals panel width only when user has explicitly dragged the divider
  useEffect(() => {
    if (!hasHydratedTerminals.current) return;
    if (terminalsPanelWidth == null) return;
    onCanvasTerminalsPanelWidthChange?.(terminalsPanelWidth);
  }, [terminalsPanelWidth, onCanvasTerminalsPanelWidthChange]);

  const handleNodePointerDown = useCallback(
    (e: React.PointerEvent, nodeId: string) => {
      if (e.button !== 0) return;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      setDragNodeId(nodeId);
      pinNode(nodeId);
      svgRef.current?.setPointerCapture(e.pointerId);
    },
    [pinNode, svgRef],
  );

  const handleSvgPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (dragNodeId) {
        const graphPos = screenToGraph(e.clientX, e.clientY);
        moveNode(dragNodeId, graphPos.x, graphPos.y);
        return;
      }
      handleCanvasPointerMove(e);
    },
    [dragNodeId, screenToGraph, moveNode, handleCanvasPointerMove],
  );

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      setSelectedNodeId(nodeId);
      const node = nodesById.get(nodeId);
      if (!node) return;

      if (node.type === "active-session") {
        setOpenTerminals((prev) => {
          const next = new Map(prev);
          if (next.has(nodeId)) {
            next.delete(nodeId);
          } else {
            next.set(nodeId, { ...node });
          }
          return next;
        });
      } else if (node.type === "tentacle" || node.type === "octoboss") {
        setOpenTentacles((prev) => {
          const next = new Map(prev);
          if (next.has(nodeId)) {
            next.delete(nodeId);
          } else {
            next.set(nodeId, { ...node });
          }
          return next;
        });
      } else if (node.type === "inactive-session" && node.sessionId) {
        onNavigateToConversation?.(node.sessionId);
      }
    },
    [nodesById, onNavigateToConversation],
  );

  const handleCloseTentacle = useCallback((nodeId: string) => {
    setOpenTentacles((prev) => {
      const next = new Map(prev);
      next.delete(nodeId);
      return next;
    });
    setSelectedNodeId((prev) => (prev === nodeId ? null : prev));
  }, []);

  const handleCloseTerminal = useCallback((nodeId: string) => {
    setOpenTerminals((prev) => {
      const next = new Map(prev);
      next.delete(nodeId);
      return next;
    });
    setSelectedNodeId((prev) => (prev === nodeId ? null : prev));
  }, []);

  // Divider drag handlers
  const handleDividerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      // Measure the actual rendered width of the terminals panel (works whether CSS- or inline-sized)
      const panelEl = (e.target as HTMLElement).nextElementSibling as HTMLElement | null;
      const currentWidth = panelEl?.clientWidth ?? terminalsPanelWidth ?? 600;
      dividerDragRef.current = { startX: e.clientX, startWidth: currentWidth };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [terminalsPanelWidth],
  );

  const handleDividerPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dividerDragRef.current;
    if (!drag) return;
    const containerWidth = containerRef.current?.clientWidth ?? 1200;
    // Dragging left → terminals grow, dragging right → terminals shrink
    const delta = drag.startX - e.clientX;
    const newWidth = Math.max(
      TERMINAL_MIN_WIDTH,
      Math.min(containerWidth - GRAPH_MIN_WIDTH - 6, drag.startWidth + delta),
    );
    setTerminalsPanelWidth(newWidth);
  }, []);

  const handleDividerPointerUp = useCallback(() => {
    dividerDragRef.current = null;
  }, []);

  // Convert vertical wheel to horizontal scroll only when hovering terminal headers
  useEffect(() => {
    const panel = terminalsPanelRef.current;
    if (!panel) return;
    const handler = (e: WheelEvent) => {
      const target = e.target as Element | null;
      if (!target?.closest(".canvas-terminal-column-header")) return;
      if (e.deltaY !== 0 && e.deltaX === 0) {
        e.preventDefault();
        panel.scrollLeft += e.deltaY;
      }
    };
    panel.addEventListener("wheel", handler, { passive: false });
    return () => panel.removeEventListener("wheel", handler);
  }, [openTerminals.size > 0]);

  const handleSvgPointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (dragNodeId) {
        const start = dragStartRef.current;
        const dx = start ? e.clientX - start.x : Number.POSITIVE_INFINITY;
        const dy = start ? e.clientY - start.y : Number.POSITIVE_INFINITY;
        const wasClick = Math.abs(dx) < CLICK_THRESHOLD && Math.abs(dy) < CLICK_THRESHOLD;

        unpinNode(dragNodeId);
        reheat();

        if (wasClick) {
          nodeClickedRef.current = true;
          handleNodeClick(dragNodeId);
        }

        setDragNodeId(null);
        dragStartRef.current = null;
        return;
      }
      handleCanvasPointerUp(e);
    },
    [dragNodeId, unpinNode, reheat, handleCanvasPointerUp, handleNodeClick],
  );

  const handleSvgClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (nodeClickedRef.current) {
      nodeClickedRef.current = false;
      return;
    }
    if (e.target === e.currentTarget) {
      setSelectedNodeId(null);
    }
  }, []);

  // Stable ref for nodesById so native listener always sees latest data
  const nodesByIdRef = useRef(nodesById);
  nodesByIdRef.current = nodesById;

  // Stable refs so the native listener always sees the latest callbacks
  const onNavigateRef = useRef(onNavigateToConversation);
  onNavigateRef.current = onNavigateToConversation;

  // Native contextmenu listener — must be native to reliably preventDefault
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const handler = (e: MouseEvent) => {
      let el = e.target as Element | null;
      let nodeId: string | null = null;
      while (el && el !== svg) {
        const id = el.getAttribute("data-node-id");
        if (id) {
          nodeId = id;
          break;
        }
        el = el.parentElement;
      }
      if (!nodeId) {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ kind: "canvas", x: e.clientX, y: e.clientY });
        return;
      }
      const node = nodesByIdRef.current.get(nodeId);
      if (!node) return;

      if (node.type === "octoboss") {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ kind: "octoboss", x: e.clientX, y: e.clientY });
        return;
      }

      if (node.type === "tentacle") {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({
          kind: "tentacle",
          x: e.clientX,
          y: e.clientY,
          tentacleId: node.tentacleId,
        });
        return;
      }

      if (node.type === "inactive-session" && node.sessionId) {
        e.preventDefault();
        e.stopPropagation();
        onNavigateRef.current?.(node.sessionId);
        return;
      }

      if (node.type === "active-session" && node.sessionId) {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({
          kind: "active-session",
          x: e.clientX,
          y: e.clientY,
          nodeId: node.id,
          tentacleId: node.tentacleId,
          sessionId: node.sessionId,
          label: node.label,
          ...(node.workspaceMode ? { workspaceMode: node.workspaceMode } : {}),
        });
      }
    };

    svg.addEventListener("contextmenu", handler);
    return () => svg.removeEventListener("contextmenu", handler);
  }, [svgRef]);

  const handleCreateAgent = useCallback(
    (tentacleId: string) => {
      if (!onCreateAgent) return;
      setContextMenu(null);
      const result = onCreateAgent(tentacleId);
      if (result && typeof result.then === "function") {
        void result.then((agentId) => {
          if (agentId) setPendingOpenAgentId(agentId);
        });
      }
    },
    [onCreateAgent],
  );

  const handleSpawnSwarm = useCallback(
    (tentacleId: string) => {
      setContextMenu(null);
      void onSpawnSwarm?.(tentacleId);
    },
    [onSpawnSwarm],
  );

  const handleOctobossAction = useCallback(
    (action: string) => {
      setContextMenu(null);
      const result = onOctobossAction?.(action);
      if (result && typeof result.then === "function") {
        void result.then((agentId) => {
          if (agentId) setPendingOpenAgentId(agentId);
        });
      }
    },
    [onOctobossAction],
  );

  // Auto-open terminal for newly created agent once it appears in the graph
  useEffect(() => {
    if (!pendingOpenAgentId) return;
    const nodeId = `a:${pendingOpenAgentId}`;
    const node = nodesById.get(nodeId);
    if (!node) return;
    setPendingOpenAgentId(null);
    setOpenTerminals((prev) => {
      const next = new Map(prev);
      next.set(nodeId, { ...node });
      return next;
    });
  }, [pendingOpenAgentId, nodesById]);

  // Separate tentacle and session nodes for render order
  const tentacleNodes = simulatedNodes.filter(
    (n) => n.type === "tentacle" || n.type === "octoboss",
  );
  const sessionNodes = simulatedNodes.filter((n) => {
    if (n.type === "tentacle" || n.type === "octoboss") return false;
    if (hideIdleTerminals && n.type === "inactive-session") return false;
    if (
      hideIdleTerminals &&
      n.type === "active-session" &&
      (n.agentState === "idle" || n.hasUserPrompt === false)
    )
      return false;
    return true;
  });

  const handleFitView = useCallback(() => {
    fitAll(simulatedNodes);
  }, [fitAll, simulatedNodes]);

  const handleRefresh = useCallback(() => {
    refreshGraphData();
  }, [refreshGraphData]);

  const hasPanels = isHydratingTerminals || openTerminals.size > 0 || openTentacles.size > 0;

  return (
    <section ref={containerRef} className="canvas-view" aria-label="Canvas graph view">
      <div className={`canvas-graph-panel${hasPanels ? " canvas-graph-panel--split" : ""}`}>
        <svg
          ref={svgRef}
          className={`canvas-svg${isPanning || dragNodeId ? " canvas-svg--panning" : ""}`}
          onWheel={handleWheel}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleSvgPointerMove}
          onPointerUp={handleSvgPointerUp}
          onClick={handleSvgClick}
        >
          <g
            transform={`translate(${transform.translateX}, ${transform.translateY}) scale(${transform.scale})`}
          >
            {/* Render tentacle nodes (with arms) first */}
            {tentacleNodes.map((node) => {
              const connected = edges
                .filter((e) => e.source === node.id)
                .map((e) => nodesById.get(e.target))
                .filter((n): n is GraphNode => {
                  if (!n) return false;
                  if (hideIdleTerminals && n.type === "inactive-session") return false;
                  if (
                    hideIdleTerminals &&
                    n.type === "active-session" &&
                    (n.agentState === "idle" || n.hasUserPrompt === false)
                  )
                    return false;
                  return true;
                });

              const selectedColor = selectedNodeId ? (nodesById.get(selectedNodeId)?.color ?? null) : null;

              return (
                <OctopusNode
                  key={node.id}
                  node={node}
                  connectedNodes={connected}
                  isSelected={selectedNodeId === node.id}
                  selectedNodeId={selectedNodeId}
                  selectedNodeColor={selectedColor}
                  onPointerDown={handleNodePointerDown}
                  onClick={handleNodeClick}
                />
              );
            })}

            {/* Render session nodes on top */}
            {sessionNodes.map((node) => (
              <SessionNode
                key={node.id}
                node={node}
                isSelected={selectedNodeId === node.id}
                onPointerDown={handleNodePointerDown}
                onClick={handleNodeClick}
              />
            ))}
          </g>
        </svg>

        {/* Canvas toolbar — top-left action buttons */}
        <div className="canvas-toolbar" role="toolbar" aria-label="Canvas actions">
          <button
            type="button"
            className="canvas-toolbar-btn"
            onClick={() => {
              const result = onCreateTerminal?.();
              if (result && typeof result.then === "function") {
                void result.then((agentId) => {
                  if (agentId) setPendingOpenAgentId(agentId);
                });
              }
            }}
          >
            <span className="canvas-toolbar-icon">&gt;_</span>
            <span className="canvas-toolbar-label">Terminal</span>
          </button>
          <button type="button" className="canvas-toolbar-btn" onClick={onCreateTentacle}>
            <span className="canvas-toolbar-icon">&#x2B21;</span>
            <span className="canvas-toolbar-label">Tentacle</span>
          </button>
          <div className="canvas-toolbar-separator" />
          <button type="button" className="canvas-toolbar-btn" onClick={handleFitView}>
            <span className="canvas-toolbar-icon">&#x2922;</span>
            <span className="canvas-toolbar-label">Fit</span>
          </button>
          <button type="button" className="canvas-toolbar-btn" onClick={handleRefresh}>
            <span className="canvas-toolbar-icon">&#x21BB;</span>
            <span className="canvas-toolbar-label">Refresh</span>
          </button>
          <div className="canvas-toolbar-separator" />
          <button
            type="button"
            className={`canvas-toolbar-btn${hideIdleTerminals ? " canvas-toolbar-btn--active" : ""}`}
            onClick={() => setHideIdleTerminals((prev) => !prev)}
          >
            <span className="canvas-toolbar-icon">&#x23F8;</span>
            <span className="canvas-toolbar-label">{hideIdleTerminals ? "Show Idle" : "Hide Idle"}</span>
          </button>
          <div className="canvas-toolbar-separator" />
          <button
            type="button"
            className="canvas-toolbar-btn canvas-toolbar-btn--danger"
            onClick={() => setIsDeleteAllDialogOpen(true)}
          >
            <span className="canvas-toolbar-icon">&#x2715;</span>
            <span className="canvas-toolbar-label">Delete All</span>
          </button>
        </div>
      </div>

      {hasPanels && (
        <>
          <div
            className="canvas-panel-divider"
            role="separator"
            aria-orientation="vertical"
            tabIndex={0}
            onPointerDown={handleDividerPointerDown}
            onPointerMove={handleDividerPointerMove}
            onPointerUp={handleDividerPointerUp}
          />
          <div
            ref={terminalsPanelRef}
            className="canvas-terminals-panel"
            style={
              terminalsPanelWidth != null ? { flex: `0 0 ${terminalsPanelWidth}px` } : undefined
            }
          >
            {Array.from(openTentacles.entries()).map(([nodeId, node]) => (
              <CanvasTentaclePanel
                key={nodeId}
                node={node}
                isFocused={selectedNodeId === nodeId}
                onClose={() => handleCloseTentacle(nodeId)}
                onFocus={() => setSelectedNodeId(nodeId)}
                onCreateAgent={(tentacleId) => {
                  handleCreateAgent(tentacleId);
                }}
                onSpawnSwarm={(tentacleId) => {
                  handleSpawnSwarm(tentacleId);
                }}
                onNavigateToConversation={onNavigateToConversation}
              />
            ))}
            {isHydratingTerminals && openTerminals.size === 0 && (
              <div className="canvas-terminal-skeleton">
                <div className="canvas-terminal-skeleton__header" />
                <div className="canvas-terminal-skeleton__body">
                  <div className="canvas-terminal-skeleton__line" style={{ width: "60%" }} />
                  <div className="canvas-terminal-skeleton__line" style={{ width: "80%" }} />
                  <div className="canvas-terminal-skeleton__line" style={{ width: "45%" }} />
                </div>
              </div>
            )}
            {Array.from(openTerminals.entries()).map(([nodeId, node]) => (
              <CanvasTerminalColumn
                key={nodeId}
                node={node}
                terminals={columns}
                isFocused={selectedNodeId === nodeId}
                onClose={() => handleCloseTerminal(nodeId)}
                onFocus={() => setSelectedNodeId(nodeId)}
                onTerminalRenamed={onTerminalRenamed}
                onTerminalActivity={onTerminalActivity}
              />
            ))}
          </div>
        </>
      )}

      {/* Context menu */}
      {contextMenu && (
        <>
          <div className="canvas-context-menu-backdrop" onClick={() => setContextMenu(null)} />
          <div
            className="canvas-context-menu"
            style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          >
            {contextMenu.kind === "canvas" && (
              <>
                <button
                  type="button"
                  className="canvas-context-menu-item"
                  onClick={() => {
                    setContextMenu(null);
                    onCreateTentacle?.();
                  }}
                >
                  <span className="canvas-context-menu-icon">&#x2B21;</span>
                  New Tentacle
                </button>
                <button
                  type="button"
                  className="canvas-context-menu-item"
                  onClick={() => {
                    setContextMenu(null);
                    const result = onCreateTerminal?.();
                    if (result && typeof result.then === "function") {
                      void result.then((agentId) => {
                        if (agentId) setPendingOpenAgentId(agentId);
                      });
                    }
                  }}
                >
                  <span className="canvas-context-menu-icon">&gt;_</span>
                  New Terminal
                </button>
              </>
            )}
            {contextMenu.kind === "tentacle" && (
              <>
                <button
                  type="button"
                  className="canvas-context-menu-item"
                  onClick={() => handleCreateAgent(contextMenu.tentacleId)}
                >
                  <span className="canvas-context-menu-icon">&gt;_</span>
                  Create new agent
                </button>
                <button
                  type="button"
                  className="canvas-context-menu-item"
                  onClick={() => handleSpawnSwarm(contextMenu.tentacleId)}
                >
                  <span className="canvas-context-menu-icon">&#x2263;</span>
                  Spawn Swarm
                </button>
              </>
            )}
            {contextMenu.kind === "octoboss" && (
              <>
                <button
                  type="button"
                  className="canvas-context-menu-item"
                  onClick={() => handleOctobossAction("octoboss-reorganize-todos")}
                >
                  <span className="canvas-context-menu-icon">&#x2611;</span>
                  Reorganize To-Do's
                </button>
                <button
                  type="button"
                  className="canvas-context-menu-item"
                  onClick={() => handleOctobossAction("octoboss-reorganize-tentacles")}
                >
                  <span className="canvas-context-menu-icon">&#x2B21;</span>
                  Reorganize Tentacles
                </button>
                <button
                  type="button"
                  className="canvas-context-menu-item"
                  onClick={() => handleOctobossAction("octoboss-clean-contexts")}
                >
                  <span className="canvas-context-menu-icon">&#x29BB;</span>
                  Clean Tentacle Contexts
                </button>
              </>
            )}
            {contextMenu.kind === "active-session" && (
              <button
                type="button"
                className="canvas-context-menu-item canvas-context-menu-item--danger"
                onClick={() => {
                  onDeleteActiveSession?.(
                    contextMenu.sessionId,
                    contextMenu.label,
                    contextMenu.workspaceMode,
                  );
                  setContextMenu(null);
                }}
              >
                <span className="canvas-context-menu-icon">&#x2715;</span>
                Delete
              </button>
            )}
          </div>
        </>
      )}

      {pendingDeleteTerminal && onCancelDelete && onConfirmDelete && (
        <div className="canvas-delete-dialog">
          <DeleteTentacleDialog
            pendingDeleteTerminal={pendingDeleteTerminal}
            isDeletingTerminalId={isDeletingTerminalId ?? null}
            onCancel={onCancelDelete}
            onConfirmDelete={onConfirmDelete}
          />
        </div>
      )}

      {isDeleteAllDialogOpen && (
        <div className="canvas-delete-dialog">
          <DeleteAllTerminalsDialog
            columns={columns}
            nodes={nodes}
            onCancel={() => setIsDeleteAllDialogOpen(false)}
            onDeleted={() => {
              setIsDeleteAllDialogOpen(false);
              setOpenTerminals(new Map());
              onRefreshColumns?.();
              refreshGraphData();
            }}
          />
        </div>
      )}
    </section>
  );
};
