import { useEffect, useRef } from "react";
import type { OctopusExpression } from "./EmptyOctopus";

/*
 * Isometric 3/4 top-down octopus rendered via Canvas 2D.
 * Matches the projection style used in the Office Room scene
 * but as a standalone, reusable asset.
 *
 * The octopus is modeled as:
 *   - 3 tentacle pairs (z = 0 → 3)
 *   - Lower body box (z = 3 → 6)
 *   - Upper dome tapered inward (z = 6 → 9)
 *   - Eyes on the front face
 *   - Expression variants (normal, happy, sleepy, angry, surprised)
 */

// ─── Projection helpers ──────────────────────────────────────────────────────

type Vec3 = [number, number, number];

function makeProjection(ox: number, oy: number, s: number) {
  const toSx = (x: number, y: number) => ((x - y) * 2 + ox) * s;
  const toSy = (x: number, y: number, z: number) => (x + y - z * 2 + oy) * s;
  return { toSx, toSy };
}

// ─── Drawing primitives ──────────────────────────────────────────────────────

function drawFace(
  ctx: CanvasRenderingContext2D,
  pts: Vec3[],
  col: string,
  toSx: (x: number, y: number) => number,
  toSy: (x: number, y: number, z: number) => number,
) {
  if (pts.length === 0) return;
  const p0 = pts[0] as Vec3;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(toSx(p0[0], p0[1]), toSy(p0[0], p0[1], p0[2]));
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i] as Vec3;
    ctx.lineTo(toSx(p[0], p[1]), toSy(p[0], p[1], p[2]));
  }
  ctx.closePath();
  ctx.fill();
}

// ─── Color utilities ─────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((c) =>
      Math.max(0, Math.min(255, Math.round(c)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** Darken a hex color by a factor (0 = black, 1 = original). */
function darken(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * factor, g * factor, b * factor);
}

/** Lighten a hex color toward white by a factor (0 = original, 1 = white). */
function lighten(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * factor, g + (255 - g) * factor, b + (255 - b) * factor);
}

// ─── Isometric octopus model ─────────────────────────────────────────────────
// All coordinates in "sprite pixels" — the projection scales them to canvas px.
//
// Body origin at (0, 0). Body is 6 wide (x), 5 deep (y).
// Tentacles hang below (z = 0–3), body fills z = 3–6, dome tapers z = 6–9.

const BODY_W = 6;
const BODY_D = 5;

// Tentacle geometry
const TENT_H = 3;
const TENT_W = 1.2;
const TENT_D = 1.2;
const TENT_XS = [0.5, BODY_W / 2 - TENT_W / 2, BODY_W - TENT_W - 0.5];

// Dome taper at top
const TAPER = 0.8;

// ─── Drawing the octopus ────────────────────────────────────────────────────

type DrawOpts = {
  ctx: CanvasRenderingContext2D;
  ox: number; // origin x in sprite-pixel space
  oy: number; // origin y in sprite-pixel space
  s: number; // canvas pixels per sprite pixel
  color: string;
  expression: OctopusExpression;
  tentacleOffsets?: number[]; // per-tentacle z offsets for animation
};

function drawOctopus(opts: DrawOpts) {
  const { ctx, ox, oy, s, color, expression, tentacleOffsets } = opts;
  const { toSx, toSy } = makeProjection(ox, oy, s);
  const face = (pts: Vec3[], col: string) => drawFace(ctx, pts, col, toSx, toSy);

  // Derived shading colors
  const cLeft = color; // left face — base color
  const cFront = darken(color, 0.82); // front face — slightly darker
  const cRight = darken(color, 0.65); // right face — darker
  const cTop = lighten(color, 0.15); // top face — lighter

  // ── Tentacles (z = 0 → 3) ──
  for (let i = 0; i < TENT_XS.length; i++) {
    const tx = TENT_XS[i] as number;
    const ty = BODY_D / 2 - TENT_D / 2;
    const zOff = tentacleOffsets?.[i] ?? 0;
    const z0 = zOff;
    const z1 = TENT_H + zOff;

    // Left face
    face(
      [
        [tx, ty + TENT_D, z0],
        [tx, ty, z0],
        [tx, ty, z1],
        [tx, ty + TENT_D, z1],
      ],
      darken(color, 0.75),
    );
    // Front face
    face(
      [
        [tx, ty, z0],
        [tx + TENT_W, ty, z0],
        [tx + TENT_W, ty, z1],
        [tx, ty, z1],
      ],
      darken(color, 0.65),
    );
    // Right face
    face(
      [
        [tx + TENT_W, ty, z0],
        [tx + TENT_W, ty + TENT_D, z0],
        [tx + TENT_W, ty + TENT_D, z1],
        [tx + TENT_W, ty, z1],
      ],
      darken(color, 0.55),
    );
    // Top cap
    face(
      [
        [tx, ty, z1],
        [tx + TENT_W, ty, z1],
        [tx + TENT_W, ty + TENT_D, z1],
        [tx, ty + TENT_D, z1],
      ],
      color,
    );
  }

  // ── Lower body (z = 3 → 6) ──
  // Left
  face(
    [
      [0, BODY_D, 3],
      [0, 0, 3],
      [0, 0, 6],
      [0, BODY_D, 6],
    ],
    cLeft,
  );
  // Front
  face(
    [
      [0, 0, 3],
      [BODY_W, 0, 3],
      [BODY_W, 0, 6],
      [0, 0, 6],
    ],
    cFront,
  );
  // Right
  face(
    [
      [BODY_W, 0, 3],
      [BODY_W, BODY_D, 3],
      [BODY_W, BODY_D, 6],
      [BODY_W, 0, 6],
    ],
    cRight,
  );

  // ── Upper dome (z = 6 → 9, tapered inward) ──
  const tp = TAPER;
  // Left
  face(
    [
      [0, BODY_D, 6],
      [0, 0, 6],
      [tp, tp, 9],
      [tp, BODY_D - tp, 9],
    ],
    cLeft,
  );
  // Front
  face(
    [
      [0, 0, 6],
      [BODY_W, 0, 6],
      [BODY_W - tp, tp, 9],
      [tp, tp, 9],
    ],
    cFront,
  );
  // Right
  face(
    [
      [BODY_W, 0, 6],
      [BODY_W, BODY_D, 6],
      [BODY_W - tp, BODY_D - tp, 9],
      [BODY_W - tp, tp, 9],
    ],
    cRight,
  );
  // Top
  face(
    [
      [tp, tp, 9],
      [BODY_W - tp, tp, 9],
      [BODY_W - tp, BODY_D - tp, 9],
      [tp, BODY_D - tp, 9],
    ],
    cTop,
  );

  // ── Expression details (drawn on front face, y = 0) ──
  drawExpression(face, expression);
}

// ─── Expressions ─────────────────────────────────────────────────────────────

function drawExpression(face: (pts: Vec3[], col: string) => void, expression: OctopusExpression) {
  switch (expression) {
    case "normal":
      drawNormalEyes(face);
      break;
    case "happy":
      drawHappyEyes(face);
      drawHappyMouth(face);
      break;
    case "sleepy":
      drawSleepyEyes(face);
      break;
    case "angry":
      drawAngryEyes(face);
      drawAngryMouth(face);
      drawAngryBrows(face);
      break;
    case "surprised":
      drawSurprisedEyes(face);
      drawSurprisedMouth(face);
      break;
  }
}

// Normal — two 1.2×1.5 rectangles on front face
function drawNormalEyes(face: (pts: Vec3[], col: string) => void) {
  face(
    [
      [1, 0, 6],
      [2.2, 0, 6],
      [2.2, 0, 7.5],
      [1, 0, 7.5],
    ],
    "#000000",
  );
  face(
    [
      [BODY_W - 2.2, 0, 6],
      [BODY_W - 1, 0, 6],
      [BODY_W - 1, 0, 7.5],
      [BODY_W - 2.2, 0, 7.5],
    ],
    "#000000",
  );
}

// Happy — curved upward eyes (^_^): narrow bottom slit
function drawHappyEyes(face: (pts: Vec3[], col: string) => void) {
  // Arched eyes — thinner at top, wider at bottom, shifted up
  face(
    [
      [1, 0, 7],
      [2.2, 0, 7],
      [2.2, 0, 7.5],
      [1, 0, 7.5],
    ],
    "#000000",
  );
  face(
    [
      [BODY_W - 2.2, 0, 7],
      [BODY_W - 1, 0, 7],
      [BODY_W - 1, 0, 7.5],
      [BODY_W - 2.2, 0, 7.5],
    ],
    "#000000",
  );
  // Upper lid hints
  face(
    [
      [1.2, 0, 7.5],
      [2, 0, 7.5],
      [2, 0, 7.8],
      [1.2, 0, 7.8],
    ],
    "#000000",
  );
  face(
    [
      [BODY_W - 2, 0, 7.5],
      [BODY_W - 1.2, 0, 7.5],
      [BODY_W - 1.2, 0, 7.8],
      [BODY_W - 2, 0, 7.8],
    ],
    "#000000",
  );
}

function drawHappyMouth(face: (pts: Vec3[], col: string) => void) {
  // Small upward curve (smile)
  face(
    [
      [2.2, 0, 5.2],
      [3.8, 0, 5.2],
      [3.8, 0, 5.6],
      [2.2, 0, 5.6],
    ],
    "#000000",
  );
  face(
    [
      [2, 0, 5.6],
      [2.4, 0, 5.6],
      [2.4, 0, 5.8],
      [2, 0, 5.8],
    ],
    "#000000",
  );
  face(
    [
      [3.6, 0, 5.6],
      [4, 0, 5.6],
      [4, 0, 5.8],
      [3.6, 0, 5.8],
    ],
    "#000000",
  );
}

// Sleepy — heavy eyelids (half-closed rectangles)
function drawSleepyEyes(face: (pts: Vec3[], col: string) => void) {
  // Closed eyelids — wider dark bar
  face(
    [
      [1, 0, 6.8],
      [2.2, 0, 6.8],
      [2.2, 0, 7.3],
      [1, 0, 7.3],
    ],
    "#000000",
  );
  face(
    [
      [BODY_W - 2.2, 0, 6.8],
      [BODY_W - 1, 0, 6.8],
      [BODY_W - 1, 0, 7.3],
      [BODY_W - 2.2, 0, 7.3],
    ],
    "#000000",
  );
  // Tiny pupils peeking below
  face(
    [
      [1.4, 0, 6.4],
      [1.8, 0, 6.4],
      [1.8, 0, 6.8],
      [1.4, 0, 6.8],
    ],
    "#000000",
  );
  face(
    [
      [BODY_W - 1.8, 0, 6.4],
      [BODY_W - 1.4, 0, 6.4],
      [BODY_W - 1.4, 0, 6.8],
      [BODY_W - 1.8, 0, 6.8],
    ],
    "#000000",
  );
}

// Angry — narrowed eyes with diagonal brow lines
function drawAngryEyes(face: (pts: Vec3[], col: string) => void) {
  face(
    [
      [1, 0, 6.2],
      [2.2, 0, 6.2],
      [2.2, 0, 7.2],
      [1, 0, 7.2],
    ],
    "#000000",
  );
  face(
    [
      [BODY_W - 2.2, 0, 6.2],
      [BODY_W - 1, 0, 6.2],
      [BODY_W - 1, 0, 7.2],
      [BODY_W - 2.2, 0, 7.2],
    ],
    "#000000",
  );
}

function drawAngryBrows(face: (pts: Vec3[], col: string) => void) {
  // Left brow — angled down toward center
  face(
    [
      [0.6, 0, 8],
      [2.4, 0, 7.4],
      [2.4, 0, 7.8],
      [0.6, 0, 8.4],
    ],
    "#000000",
  );
  // Right brow — mirrored
  face(
    [
      [BODY_W - 2.4, 0, 7.4],
      [BODY_W - 0.6, 0, 8],
      [BODY_W - 0.6, 0, 8.4],
      [BODY_W - 2.4, 0, 7.8],
    ],
    "#000000",
  );
}

function drawAngryMouth(face: (pts: Vec3[], col: string) => void) {
  // Narrow snarl
  face(
    [
      [2.4, 0, 5],
      [3.6, 0, 5],
      [3.6, 0, 5.5],
      [2.4, 0, 5.5],
    ],
    "#000000",
  );
}

// Surprised — tall round eyes + small O mouth
function drawSurprisedEyes(face: (pts: Vec3[], col: string) => void) {
  // Taller eyes (3-row equivalent)
  face(
    [
      [1, 0, 5.8],
      [2.2, 0, 5.8],
      [2.2, 0, 7.8],
      [1, 0, 7.8],
    ],
    "#000000",
  );
  face(
    [
      [BODY_W - 2.2, 0, 5.8],
      [BODY_W - 1, 0, 5.8],
      [BODY_W - 1, 0, 7.8],
      [BODY_W - 2.2, 0, 7.8],
    ],
    "#000000",
  );
  // Highlight in each eye (white glint)
  face(
    [
      [1.2, 0, 7.2],
      [1.6, 0, 7.2],
      [1.6, 0, 7.6],
      [1.2, 0, 7.6],
    ],
    "#ffffff",
  );
  face(
    [
      [BODY_W - 1.6, 0, 7.2],
      [BODY_W - 1.2, 0, 7.2],
      [BODY_W - 1.2, 0, 7.6],
      [BODY_W - 1.6, 0, 7.6],
    ],
    "#ffffff",
  );
}

function drawSurprisedMouth(face: (pts: Vec3[], col: string) => void) {
  // Small O mouth
  face(
    [
      [2.6, 0, 4.8],
      [3.4, 0, 4.8],
      [3.4, 0, 5.5],
      [2.6, 0, 5.5],
    ],
    "#000000",
  );
}

// ─── ZZZ overlay for sleepy expression ───────────────────────────────────────

function drawIsoZZZ(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  s: number,
  phase: number,
) {
  if (phase >= 3) return; // phases 3-4 are blank

  const { toSx, toSy } = makeProjection(ox, oy, s);
  ctx.fillStyle = "#7ec8e3";

  // Z glyphs floating above the octopus, rendered as small iso quads
  const drawZ = (bx: number, bz: number, size: number) => {
    // Top bar
    drawFace(
      ctx,
      [
        [bx, 0, bz + size],
        [bx + size, 0, bz + size],
        [bx + size, 0, bz + size - 0.3],
        [bx, 0, bz + size - 0.3],
      ],
      "#7ec8e3",
      toSx,
      toSy,
    );
    // Diagonal
    drawFace(
      ctx,
      [
        [bx + size - 0.3, 0, bz + size - 0.3],
        [bx + size, 0, bz + size - 0.3],
        [bx + 0.3, 0, bz + 0.3],
        [bx, 0, bz + 0.3],
      ],
      "#7ec8e3",
      toSx,
      toSy,
    );
    // Bottom bar
    drawFace(
      ctx,
      [
        [bx, 0, bz + 0.3],
        [bx + size, 0, bz + 0.3],
        [bx + size, 0, bz],
        [bx, 0, bz],
      ],
      "#7ec8e3",
      toSx,
      toSy,
    );
  };

  // Z1 — lowest, near right
  drawZ(BODY_W + 0.5, 9.5, 1.5);

  if (phase >= 1) {
    // Z2 — middle height
    drawZ(BODY_W + 1.5, 11, 1.2);
  }
  if (phase >= 2) {
    // Z3 — highest
    drawZ(BODY_W + 0.8, 12.5, 1.0);
  }
}

// ─── Animation ──────────────────────────────────────────────────────────────

export type IsometricOctopusAnimation = "idle" | "breathe" | "bounce" | "wave";

function buildTentacleOffsets(animation: IsometricOctopusAnimation, frame: number): number[] {
  switch (animation) {
    case "breathe": {
      // Gentle up/down with slight phase offset per tentacle
      const offsets = [0, 0.15, 0.3];
      return offsets.map((off) => Math.sin(frame * 0.15 + off * Math.PI * 2) * 0.3);
    }
    case "bounce": {
      // All tentacles compress/extend together
      const bounce = Math.abs(Math.sin(frame * 0.2)) * 0.6;
      return [bounce, bounce, bounce];
    }
    case "wave": {
      // Sequential wave across tentacles
      return [
        Math.sin(frame * 0.18) * 0.5,
        Math.sin(frame * 0.18 + Math.PI * 0.66) * 0.5,
        Math.sin(frame * 0.18 + Math.PI * 1.33) * 0.5,
      ];
    }
    default:
      return [0, 0, 0];
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export type IsometricOctopusProps = {
  /** Animation mode. Default: "breathe". */
  animation?: IsometricOctopusAnimation;
  /** Facial expression. Default: "normal". */
  expression?: OctopusExpression;
  /** Canvas pixels per sprite pixel. Default: 8. */
  scale?: number;
  /** Body color override. Defaults to CSS --accent-primary. */
  color?: string;
  className?: string;
  testId?: string;
};

// Canvas dimensions in sprite-pixel units
const SCENE_W = 20; // enough for body + ZZZ overflow
const SCENE_H = 18; // enough for tentacles below + dome top

export const IsometricOctopus = ({
  animation = "breathe",
  expression = "normal",
  scale = 8,
  color,
  className,
  testId,
}: IsometricOctopusProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const zzzPhaseRef = useRef(0);

  const canvasW = SCENE_W * 2 * scale; // iso doubles the x-spread
  const canvasH = SCENE_H * 2 * scale;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.imageSmoothingEnabled = false;

    const accentColor =
      color ??
      (getComputedStyle(document.documentElement).getPropertyValue("--accent-primary").trim() ||
        "#d4a017");

    // Origin places the octopus centered in the canvas
    const ox = SCENE_W / 2 + 2;
    const oy = SCENE_H / 2 + 2;

    const render = () => {
      ctx.clearRect(0, 0, canvasW, canvasH);

      const tentOffsets = buildTentacleOffsets(animation, frameRef.current);

      drawOctopus({
        ctx,
        ox,
        oy,
        s: scale,
        color: accentColor,
        expression,
        tentacleOffsets: tentOffsets,
      });

      if (expression === "sleepy") {
        drawIsoZZZ(ctx, ox, oy, scale, zzzPhaseRef.current);
      }
    };

    render();

    if (animation === "idle" && expression !== "sleepy") return;

    const id = setInterval(
      () => {
        frameRef.current += 1;
        if (expression === "sleepy") {
          // Cycle ZZZ every 5 frames
          if (frameRef.current % 5 === 0) {
            zzzPhaseRef.current = (zzzPhaseRef.current + 1) % 5;
          }
        }
        render();
      },
      animation === "idle" ? 350 : 60,
    );

    return () => clearInterval(id);
  }, [animation, expression, color, scale, canvasW, canvasH]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      width={canvasW}
      height={canvasH}
      data-testid={testId}
      aria-hidden="true"
    />
  );
};
