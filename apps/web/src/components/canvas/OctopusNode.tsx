import { useMemo } from "react";

import type { GraphNode } from "../../app/canvas/types";
import {
  type OctopusAccessory,
  type OctopusAnimation,
  type OctopusExpression,
  OctopusGlyph,
} from "../EmptyOctopus";

const LINE_MAX = 22;

const splitLabel = (label: string): [string] | [string, string] => {
  if (label.length <= LINE_MAX) return [label];
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
  return [`${label.slice(0, LINE_MAX - 1)}…`, label.slice(LINE_MAX - 1, LINE_MAX * 2 - 2) + (label.length > LINE_MAX * 2 - 2 ? "…" : "")];
};

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
  animation: OctopusAnimation;
  expression: OctopusExpression;
  accessory: OctopusAccessory;
};

function deriveOctopusVisuals(tentacleId: string): OctopusVisuals {
  const rng = seededRandom(hashString(tentacleId));
  return {
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

const buildEdgePath = (
  cx: number,
  cy: number,
  tx: number,
  ty: number,
  targetRadius: number,
  edgeIndex: number,
  edgeCount: number,
): string => {
  const dx = tx - cx;
  const dy = ty - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return "";

  // Shorten the endpoint so the edge stops at the target node's border
  const shortenBy = targetRadius + 2;
  const endRatio = Math.max(0, (dist - shortenBy) / dist);
  const etx = cx + dx * endRatio;
  const ety = cy + dy * endRatio;

  // Curvature — perpendicular offset for quadratic Bézier control point
  // Single edges get a default curve; multi-edges fan out
  const curvature = edgeCount <= 1
    ? 0.3
    : ((edgeIndex / (edgeCount - 1)) - 0.5) * 2;
  const offsetRatio = 0.25 + edgeCount * 0.05;
  const baseOffset = Math.max(35, dist * offsetRatio);

  // Perpendicular to source→target direction (unit normal: -dy/dist, dx/dist)
  const offsetX = (-dy / dist) * curvature * baseOffset;
  const offsetY = (dx / dist) * curvature * baseOffset;
  const cpx = (cx + etx) / 2 + offsetX;
  const cpy = (cy + ety) / 2 + offsetY;

  return `M ${cx} ${cy} Q ${cpx} ${cpy} ${etx} ${ety}`;
};

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
  const isOctoboss = node.type === "octoboss";
  const lines = useMemo(() => splitLabel(node.label), [node.label]);
  const visuals = useMemo(
    () =>
      isOctoboss
        ? ({ animation: "sway", expression: "normal", accessory: "none" } as OctopusVisuals)
        : deriveOctopusVisuals(node.tentacleId),
    [node.tentacleId, isOctoboss],
  );
  const glyphScale = isOctoboss ? 6 : GLYPH_SCALE;
  const glyphW = Math.round(GLYPH_W * (glyphScale / GLYPH_SCALE));
  const glyphH = Math.round(GLYPH_H * (glyphScale / GLYPH_SCALE));
  const color = node.color;
  const edgeColor = "#C0C0C0";

  return (
    <g
      className={`canvas-node canvas-node--tentacle${isSelected ? " canvas-node--selected" : ""}`}
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
      style={{ cursor: "grab" }}
    >
      {/* Invisible hit area for pointer events */}
      <rect x={-glyphW / 2} y={-glyphH / 2} width={glyphW} height={glyphH} fill="transparent" />

      {/* Edges — light tint of parent color */}
      {connectedNodes.map((target, i) => (
        <path
          key={target.id}
          className="canvas-edge"
          d={buildEdgePath(0, 0, target.x - node.x, target.y - node.y, target.radius, i, connectedNodes.length)}
          fill="none"
          stroke={edgeColor}
          strokeWidth={1.5}
          strokeOpacity={1}
        />
      ))}

      {/* Selection ring */}
      {isSelected && (
        <circle r={glyphH / 2 + 4} fill="none" stroke="#ffffff" strokeWidth={1.5} opacity={0.5} />
      )}

      {/* Octopus glyph via foreignObject */}
      <foreignObject
        x={-glyphW / 2}
        y={-glyphH / 2}
        width={glyphW}
        height={glyphH}
        style={{ overflow: "visible", pointerEvents: "none" }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        >
          <OctopusGlyph
            {...(isOctoboss ? {} : { color })}
            animation={visuals.animation}
            expression={visuals.expression}
            accessory={visuals.accessory}
            scale={glyphScale}
          />
        </div>
      </foreignObject>

      {/* Label — always visible, up to two lines */}
      <text
        y={glyphH / 2 - 12}
        textAnchor="middle"
        className="canvas-node-label canvas-node-label--tentacle canvas-node-label--always"
        fill={isOctoboss ? "var(--accent-primary, #d4a017)" : "#faa32c"}
      >
        <tspan x="0" dy="0">{lines[0]}</tspan>
        {lines[1] && <tspan x="0" dy="1.2em">{lines[1]}</tspan>}
      </text>
    </g>
  );
};
