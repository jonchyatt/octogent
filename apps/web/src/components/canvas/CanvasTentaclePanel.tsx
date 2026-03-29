import { useCallback, useEffect, useMemo, useState } from "react";

import type { DeckTentacleSummary } from "@octogent/core";
import type { GraphNode } from "../../app/canvas/types";
import type { ConversationSessionSummary } from "../../app/types";
import { buildConversationsUrl, buildDeckTentaclesUrl } from "../../runtime/runtimeEndpoints";
import { normalizeConversationSessionSummary } from "../../app/normalizers";
import {
  type OctopusAccessory,
  type OctopusAnimation,
  type OctopusExpression,
  OctopusGlyph,
} from "../EmptyOctopus";

const OCTOPUS_COLORS = [
  "#ff6b2b", "#ff2d6b", "#00ffaa", "#bf5fff", "#00c8ff",
  "#ffee00", "#39ff14", "#ff4df0", "#00fff7", "#ff9500",
];
const ANIMATIONS: OctopusAnimation[] = ["sway", "walk", "jog", "bounce", "float", "swim-up"];
const EXPRESSIONS: OctopusExpression[] = ["normal", "happy", "angry", "surprised"];
const ACCESSORIES: OctopusAccessory[] = ["none", "none", "long", "mohawk", "side-sweep", "curly"];

function hashStr(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function deriveVisuals(tentacle: DeckTentacleSummary) {
  const rng = seededRng(hashStr(tentacle.tentacleId));
  const stored = tentacle.octopus;
  return {
    color: tentacle.color ?? (OCTOPUS_COLORS[hashStr(tentacle.tentacleId) % OCTOPUS_COLORS.length] as string),
    animation: (stored?.animation as OctopusAnimation | null) ?? (ANIMATIONS[Math.floor(rng() * ANIMATIONS.length)] as OctopusAnimation),
    expression: (stored?.expression as OctopusExpression | null) ?? (EXPRESSIONS[Math.floor(rng() * EXPRESSIONS.length)] as OctopusExpression),
    accessory: (stored?.accessory as OctopusAccessory | null) ?? (ACCESSORIES[Math.floor(rng() * ACCESSORIES.length)] as OctopusAccessory),
    hairColor: stored?.hairColor ?? undefined,
  };
}

type CanvasTentaclePanelProps = {
  node: GraphNode;
  isFocused?: boolean;
  onClose: () => void;
  onFocus?: () => void;
  onCreateAgent?: ((tentacleId: string) => void) | undefined;
  onSpawnSwarm?: ((tentacleId: string) => void) | undefined;
  onNavigateToConversation?: ((sessionId: string) => void) | undefined;
};

const STATUS_LABELS: Record<string, string> = {
  idle: "idle",
  active: "active",
  blocked: "blocked",
  "needs-review": "review",
};

const formatTime = (isoString: string | null): string => {
  if (!isoString) return "—";
  const d = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
};

const TentacleGlyph = ({ tentacle }: { tentacle: DeckTentacleSummary }) => {
  const visuals = useMemo(() => deriveVisuals(tentacle), [tentacle]);
  return (
    <div className="canvas-tentacle-panel-glyph">
      <OctopusGlyph
        color={visuals.color}
        animation={visuals.animation}
        expression={visuals.expression}
        accessory={visuals.accessory}
        {...(visuals.hairColor ? { hairColor: visuals.hairColor } : {})}
        scale={5}
      />
    </div>
  );
};

export const CanvasTentaclePanel = ({
  node,
  isFocused,
  onClose,
  onFocus,
  onCreateAgent,
  onSpawnSwarm,
  onNavigateToConversation,
}: CanvasTentaclePanelProps) => {
  const [tentacle, setTentacle] = useState<DeckTentacleSummary | null>(null);
  const [sessions, setSessions] = useState<ConversationSessionSummary[]>([]);

  const fetchTentacle = useCallback(async () => {
    try {
      const response = await fetch(buildDeckTentaclesUrl(), {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return;
      const payload = (await response.json()) as unknown;
      if (!Array.isArray(payload)) return;
      const match = (payload as DeckTentacleSummary[]).find(
        (t) => t.tentacleId === node.tentacleId,
      );
      if (match) setTentacle(match);
    } catch {
      // silent
    }
  }, [node.tentacleId]);

  const fetchSessions = useCallback(async () => {
    try {
      const response = await fetch(buildConversationsUrl(), {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return;
      const payload = (await response.json()) as unknown;
      const all = Array.isArray(payload)
        ? payload
            .map((entry) => normalizeConversationSessionSummary(entry))
            .filter((entry): entry is ConversationSessionSummary => entry !== null)
        : [];
      setSessions(all.filter((s) => s.tentacleId === node.tentacleId));
    } catch {
      // silent
    }
  }, [node.tentacleId]);

  useEffect(() => {
    void fetchTentacle();
    void fetchSessions();
  }, [fetchTentacle, fetchSessions]);

  const progressPct =
    tentacle && tentacle.todoTotal > 0
      ? Math.round((tentacle.todoDone / tentacle.todoTotal) * 100)
      : 0;

  return (
    <section
      className={`canvas-tentacle-panel${isFocused ? " canvas-tentacle-panel--focused" : ""}`}
      onPointerDown={() => onFocus?.()}
    >
      <div className="canvas-tentacle-panel-header">
        <div className="canvas-tentacle-panel-heading">
          <h2>
            <span
              className="canvas-tentacle-panel-color"
              style={{ backgroundColor: node.color }}
            />
            <span className="canvas-tentacle-panel-name">
              {tentacle?.displayName ?? node.label}
            </span>
          </h2>
          {tentacle && (
            <span
              className={`canvas-tentacle-panel-status canvas-tentacle-panel-status--${tentacle.status}`}
            >
              {STATUS_LABELS[tentacle.status] ?? tentacle.status}
            </span>
          )}
        </div>
        <button
          type="button"
          className="canvas-tentacle-panel-close"
          onClick={onClose}
          aria-label="Close panel"
        >
          &times;
        </button>
      </div>

      <div className="canvas-tentacle-panel-body">
        {/* Octopus glyph */}
        {tentacle && <TentacleGlyph tentacle={tentacle} />}

        {/* Description */}
        {tentacle?.description && (
          <div className="canvas-tentacle-panel-section">
            <p className="canvas-tentacle-panel-description">{tentacle.description}</p>
          </div>
        )}

        {/* Progress */}
        {tentacle && tentacle.todoTotal > 0 && (
          <div className="canvas-tentacle-panel-section">
            <h3 className="canvas-tentacle-panel-section-title">Progress</h3>
            <div className="canvas-tentacle-panel-progress">
              <div className="canvas-tentacle-panel-progress-bar">
                <div
                  className="canvas-tentacle-panel-progress-fill"
                  style={{ width: `${progressPct}%`, backgroundColor: node.color }}
                />
              </div>
              <span className="canvas-tentacle-panel-progress-label">
                {tentacle.todoDone}/{tentacle.todoTotal}
              </span>
            </div>
            {tentacle.todoItems.length > 0 && (
              <ul className="canvas-tentacle-panel-todos">
                {tentacle.todoItems.map((item) => (
                  <li
                    key={item.text}
                    className={`canvas-tentacle-panel-todo${item.done ? " canvas-tentacle-panel-todo--done" : ""}`}
                  >
                    <input type="checkbox" checked={item.done} readOnly />
                    <span>{item.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Sessions */}
        <div className="canvas-tentacle-panel-section">
          <h3 className="canvas-tentacle-panel-section-title">
            Sessions ({sessions.length})
          </h3>
          {sessions.length === 0 ? (
            <p className="canvas-tentacle-panel-empty">No sessions yet</p>
          ) : (
            <ul className="canvas-tentacle-panel-sessions">
              {sessions.map((s) => (
                <li key={s.sessionId} className="canvas-tentacle-panel-session">
                  <button
                    type="button"
                    className="canvas-tentacle-panel-session-btn"
                    onClick={() => onNavigateToConversation?.(s.sessionId)}
                  >
                    <span className="canvas-tentacle-panel-session-preview">
                      {s.firstUserTurnPreview
                        ? s.firstUserTurnPreview.slice(0, 60)
                        : s.sessionId.slice(0, 16)}
                    </span>
                    <span className="canvas-tentacle-panel-session-meta">
                      {s.turnCount} turns · {formatTime(s.lastEventAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Actions */}
        <div className="canvas-tentacle-panel-section">
          <h3 className="canvas-tentacle-panel-section-title">Actions</h3>
          <div className="canvas-tentacle-panel-actions">
            <button
              type="button"
              className="canvas-tentacle-panel-action"
              onClick={() => onCreateAgent?.(node.tentacleId)}
            >
              <span className="canvas-tentacle-panel-action-icon">&gt;_</span>
              Create Agent
            </button>
            <button
              type="button"
              className="canvas-tentacle-panel-action"
              onClick={() => onSpawnSwarm?.(node.tentacleId)}
            >
              <span className="canvas-tentacle-panel-action-icon">&#x2263;</span>
              Spawn Swarm
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
