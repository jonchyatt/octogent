import { useCallback, useRef, useState } from "react";

type CanvasTransform = {
  translateX: number;
  translateY: number;
  scale: number;
};

const MIN_SCALE = 0.1;
const MAX_SCALE = 3.0;
const ZOOM_FACTOR = 0.1;

type UseCanvasTransformResult = {
  transform: CanvasTransform;
  svgRef: React.RefObject<SVGSVGElement | null>;
  handleWheel: (e: React.WheelEvent<SVGSVGElement>) => void;
  handlePointerDown: (e: React.PointerEvent<SVGSVGElement>) => void;
  handlePointerMove: (e: React.PointerEvent<SVGSVGElement>) => void;
  handlePointerUp: (e: React.PointerEvent<SVGSVGElement>) => void;
  screenToGraph: (screenX: number, screenY: number) => { x: number; y: number };
  graphToScreen: (graphX: number, graphY: number) => { x: number; y: number };
};

export const useCanvasTransform = (): UseCanvasTransformResult => {
  const [transform, setTransform] = useState<CanvasTransform>({
    translateX: 0,
    translateY: 0,
    scale: 1,
  });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const panState = useRef<{
    startX: number;
    startY: number;
    startTx: number;
    startTy: number;
  } | null>(null);

  const screenToGraph = useCallback(
    (screenX: number, screenY: number) => {
      const svg = svgRef.current;
      if (!svg) return { x: screenX, y: screenY };
      const rect = svg.getBoundingClientRect();
      const svgX = screenX - rect.left;
      const svgY = screenY - rect.top;
      return {
        x: (svgX - transform.translateX) / transform.scale,
        y: (svgY - transform.translateY) / transform.scale,
      };
    },
    [transform],
  );

  const graphToScreen = useCallback(
    (graphX: number, graphY: number) => {
      const svg = svgRef.current;
      if (!svg) return { x: graphX, y: graphY };
      const rect = svg.getBoundingClientRect();
      return {
        x: graphX * transform.scale + transform.translateX + rect.left,
        y: graphY * transform.scale + transform.translateY + rect.top,
      };
    },
    [transform],
  );

  const handleWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;

    setTransform((prev) => {
      const direction = e.deltaY < 0 ? 1 : -1;
      const factor = 1 + direction * ZOOM_FACTOR;
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * factor));
      const scaleRatio = nextScale / prev.scale;

      return {
        scale: nextScale,
        translateX: cursorX - (cursorX - prev.translateX) * scaleRatio,
        translateY: cursorY - (cursorY - prev.translateY) * scaleRatio,
      };
    });
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (e.target !== svgRef.current && (e.target as SVGElement).closest?.(".canvas-node")) {
        return;
      }
      panState.current = {
        startX: e.clientX,
        startY: e.clientY,
        startTx: transform.translateX,
        startTy: transform.translateY,
      };
      (e.target as SVGSVGElement).setPointerCapture?.(e.pointerId);
    },
    [transform.translateX, transform.translateY],
  );

  const handlePointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const pan = panState.current;
    if (!pan) return;

    setTransform((prev) => ({
      ...prev,
      translateX: pan.startTx + (e.clientX - pan.startX),
      translateY: pan.startTy + (e.clientY - pan.startY),
    }));
  }, []);

  const handlePointerUp = useCallback(() => {
    panState.current = null;
  }, []);

  return {
    transform,
    svgRef,
    handleWheel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    screenToGraph,
    graphToScreen,
  };
};
