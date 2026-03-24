import { useMemo } from "react";

import type { GraphNode } from "../../app/canvas/types";
import {
  type OctopusAccessory,
  type OctopusAnimation,
  type OctopusExpression,
  OctopusGlyph,
} from "../EmptyOctopus";

// Match the Deck tab's color palette for consistent octopus appearance
const OCTOPUS_COLORS = [
  "#ff6b2b",
  "#ff2d6b",
  "#00ffaa",
  "#bf5fff",
  "#00c8ff",
  "#ffee00",
  "#39ff14",
  "#ff4df0",
  "#00fff7",
  "#ff9500",
];

const ANIMATIONS: OctopusAnimation[] = ["sway", "walk", "jog", "bounce", "float", "swim-up"];
const EXPRESSIONS: OctopusExpression[] = ["normal", "happy", "angry", "surprised"];
const ACCESSORIES: OctopusAccessory[] = ["none", "none", "long", "mohawk", "side-sweep", "curly"];

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

type OctopusVisuals = {
  color: string;
  animation: OctopusAnimation;
  expression: OctopusExpression;
  accessory: OctopusAccessory;
};

function deriveOctopusVisuals(tentacleId: string): OctopusVisuals {
  const rng = seededRandom(hashString(tentacleId));
  return {
    color: OCTOPUS_COLORS[hashString(tentacleId) % OCTOPUS_COLORS.length] as string,
    animation: ANIMATIONS[Math.floor(rng() * ANIMATIONS.length)] as OctopusAnimation,
    expression: EXPRESSIONS[Math.floor(rng() * EXPRESSIONS.length)] as OctopusExpression,
    accessory: ACCESSORIES[Math.floor(rng() * ACCESSORIES.length)] as OctopusAccessory,
  };
}

type OctopusNodeProps = {
  node: GraphNode;
  connectedNodes: GraphNode[];
  isSelected: boolean;
  onPointerDown: (e: React.PointerEvent, nodeId: string) => void;
  onClick: (nodeId: string) => void;
};

const buildArmPath = (cx: number, cy: number, tx: number, ty: number): string => {
  const dx = tx - cx;
  const dy = ty - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return "";

  const nx = -dy / dist;
  const ny = dx / dist;
  const curvature = dist * 0.2;

  const cp1x = cx + dx * 0.33 + nx * curvature;
  const cp1y = cy + dy * 0.33 + ny * curvature;
  const cp2x = cx + dx * 0.66 - nx * curvature * 0.5;
  const cp2y = cy + dy * 0.66 - ny * curvature * 0.5;

  return `M ${cx} ${cy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${tx} ${ty}`;
};

// OctopusGlyph at scale=4 produces an ~80×100px canvas
const GLYPH_SCALE = 4;
const GLYPH_W = 112;
const GLYPH_H = 120;

export const OctopusNode = ({
  node,
  connectedNodes,
  isSelected,
  onPointerDown,
  onClick,
}: OctopusNodeProps) => {
  const visuals = useMemo(() => deriveOctopusVisuals(node.tentacleId), [node.tentacleId]);

  return (
    <g
      className="canvas-node canvas-node--tentacle"
      transform={`translate(${node.x}, ${node.y})`}
      onPointerDown={(e) => {
        e.stopPropagation();
        onPointerDown(e, node.id);
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick(node.id);
      }}
      style={{ cursor: "grab" }}
    >
      {/* Arms to connected session nodes */}
      {connectedNodes.map((target) => (
        <path
          key={target.id}
          d={buildArmPath(0, 0, target.x - node.x, target.y - node.y)}
          fill="none"
          stroke={visuals.color}
          strokeWidth={2}
          strokeOpacity={0.5}
          strokeLinecap="round"
        />
      ))}

      {/* Selection ring */}
      {isSelected && (
        <ellipse
          cx={0}
          cy={0}
          rx={GLYPH_W / 2 + 4}
          ry={GLYPH_H / 2 + 4}
          fill="none"
          stroke="#faa32c"
          strokeWidth={2.5}
          strokeDasharray="6 3"
        />
      )}

      {/* Octopus glyph via foreignObject */}
      <foreignObject
        x={-GLYPH_W / 2}
        y={-GLYPH_H / 2}
        width={GLYPH_W}
        height={GLYPH_H}
        style={{ overflow: "visible", pointerEvents: "none" }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            height: "100%",
          }}
        >
          <OctopusGlyph
            color={visuals.color}
            animation={visuals.animation}
            expression={visuals.expression}
            accessory={visuals.accessory}
            scale={GLYPH_SCALE}
          />
        </div>
      </foreignObject>

      {/* Label */}
      <text
        y={GLYPH_H / 2 + 12}
        textAnchor="middle"
        className="canvas-node-label canvas-node-label--tentacle"
        fill="#c8cdd5"
      >
        {node.label.length > 18 ? `${node.label.slice(0, 16)}..` : node.label}
      </text>
    </g>
  );
};
