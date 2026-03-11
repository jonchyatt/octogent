import { useCallback, useEffect, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
  RefObject,
} from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  TENTACLE_DIVIDER_WIDTH,
  TENTACLE_MIN_WIDTH,
  TENTACLE_RESIZE_STEP,
  reconcileTentacleWidths,
  resizeTentaclePair,
} from "../../layout/tentaclePaneSizing";
import type { TentacleView } from "../types";

type UseTentacleBoardInteractionsOptions = {
  tentaclesRef: RefObject<HTMLElement | null>;
  visibleColumns: TentacleView;
  tentacleWidths: Record<string, number>;
  setTentacleWidths: Dispatch<SetStateAction<Record<string, number>>>;
  setMinimizedTentacleIds: Dispatch<SetStateAction<string[]>>;
  editingTentacleId: string | null;
  setEditingTentacleId: Dispatch<SetStateAction<string | null>>;
  setTentacleNameDraft: Dispatch<SetStateAction<string>>;
};

type UseTentacleBoardInteractionsResult = {
  handleMinimizeTentacle: (tentacleId: string) => void;
  handleMaximizeTentacle: (tentacleId: string) => void;
  handleTentacleDividerPointerDown: (
    leftTentacleId: string,
    rightTentacleId: string,
  ) => (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleTentacleDividerKeyDown: (
    leftTentacleId: string,
    rightTentacleId: string,
  ) => (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  handleTentacleHeaderWheel: (event: ReactWheelEvent<HTMLElement>) => void;
};

export const measureTentacleBoardViewportWidth = (board: HTMLElement): number | null => {
  const boardWidth = board.getBoundingClientRect().width;
  if (!Number.isFinite(boardWidth) || boardWidth <= 0) {
    return null;
  }

  const boardStyles = window.getComputedStyle(board);
  const paddingLeft = Number.parseFloat(boardStyles.paddingLeft);
  const paddingRight = Number.parseFloat(boardStyles.paddingRight);
  const horizontalPadding =
    (Number.isFinite(paddingLeft) ? paddingLeft : 0) +
    (Number.isFinite(paddingRight) ? paddingRight : 0);
  const viewportWidth = Math.floor(boardWidth - horizontalPadding);
  return viewportWidth > 0 ? viewportWidth : null;
};

export const useTentacleBoardInteractions = ({
  tentaclesRef,
  visibleColumns,
  tentacleWidths,
  setTentacleWidths,
  setMinimizedTentacleIds,
  editingTentacleId,
  setEditingTentacleId,
  setTentacleNameDraft,
}: UseTentacleBoardInteractionsOptions): UseTentacleBoardInteractionsResult => {
  const [tentacleViewportWidth, setTentacleViewportWidth] = useState<number | null>(null);

  useEffect(() => {
    const board = tentaclesRef.current;
    if (!board) {
      setTentacleViewportWidth(null);
      return;
    }

    const measure = () => {
      const currentBoard = tentaclesRef.current;
      if (!currentBoard) {
        setTentacleViewportWidth(null);
        return;
      }

      setTentacleViewportWidth(measureTentacleBoardViewportWidth(currentBoard));
    };

    measure();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        measure();
      });
      observer.observe(board);
      return () => {
        observer.disconnect();
      };
    }

    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
    };
    // Re-run when visibleColumns changes to re-attach observer if the DOM element changed
    // (e.g. after navigating away from tentacles view and back)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tentaclesRef, visibleColumns]);

  useEffect(() => {
    const tentacleIds = visibleColumns.map((column) => column.tentacleId);

    // Always try a fresh DOM measurement to guard against stale tentacleViewportWidth
    const board = tentaclesRef.current;
    const freshViewportWidth = board
      ? (measureTentacleBoardViewportWidth(board) ?? tentacleViewportWidth)
      : tentacleViewportWidth;

    const dividerTotalWidth = Math.max(0, tentacleIds.length - 1) * TENTACLE_DIVIDER_WIDTH;
    const paneViewportWidth =
      freshViewportWidth === null
        ? null
        : Math.max(0, freshViewportWidth - dividerTotalWidth);
    setTentacleWidths((currentWidths) =>
      reconcileTentacleWidths(currentWidths, tentacleIds, paneViewportWidth),
    );
  }, [setTentacleWidths, tentaclesRef, tentacleViewportWidth, visibleColumns]);

  const handleMinimizeTentacle = useCallback(
    (tentacleId: string) => {
      if (editingTentacleId === tentacleId) {
        setEditingTentacleId(null);
        setTentacleNameDraft("");
      }

      setMinimizedTentacleIds((current) => {
        if (current.includes(tentacleId)) {
          return current;
        }
        return [...current, tentacleId];
      });
    },
    [editingTentacleId, setEditingTentacleId, setMinimizedTentacleIds, setTentacleNameDraft],
  );

  const handleMaximizeTentacle = useCallback(
    (tentacleId: string) => {
      setMinimizedTentacleIds((current) =>
        current.filter((currentTentacleId) => currentTentacleId !== tentacleId),
      );
    },
    [setMinimizedTentacleIds],
  );

  const handleTentacleDividerPointerDown = useCallback(
    (leftTentacleId: string, rightTentacleId: string) => {
      return (event: ReactPointerEvent<HTMLDivElement>) => {
        event.preventDefault();

        const startX = event.clientX;
        const startLeftWidth = tentacleWidths[leftTentacleId] ?? TENTACLE_MIN_WIDTH;
        const startRightWidth = tentacleWidths[rightTentacleId] ?? TENTACLE_MIN_WIDTH;

        const handlePointerMove = (moveEvent: PointerEvent) => {
          const delta = moveEvent.clientX - startX;
          const resizedPair = resizeTentaclePair(
            {
              [leftTentacleId]: startLeftWidth,
              [rightTentacleId]: startRightWidth,
            },
            leftTentacleId,
            rightTentacleId,
            delta,
          );

          setTentacleWidths((current) => {
            const nextLeft = resizedPair[leftTentacleId] ?? startLeftWidth;
            const nextRight = resizedPair[rightTentacleId] ?? startRightWidth;
            if (current[leftTentacleId] === nextLeft && current[rightTentacleId] === nextRight) {
              return current;
            }

            return {
              ...current,
              [leftTentacleId]: nextLeft,
              [rightTentacleId]: nextRight,
            };
          });
        };

        const stopResize = () => {
          window.removeEventListener("pointermove", handlePointerMove);
          window.removeEventListener("pointerup", stopResize);
          window.removeEventListener("pointercancel", stopResize);
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", stopResize);
        window.addEventListener("pointercancel", stopResize);
      };
    },
    [setTentacleWidths, tentacleWidths],
  );

  const handleTentacleDividerKeyDown = useCallback(
    (leftTentacleId: string, rightTentacleId: string) => {
      return (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
          return;
        }

        event.preventDefault();
        const delta = event.key === "ArrowRight" ? TENTACLE_RESIZE_STEP : -TENTACLE_RESIZE_STEP;
        setTentacleWidths((currentWidths) =>
          resizeTentaclePair(currentWidths, leftTentacleId, rightTentacleId, delta),
        );
      };
    },
    [setTentacleWidths],
  );

  const handleTentacleHeaderWheel = useCallback(
    (event: ReactWheelEvent<HTMLElement>) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      if (!event.target.closest(".tentacle-column-header")) {
        return;
      }

      const board = tentaclesRef.current;
      if (!board) {
        return;
      }

      const horizontalDelta = Math.abs(event.deltaX) > 0 ? event.deltaX : event.deltaY;
      if (!Number.isFinite(horizontalDelta) || horizontalDelta === 0) {
        return;
      }

      board.scrollLeft += horizontalDelta;
      event.preventDefault();
    },
    [tentaclesRef],
  );

  return {
    handleMinimizeTentacle,
    handleMaximizeTentacle,
    handleTentacleDividerPointerDown,
    handleTentacleDividerKeyDown,
    handleTentacleHeaderWheel,
  };
};
