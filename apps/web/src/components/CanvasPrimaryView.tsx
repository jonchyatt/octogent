import { useCallback, useMemo, useState } from "react";

import type { GraphNode } from "../app/canvas/types";
import type { TentacleView } from "../app/types";
import { useCanvasGraphData } from "../app/hooks/useCanvasGraphData";
import { useCanvasTransform } from "../app/hooks/useCanvasTransform";
import {
  useForceSimulation,
  DEFAULT_FORCE_PARAMS,
  type ForceParams,
} from "../app/hooks/useForceSimulation";
import { OctopusNode } from "./canvas/OctopusNode";
import { SessionNode } from "./canvas/SessionNode";
import { CanvasTerminalOverlay } from "./canvas/CanvasTerminalOverlay";

type CanvasPrimaryViewProps = {
  columns: TentacleView;
};

const PARAM_SLIDERS: {
  key: keyof ForceParams;
  label: string;
  min: number;
  max: number;
  step: number;
}[] = [
  { key: "repelStrength", label: "Repel", min: -500, max: 0, step: 5 },
  { key: "repelDistanceMax", label: "Repel range", min: 50, max: 800, step: 10 },
  { key: "linkDistance", label: "Link dist", min: 5, max: 300, step: 5 },
  { key: "linkStrength", label: "Link str", min: 0, max: 1, step: 0.05 },
  { key: "centerStrength", label: "Center", min: 0, max: 1, step: 0.05 },
  { key: "radialRadius", label: "Ring radius", min: 50, max: 500, step: 10 },
  { key: "radialStrength", label: "Ring str", min: 0, max: 1, step: 0.05 },
  { key: "collisionPadding", label: "Collision", min: 0, max: 40, step: 1 },
  { key: "velocityDecay", label: "Vel decay", min: 0, max: 1, step: 0.05 },
  { key: "alphaDecay", label: "Alpha decay", min: 0.001, max: 0.1, step: 0.001 },
];

export const CanvasPrimaryView = ({ columns }: CanvasPrimaryViewProps) => {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [overlayNode, setOverlayNode] = useState<GraphNode | null>(null);
  const [dragNodeId, setDragNodeId] = useState<string | null>(null);
  const [forceParams, setForceParams] = useState<ForceParams>({ ...DEFAULT_FORCE_PARAMS });
  const [showTuner, setShowTuner] = useState(false);

  const { nodes, edges } = useCanvasGraphData({ columns, enabled: true });

  const {
    transform,
    svgRef,
    handleWheel,
    handlePointerDown: handleCanvasPointerDown,
    handlePointerMove: handleCanvasPointerMove,
    handlePointerUp: handleCanvasPointerUp,
    screenToGraph,
    graphToScreen,
    zoomIn,
    zoomOut,
    fitAll,
  } = useCanvasTransform();

  const { simulatedNodes, pinNode, unpinNode, moveNode, reheat } = useForceSimulation({
    nodes,
    edges,
    centerX: 0,
    centerY: 0,
    params: forceParams,
  });

  const nodesById = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const n of simulatedNodes) {
      map.set(n.id, n);
    }
    return map;
  }, [simulatedNodes]);

  const handleNodePointerDown = useCallback(
    (e: React.PointerEvent, nodeId: string) => {
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

  const handleSvgPointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (dragNodeId) {
        unpinNode(dragNodeId);
        reheat();
        setDragNodeId(null);
        return;
      }
      handleCanvasPointerUp(e);
    },
    [dragNodeId, unpinNode, reheat, handleCanvasPointerUp],
  );

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      setSelectedNodeId(nodeId);
      const node = nodesById.get(nodeId);
      if (!node) return;

      if (node.type === "active-session" || node.type === "inactive-session") {
        const screen = graphToScreen(node.x, node.y);
        setOverlayNode({ ...node });
      }
    },
    [nodesById, graphToScreen],
  );

  const handleCloseOverlay = useCallback(() => {
    setOverlayNode(null);
  }, []);

  const handleSvgClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (e.target === e.currentTarget) {
      setSelectedNodeId(null);
    }
  }, []);

  // Separate tentacle and session nodes for render order
  const tentacleNodes = simulatedNodes.filter((n) => n.type === "tentacle");
  const sessionNodes = simulatedNodes.filter((n) => n.type !== "tentacle");

  // Compute overlay screen position
  const overlayScreen = overlayNode
    ? graphToScreen(
        nodesById.get(overlayNode.id)?.x ?? overlayNode.x,
        nodesById.get(overlayNode.id)?.y ?? overlayNode.y,
      )
    : null;

  return (
    <section className="canvas-view" aria-label="Canvas graph view">
      <svg
        ref={svgRef}
        className="canvas-svg"
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
              .filter((n): n is GraphNode => n !== undefined);

            return (
              <OctopusNode
                key={node.id}
                node={node}
                connectedNodes={connected}
                isSelected={selectedNodeId === node.id}
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

      {/* Zoom controls */}
      <div className="canvas-controls">
        <button
          type="button"
          className="canvas-control-btn"
          onClick={zoomIn}
          aria-label="Zoom in"
          title="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          className="canvas-control-btn"
          onClick={zoomOut}
          aria-label="Zoom out"
          title="Zoom out"
        >
          &minus;
        </button>
        <button
          type="button"
          className="canvas-control-btn canvas-control-btn--fit"
          onClick={() => {
            fitAll(simulatedNodes);
          }}
          aria-label="Show all"
          title="Show all"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
            <path d="M2 2h4v1.5H3.5V6H2V2Zm8 0h4v4h-1.5V3.5H10V2ZM2 10h1.5v2.5H6V14H2v-4Zm10 2.5V10h1.5v4h-4v-1.5H12Z" />
          </svg>
        </button>
      </div>

      {/* Terminal overlay (HTML, positioned over SVG) */}
      {overlayNode && overlayScreen && (
        <CanvasTerminalOverlay
          node={overlayNode}
          screenX={overlayScreen.x + 20}
          screenY={overlayScreen.y - 200}
          onClose={handleCloseOverlay}
        />
      )}

      {/* Force tuner toggle */}
      <button
        type="button"
        className="canvas-tuner-toggle"
        onClick={() => setShowTuner((v) => !v)}
        title="Tune forces"
      >
        {showTuner ? "\u2715" : "\u2699"}
      </button>

      {/* Force tuner panel */}
      {showTuner && (
        <div className="canvas-tuner">
          <div className="canvas-tuner-title">Force params</div>
          {PARAM_SLIDERS.map(({ key, label, min, max, step }) => (
            <label key={key} className="canvas-tuner-row">
              <span className="canvas-tuner-label">{label}</span>
              <input
                type="range"
                className="canvas-tuner-slider"
                min={min}
                max={max}
                step={step}
                value={forceParams[key]}
                onChange={(e) =>
                  setForceParams((prev) => ({ ...prev, [key]: Number(e.target.value) }))
                }
              />
              <span className="canvas-tuner-value">{forceParams[key]}</span>
            </label>
          ))}
          <button
            type="button"
            className="canvas-tuner-reset"
            onClick={() => setForceParams({ ...DEFAULT_FORCE_PARAMS })}
          >
            Reset
          </button>
        </div>
      )}
    </section>
  );
};
