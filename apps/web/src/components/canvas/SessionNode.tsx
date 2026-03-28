import { useMemo } from "react";

import type { GraphNode } from "../../app/canvas/types";

const LINE_MAX = 24;

const splitLabel = (label: string): [string] | [string, string] => {
  if (label.length <= LINE_MAX) return [label];
  // Try to break at a space near the midpoint
  const mid = Math.floor(label.length / 2);
  let best = -1;
  for (let i = 0; i < label.length; i++) {
    if (label[i] === " " && (best === -1 || Math.abs(i - mid) < Math.abs(best - mid))) {
      best = i;
    }
  }
  if (best > 0 && best < label.length - 1) {
    const line1 = label.slice(0, best);
    let line2 = label.slice(best + 1);
    if (line2.length > LINE_MAX) line2 = `${line2.slice(0, LINE_MAX - 1)}…`;
    return [line1.length > LINE_MAX ? `${line1.slice(0, LINE_MAX - 1)}…` : line1, line2];
  }
  return [label.slice(0, LINE_MAX - 1) + "…", label.slice(LINE_MAX - 1, LINE_MAX * 2 - 2) + (label.length > LINE_MAX * 2 - 2 ? "…" : "")];
};

type SessionNodeProps = {
  node: GraphNode;
  isSelected: boolean;
  onPointerDown: (e: React.PointerEvent, nodeId: string) => void;
  onClick: (nodeId: string) => void;
};

export const SessionNode = ({ node, isSelected, onPointerDown, onClick }: SessionNodeProps) => {
  const isActive = node.type === "active-session";
  const isLive = isActive && node.agentState === "live";
  const color = isActive ? node.color : "#9ca3af";
  const lines = useMemo(() => splitLabel(node.label), [node.label]);

  return (
    <g
      className={`canvas-node canvas-node--session${isSelected ? " canvas-node--selected" : ""}${isActive ? " canvas-node--active" : " canvas-node--inactive"}`}
      data-node-id={node.id}
      transform={`translate(${node.x}, ${node.y})`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onPointerDown(e, node.id);
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick(node.id);
      }}
      style={{ cursor: "pointer" }}
    >
      {/* Focused shine — white glow behind everything */}
      {isSelected && (
        <circle className="canvas-node-focus-glow" r={node.radius + 12} fill="#ffffff" />
      )}

      {/* Subtle glow halo */}
      <circle
        className={`canvas-node-bloom${isLive ? " canvas-node-bloom--pulse" : ""}`}
        r={node.radius + 3}
        fill={color}
        opacity={isActive ? 0.25 : 0.1}
      />

      {/* Bright core dot */}
      <circle
        className="canvas-node-core"
        r={node.radius}
        fill={color}
        opacity={isActive ? 1 : 0.4}
      />

      {/* Label — always visible, up to two lines */}
      <text
        y={node.radius + 16}
        textAnchor="middle"
        className="canvas-node-label canvas-node-label--session canvas-node-label--always"
        fill="var(--accent-primary)"
      >
        <tspan x="0" dy="0">{lines[0]}</tspan>
        {lines[1] && <tspan x="0" dy="1.2em">{lines[1]}</tspan>}
      </text>
    </g>
  );
};
