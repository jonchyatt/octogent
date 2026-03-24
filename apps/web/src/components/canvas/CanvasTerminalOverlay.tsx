import { useCallback, useEffect, useRef, useState } from "react";

import type { GraphNode } from "../../app/canvas/types";
import type { ConversationSessionDetail, ConversationTurn } from "../../app/types";
import { buildConversationSessionUrl } from "../../runtime/runtimeEndpoints";
import { normalizeConversationSessionDetail } from "../../app/normalizers";
import { TentacleTerminal } from "../TentacleTerminal";
import { MarkdownContent } from "../ui/MarkdownContent";

type CanvasTerminalOverlayProps = {
  node: GraphNode;
  screenX: number;
  screenY: number;
  onClose: () => void;
};

const TranscriptTurn = ({ turn }: { turn: ConversationTurn }) => (
  <div className={`canvas-transcript-turn canvas-transcript-turn--${turn.role}`}>
    <div className="canvas-transcript-turn-role">{turn.role === "user" ? "User" : "Assistant"}</div>
    <MarkdownContent content={turn.content} className="canvas-transcript-turn-content" />
  </div>
);

const TranscriptViewer = ({ sessionId }: { sessionId: string }) => {
  const [session, setSession] = useState<ConversationSessionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const load = async () => {
      try {
        const response = await fetch(buildConversationSessionUrl(sessionId), {
          method: "GET",
          headers: { Accept: "application/json" },
        });

        if (!response.ok) throw new Error(`Failed to load (${response.status})`);

        const payload = normalizeConversationSessionDetail(await response.json());
        if (cancelled) return;

        if (!payload) {
          setError("Invalid conversation data");
          return;
        }

        setSession(payload);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load transcript");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (isLoading) {
    return <div className="canvas-transcript-status">Loading transcript...</div>;
  }
  if (error) {
    return <div className="canvas-transcript-status canvas-transcript-status--error">{error}</div>;
  }
  if (!session || session.turns.length === 0) {
    return <div className="canvas-transcript-status">No conversation turns found.</div>;
  }

  return (
    <div className="canvas-transcript-turns">
      {session.turns.map((turn) => (
        <TranscriptTurn key={turn.turnId} turn={turn} />
      ))}
    </div>
  );
};

export const CanvasTerminalOverlay = ({
  node,
  screenX,
  screenY,
  onClose,
}: CanvasTerminalOverlayProps) => {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null,
  );
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const isActive = node.type === "active-session";
  const title = node.label;

  const handleTitlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: offset.x,
        origY: offset.y,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [offset],
  );

  const handleTitlePointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    setOffset({
      x: drag.origX + (e.clientX - drag.startX),
      y: drag.origY + (e.clientY - drag.startY),
    });
  }, []);

  const handleTitlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const left = screenX + offset.x;
  const top = screenY + offset.y;

  return (
    <div
      ref={overlayRef}
      className="canvas-terminal-overlay"
      style={{
        left: `${left}px`,
        top: `${top}px`,
      }}
    >
      <div
        className="canvas-terminal-overlay-title"
        onPointerDown={handleTitlePointerDown}
        onPointerMove={handleTitlePointerMove}
        onPointerUp={handleTitlePointerUp}
      >
        <span className="canvas-terminal-overlay-title-text">{title}</span>
        <button
          type="button"
          className="canvas-terminal-overlay-close"
          onClick={onClose}
          aria-label="Close overlay"
        >
          &times;
        </button>
      </div>
      <div className="canvas-terminal-overlay-body">
        {isActive && node.sessionId ? (
          <TentacleTerminal terminalId={node.sessionId} terminalLabel={title} />
        ) : node.sessionId ? (
          <TranscriptViewer sessionId={node.sessionId} />
        ) : (
          <div className="canvas-transcript-status">No session data available.</div>
        )}
      </div>
    </div>
  );
};
