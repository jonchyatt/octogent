import { useCallback, useEffect, useRef, useState } from "react";

import type { GraphEdge, GraphNode } from "../canvas/types";

const REPULSION_STRENGTH = 5000;
const MIN_DIST = 30;
const ATTRACTION_STRENGTH = 0.08;
const REST_LENGTH = 150;
const CENTER_GRAVITY = 0.01;
const DAMPING = 0.85;
const ALPHA_DECAY = 0.005;
const ALPHA_MIN = 0.01;
const TARGET_FPS = 30;
const FRAME_INTERVAL = 1000 / TARGET_FPS;

type UseForceSimulationOptions = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  centerX: number;
  centerY: number;
};

type UseForceSimulationResult = {
  simulatedNodes: GraphNode[];
  pinNode: (id: string) => void;
  unpinNode: (id: string) => void;
  moveNode: (id: string, x: number, y: number) => void;
  reheat: () => void;
};

export const useForceSimulation = ({
  nodes,
  edges,
  centerX,
  centerY,
}: UseForceSimulationOptions): UseForceSimulationResult => {
  const simNodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>(edges);
  const alphaRef = useRef(1.0);
  const rafRef = useRef<number | null>(null);
  const [snapshot, setSnapshot] = useState<GraphNode[]>(nodes);

  // Sync edges
  edgesRef.current = edges;

  // Reconcile nodes: keep positions for existing, add new ones
  useEffect(() => {
    const existingMap = new Map<string, GraphNode>();
    for (const n of simNodesRef.current) {
      existingMap.set(n.id, n);
    }

    const nextNodes: GraphNode[] = nodes.map((inputNode) => {
      const existing = existingMap.get(inputNode.id);
      if (existing) {
        return {
          ...inputNode,
          x: existing.x,
          y: existing.y,
          vx: existing.vx,
          vy: existing.vy,
          pinned: existing.pinned,
        };
      }
      return { ...inputNode };
    });

    simNodesRef.current = nextNodes;
    alphaRef.current = 1.0;
  }, [nodes]);

  const tick = useCallback(() => {
    const simNodes = simNodesRef.current;
    const simEdges = edgesRef.current;
    const alpha = alphaRef.current;

    if (alpha < ALPHA_MIN || simNodes.length === 0) return false;

    // Build edge lookup
    const edgeSourceTarget = simEdges.map((edge) => {
      const si = simNodes.findIndex((n) => n.id === edge.source);
      const ti = simNodes.findIndex((n) => n.id === edge.target);
      return { si, ti };
    });

    // Repulsion (all pairs)
    for (let i = 0; i < simNodes.length; i++) {
      const a = simNodes[i]!;
      if (a.pinned) continue;

      for (let j = i + 1; j < simNodes.length; j++) {
        const b = simNodes[j]!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distSq = Math.max(dx * dx + dy * dy, MIN_DIST * MIN_DIST);
        const force = (REPULSION_STRENGTH * alpha) / distSq;
        const dist = Math.sqrt(distSq);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        a.vx += fx;
        a.vy += fy;
        if (!b.pinned) {
          b.vx -= fx;
          b.vy -= fy;
        }
      }
    }

    // Attraction (edges)
    for (const { si, ti } of edgeSourceTarget) {
      if (si < 0 || ti < 0) continue;
      const source = simNodes[si]!;
      const target = simNodes[ti]!;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const force = ATTRACTION_STRENGTH * (dist - REST_LENGTH) * alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      if (!source.pinned) {
        source.vx += fx;
        source.vy += fy;
      }
      if (!target.pinned) {
        target.vx -= fx;
        target.vy -= fy;
      }
    }

    // Center gravity + damping + position update
    for (const node of simNodes) {
      if (node.pinned) continue;

      node.vx += (centerX - node.x) * CENTER_GRAVITY * alpha;
      node.vy += (centerY - node.y) * CENTER_GRAVITY * alpha;
      node.vx *= DAMPING;
      node.vy *= DAMPING;
      node.x += node.vx;
      node.y += node.vy;
    }

    alphaRef.current = Math.max(0, alpha - ALPHA_DECAY);
    return true;
  }, [centerX, centerY]);

  // Animation loop
  useEffect(() => {
    let lastFrameTime = 0;
    let running = true;

    const loop = (now: number) => {
      if (!running) return;

      if (now - lastFrameTime >= FRAME_INTERVAL) {
        lastFrameTime = now;
        const active = tick();
        setSnapshot([...simNodesRef.current]);
        if (!active) {
          rafRef.current = null;
          return;
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      running = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [tick]);

  const pinNode = useCallback((id: string) => {
    const node = simNodesRef.current.find((n) => n.id === id);
    if (node) node.pinned = true;
  }, []);

  const unpinNode = useCallback((id: string) => {
    const node = simNodesRef.current.find((n) => n.id === id);
    if (node) node.pinned = false;
  }, []);

  const moveNode = useCallback((id: string, x: number, y: number) => {
    const node = simNodesRef.current.find((n) => n.id === id);
    if (node) {
      node.x = x;
      node.y = y;
      node.vx = 0;
      node.vy = 0;
    }
  }, []);

  const reheat = useCallback(() => {
    alphaRef.current = 1.0;
    if (rafRef.current === null) {
      const loop = (now: number) => {
        const active = tick();
        setSnapshot([...simNodesRef.current]);
        if (!active) {
          rafRef.current = null;
          return;
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    }
  }, [tick]);

  return { simulatedNodes: snapshot, pinNode, unpinNode, moveNode, reheat };
};
