import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";

import type { GraphEdge, GraphNode } from "../canvas/types";

export type ForceParams = {
  repelStrength: number;
  repelDistanceMax: number;
  linkDistance: number;
  linkStrength: number;
  centerStrength: number;
  radialRadius: number;
  radialStrength: number;
  collisionPadding: number;
  velocityDecay: number;
  alphaDecay: number;
};

export const DEFAULT_FORCE_PARAMS: ForceParams = {
  repelStrength: -95,
  repelDistanceMax: 150,
  linkDistance: 50,
  linkStrength: 0.6,
  centerStrength: 0.45,
  radialRadius: 100,
  radialStrength: 0.15,
  collisionPadding: 16,
  velocityDecay: 0.4,
  alphaDecay: 0.0228,
};

const ALPHA_MIN = 0.001;
const ALPHA_TARGET = 0;
const REHEAT_ALPHA = 0.8;

type SimNode = SimulationNodeDatum & { _gn: GraphNode };
type SimLink = SimulationLinkDatum<SimNode>;

type UseForceSimulationOptions = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  centerX: number;
  centerY: number;
  params?: ForceParams;
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
  params = DEFAULT_FORCE_PARAMS,
}: UseForceSimulationOptions): UseForceSimulationResult => {
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const simNodeMapRef = useRef<Map<string, SimNode>>(new Map());
  const [snapshot, setSnapshot] = useState<GraphNode[]>(nodes);

  // Keep latest inputs in refs so the effect can read them without depending on them
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const paramsRef = useRef(params);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  paramsRef.current = params;

  // Stable topology keys — effect only fires when graph structure actually changes
  const nodeIdKey = useMemo(() => nodes.map((n) => n.id).join("\0"), [nodes]);
  const edgeKey = useMemo(
    () => edges.map((e) => `${e.source}\0${e.target}`).join("\0"),
    [edges],
  );

  useEffect(() => {
    const currentNodes = nodesRef.current;
    const currentEdges = edgesRef.current;
    const p = paramsRef.current;

    if (currentNodes.length === 0) {
      simRef.current?.stop();
      simRef.current = null;
      simNodeMapRef.current.clear();
      setSnapshot([]);
      return;
    }

    const prevMap = simNodeMapRef.current;

    const simNodes: SimNode[] = currentNodes.map((gn) => {
      const prev = prevMap.get(gn.id);
      if (prev) {
        prev._gn = gn;
        return prev;
      }
      return {
        _gn: gn,
        x: gn.x,
        y: gn.y,
        vx: gn.vx,
        vy: gn.vy,
        fx: gn.pinned ? gn.x : undefined,
        fy: gn.pinned ? gn.y : undefined,
      };
    });

    const nextMap = new Map<string, SimNode>();
    for (const sn of simNodes) {
      nextMap.set(sn._gn.id, sn);
    }
    simNodeMapRef.current = nextMap;

    const simLinks: SimLink[] = currentEdges
      .map((e) => {
        const source = nextMap.get(e.source);
        const target = nextMap.get(e.target);
        if (!source || !target) return null;
        return { source, target } as SimLink;
      })
      .filter((l): l is SimLink => l !== null);

    const applyForces = (sim: Simulation<SimNode, SimLink>) => {
      sim
        .force(
          "link",
          forceLink<SimNode, SimLink>(simLinks)
            .distance(p.linkDistance)
            .strength(p.linkStrength),
        )
        .force(
          "charge",
          forceManyBody<SimNode>()
            .strength((d: SimNode) =>
              d._gn.type === "tentacle" ? p.repelStrength : p.repelStrength * 0.2,
            )
            .distanceMax(p.repelDistanceMax),
        )
        .force(
          "center",
          forceCenter<SimNode>(centerX, centerY).strength(p.centerStrength),
        )
        .force(
          "radial",
          forceRadial<SimNode>(p.radialRadius, centerX, centerY)
            .strength((d: SimNode) =>
              // Tentacles anchor the ring; sessions get moderate pull to fill the circle
              d._gn.type === "tentacle" ? p.radialStrength : p.radialStrength * 0.3,
            ),
        )
        .force(
          "collide",
          forceCollide<SimNode>((d) => d._gn.radius + p.collisionPadding),
        );
    };

    if (simRef.current) {
      simRef.current.nodes(simNodes);
      applyForces(simRef.current);
      simRef.current.alpha(REHEAT_ALPHA).restart();
    } else {
      const sim = forceSimulation<SimNode>(simNodes)
        .velocityDecay(p.velocityDecay)
        .alphaDecay(p.alphaDecay)
        .alphaMin(ALPHA_MIN)
        .alphaTarget(ALPHA_TARGET);

      applyForces(sim);

      sim.on("tick", () => {
        const updated: GraphNode[] = sim.nodes().map((sn) => ({
          ...sn._gn,
          x: sn.x ?? sn._gn.x,
          y: sn.y ?? sn._gn.y,
          vx: sn.vx ?? 0,
          vy: sn.vy ?? 0,
        }));
        setSnapshot(updated);
      });

      simRef.current = sim;
    }
  }, [nodeIdKey, edgeKey, centerX, centerY]);

  // Apply param changes without rebuilding the simulation
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;

    sim.velocityDecay(params.velocityDecay).alphaDecay(params.alphaDecay);

    const linkForce = sim.force("link") as ReturnType<typeof forceLink<SimNode, SimLink>> | null;
    if (linkForce) {
      linkForce.distance(params.linkDistance).strength(params.linkStrength);
    }

    const chargeForce = sim.force("charge") as ReturnType<typeof forceManyBody<SimNode>> | null;
    if (chargeForce) {
      chargeForce
        .strength((d: SimNode) =>
          d._gn.type === "tentacle" ? params.repelStrength : params.repelStrength * 0.2,
        )
        .distanceMax(params.repelDistanceMax);
    }

    const centerForce = sim.force("center") as ReturnType<typeof forceCenter<SimNode>> | null;
    if (centerForce) {
      centerForce.strength(params.centerStrength);
    }

    const radialForce = sim.force("radial") as ReturnType<typeof forceRadial<SimNode>> | null;
    if (radialForce) {
      radialForce
        .radius(params.radialRadius)
        .strength((d: SimNode) =>
          d._gn.type === "tentacle" ? params.radialStrength : params.radialStrength * 0.3,
        );
    }

    const collideForce = sim.force("collide") as ReturnType<typeof forceCollide<SimNode>> | null;
    if (collideForce) {
      collideForce.radius((d: SimNode) => d._gn.radius + params.collisionPadding);
    }

    sim.alpha(REHEAT_ALPHA).restart();
  }, [params]);

  useEffect(() => {
    return () => {
      simRef.current?.stop();
      simRef.current = null;
    };
  }, []);

  const pinNode = useCallback((id: string) => {
    const sn = simNodeMapRef.current.get(id);
    if (sn) {
      sn.fx = sn.x;
      sn.fy = sn.y;
      sn._gn = { ...sn._gn, pinned: true };
    }
  }, []);

  const unpinNode = useCallback((id: string) => {
    const sn = simNodeMapRef.current.get(id);
    if (sn) {
      sn.fx = undefined;
      sn.fy = undefined;
      sn._gn = { ...sn._gn, pinned: false };
    }
  }, []);

  const moveNode = useCallback((id: string, x: number, y: number) => {
    const sn = simNodeMapRef.current.get(id);
    if (sn) {
      sn.fx = x;
      sn.fy = y;
      sn.x = x;
      sn.y = y;
      sn.vx = 0;
      sn.vy = 0;
    }
  }, []);

  const reheat = useCallback(() => {
    simRef.current?.alpha(REHEAT_ALPHA).restart();
  }, []);

  return { simulatedNodes: snapshot, pinNode, unpinNode, moveNode, reheat };
};
