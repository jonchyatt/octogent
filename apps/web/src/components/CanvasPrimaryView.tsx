import { useCallback, useMemo, useState } from "react";

import type { GraphNode } from "../app/canvas/types";
import type { TentacleView } from "../app/types";
import { useCanvasGraphData } from "../app/hooks/useCanvasGraphData";
import { useCanvasTransform } from "../app/hooks/useCanvasTransform";
import { useForceSimulation } from "../app/hooks/useForceSimulation";
import { OctopusNode } from "./canvas/OctopusNode";
import { SessionNode } from "./canvas/SessionNode";
import { CanvasTerminalOverlay } from "./canvas/CanvasTerminalOverlay";

type CanvasPrimaryViewProps = {
  columns: TentacleView;
};

export const CanvasPrimaryView = ({ columns }: CanvasPrimaryViewProps) => {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [overlayNode, setOverlayNode] = useState<GraphNode | null>(null);
  const [dragNodeId, setDragNodeId] = useState<string | null>(null);

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

  const handleNodePointerDown = useCallback(
    (e: React.PointerEvent, nodeId: string) => {
      setDragNodeId(nodeId);
      pinNode(nodeId);
      (e.target as SVGElement).closest("svg")?.setPointerCapture(e.pointerId);
    },
    [pinNode],
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

      {/* Terminal overlay (HTML, positioned over SVG) */}
      {overlayNode && overlayScreen && (
        <CanvasTerminalOverlay
          node={overlayNode}
          screenX={overlayScreen.x + 20}
          screenY={overlayScreen.y - 200}
          onClose={handleCloseOverlay}
        />
      )}
    </section>
  );
};
