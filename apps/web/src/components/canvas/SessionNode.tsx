import type { GraphNode } from "../../app/canvas/types";

type SessionNodeProps = {
  node: GraphNode;
  isSelected: boolean;
  onPointerDown: (e: React.PointerEvent, nodeId: string) => void;
  onClick: (nodeId: string) => void;
};

export const SessionNode = ({ node, isSelected, onPointerDown, onClick }: SessionNodeProps) => {
  const isActive = node.type === "active-session";
  const isLive = isActive && node.agentState === "live";

  return (
    <g
      className={`canvas-node canvas-node--session${isActive ? " canvas-node--active" : " canvas-node--inactive"}`}
      transform={`translate(${node.x}, ${node.y})`}
      onPointerDown={(e) => {
        e.stopPropagation();
        onPointerDown(e, node.id);
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick(node.id);
      }}
      style={{ cursor: "pointer" }}
    >
      {/* Glow filter for active live sessions */}
      {isLive && (
        <circle
          r={node.radius + 6}
          fill="none"
          stroke="#4ade80"
          strokeWidth={2}
          strokeOpacity={0.3}
          className="canvas-session-glow"
        />
      )}

      {/* Main circle */}
      <circle
        r={node.radius}
        fill={isActive ? "#1a2e1a" : "#1a1a2e"}
        fillOpacity={isActive ? 0.8 : 0.4}
        stroke={isSelected ? "#faa32c" : isActive ? "#4ade80" : "#6b7280"}
        strokeWidth={isSelected ? 2.5 : 1.5}
        strokeDasharray={isActive ? "none" : "4 3"}
      />

      {/* State indicator for active */}
      {isActive && node.agentState && (
        <circle
          r={3}
          cx={node.radius * 0.6}
          cy={-node.radius * 0.6}
          fill={
            node.agentState === "live"
              ? "#4ade80"
              : node.agentState === "blocked"
                ? "#f87171"
                : node.agentState === "queued"
                  ? "#fbbf24"
                  : "#6b7280"
          }
        />
      )}

      {/* Label */}
      <text
        y={node.radius + 14}
        textAnchor="middle"
        className={`canvas-node-label canvas-node-label--session${isActive ? "" : " canvas-node-label--inactive"}`}
        fill={isActive ? "#a3b8a3" : "#6b7280"}
      >
        {node.label.length > 20 ? `${node.label.slice(0, 18)}..` : node.label}
      </text>
    </g>
  );
};
