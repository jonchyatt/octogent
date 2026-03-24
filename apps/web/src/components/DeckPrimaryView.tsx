import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DeckTentacleSummary } from "@octogent/core";
import type { TentacleAgentProvider } from "../app/types";
import {
  buildDeckTentacleUrl,
  buildDeckTentaclesUrl,
  buildDeckVaultFileUrl,
  buildTentaclesUrl,
} from "../runtime/runtimeEndpoints";
import {
  type OctopusAccessory,
  type OctopusAnimation,
  type OctopusExpression,
  OctopusGlyph,
} from "./EmptyOctopus";
import { TentacleTerminal } from "./TentacleTerminal";
import { MarkdownContent } from "./ui/MarkdownContent";

const AGENT_PROVIDER_OPTIONS: { value: TentacleAgentProvider; label: string }[] = [
  { value: "claude-code", label: "Claude Code" },
  { value: "codex", label: "Codex" },
];

// ─── Octopus visual derivation (seeded from tentacle id) ────────────────────

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
  hairColor?: string | undefined;
};

function deriveOctopusVisuals(tentacle: DeckTentacleSummary): OctopusVisuals {
  const rng = seededRandom(hashString(tentacle.tentacleId));
  const stored = tentacle.octopus;
  return {
    color:
      tentacle.color ??
      (OCTOPUS_COLORS[hashString(tentacle.tentacleId) % OCTOPUS_COLORS.length] as string),
    animation:
      (stored?.animation as OctopusAnimation | null) ??
      (ANIMATIONS[Math.floor(rng() * ANIMATIONS.length)] as OctopusAnimation),
    expression:
      (stored?.expression as OctopusExpression | null) ??
      (EXPRESSIONS[Math.floor(rng() * EXPRESSIONS.length)] as OctopusExpression),
    accessory:
      (stored?.accessory as OctopusAccessory | null) ??
      (ACCESSORIES[Math.floor(rng() * ACCESSORIES.length)] as OctopusAccessory),
    hairColor: stored?.hairColor ?? undefined,
  };
}

function randomOctopusVisuals(color: string): OctopusVisuals {
  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)] as T;
  return {
    color,
    animation: pick(ANIMATIONS),
    expression: pick(EXPRESSIONS),
    accessory: pick(ACCESSORIES),
  };
}

// ─── Status styling ──────────────────────────────────────────────────────────

const STATUS_LABELS: Record<DeckTentacleSummary["status"], string> = {
  idle: "idle",
  active: "active",
  blocked: "blocked",
  "needs-review": "review",
};

// ─── Components ──────────────────────────────────────────────────────────────

const TodoList = ({ items }: { items: { text: string; done: boolean }[] }) => {
  const lastDoneIndex = items.findLastIndex((item) => item.done);
  const scrollRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ block: "start" });
  }, []);

  return (
    <ul className="deck-pod-todos">
      {items.map((item, i) => (
        <li
          key={item.text}
          ref={i === lastDoneIndex ? scrollRef : undefined}
          className={`deck-pod-todo-item${item.done ? " deck-pod-todo-item--done" : ""}`}
        >
          <input type="checkbox" checked={item.done} readOnly className="deck-pod-todo-checkbox" />
          {item.text}
        </li>
      ))}
    </ul>
  );
};

type TentaclePodProps = {
  tentacle: DeckTentacleSummary;
  visuals: OctopusVisuals;
  isFocused: boolean;
  activeFileName?: string | undefined;
  onVaultFileClick?: (fileName: string) => void;
  onClose?: () => void;
  onDelete?: () => void;
  isDeleting?: boolean | undefined;
};

const TentaclePod = ({
  tentacle,
  visuals,
  isFocused,
  activeFileName,
  onVaultFileClick,
  onClose,
  onDelete,
  isDeleting,
}: TentaclePodProps) => {
  const progressPct =
    tentacle.todoTotal > 0 ? Math.round((tentacle.todoDone / tentacle.todoTotal) * 100) : 0;
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <article
      className={`deck-pod${isFocused ? " deck-pod--focused" : ""}`}
      data-status={tentacle.status}
      style={{ borderColor: "var(--accent-primary)" }}
    >
      <header className="deck-pod-header">
        {isFocused && (
          <button type="button" className="deck-pod-btn deck-pod-btn--secondary" onClick={onClose}>
            ← Back
          </button>
        )}
        <button type="button" className="deck-pod-btn">
          Spawn
        </button>
        <button type="button" className="deck-pod-btn">
          Vault
        </button>
        {confirmingDelete ? (
          <>
            <button
              type="button"
              className="deck-pod-btn deck-pod-btn--danger"
              disabled={isDeleting}
              onClick={() => onDelete?.()}
            >
              {isDeleting ? "..." : "Confirm Delete"}
            </button>
            <button
              type="button"
              className="deck-pod-btn deck-pod-btn--secondary"
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="deck-pod-btn deck-pod-btn--delete"
            onClick={() => setConfirmingDelete(true)}
            aria-label="Delete tentacle"
          >
            <svg className="deck-pod-btn-icon" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M5.5 1.5h5M2 4h12M6 7v5M10 7v5M3.5 4l.75 9.5a1 1 0 001 .9h5.5a1 1 0 001-.9L12.5 4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </header>

      <div className="deck-pod-body">
        <span className={`deck-pod-status deck-pod-status--${tentacle.status}`}>
          {STATUS_LABELS[tentacle.status]}
        </span>
        <div className="deck-pod-identity">
          <div className="deck-pod-octopus-col">
            <div className="deck-pod-octopus">
              <OctopusGlyph
                color={visuals.color}
                animation={visuals.animation}
                expression={visuals.expression}
                accessory={visuals.accessory}
                {...(visuals.hairColor ? { hairColor: visuals.hairColor } : {})}
                scale={5}
              />
            </div>
          </div>
          <div className="deck-pod-identity-text">
            <span className="deck-pod-name">{tentacle.displayName}</span>
            <span className="deck-pod-description">{tentacle.description}</span>
          </div>
        </div>

        <div className="deck-pod-details">
          {tentacle.todoTotal > 0 && (
            <div className="deck-pod-progress">
              <div className="deck-pod-progress-bar">
                <div
                  className="deck-pod-progress-fill"
                  style={{ width: `${progressPct}%`, backgroundColor: visuals.color }}
                />
              </div>
              <span
                className="deck-pod-progress-label"
                style={{ backgroundColor: `${visuals.color}22`, color: visuals.color }}
              >
                {tentacle.todoDone}/{tentacle.todoTotal} done
              </span>
            </div>
          )}

          {tentacle.todoItems.length > 0 && <TodoList items={tentacle.todoItems} />}

          {tentacle.vaultFiles.length > 0 && (
            <div className="deck-pod-vault">
              <span className="deck-pod-vault-label">vault</span>
              <div className="deck-pod-vault-files">
                {tentacle.vaultFiles.map((file) => (
                  <button
                    key={file}
                    type="button"
                    className="deck-pod-vault-file"
                    aria-current={activeFileName === file ? "true" : undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      onVaultFileClick?.(file);
                    }}
                  >
                    {file}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
};

// ─── Action cards (shared between empty + populated states) ──────────────────

type ActionCardsProps = {
  compact?: boolean;
  selectedAgent: TentacleAgentProvider;
  setSelectedAgent: (agent: TentacleAgentProvider) => void;
  agentMenuOpen: boolean;
  setAgentMenuOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  agentMenuRef: React.RefObject<HTMLDivElement | null>;
  onAddManually: () => void;
  onLaunchAgent: () => void;
  isLaunchingAgent?: boolean;
};

const ActionCards = ({
  compact,
  selectedAgent,
  setSelectedAgent,
  agentMenuOpen,
  setAgentMenuOpen,
  agentMenuRef,
  onAddManually,
  onLaunchAgent,
  isLaunchingAgent,
}: ActionCardsProps) => (
  <div className={`deck-empty-actions${compact ? " deck-empty-actions--compact" : ""}`}>
    <button type="button" className="deck-empty-card" onClick={() => {}}>
      <div className="deck-empty-card-icon">
        <OctopusGlyph
          color="#d4a017"
          animation="idle"
          expression="normal"
          accessory="none"
          scale={compact ? 3 : 4}
        />
      </div>
      <div className="deck-empty-card-text">
        <span className="deck-empty-card-title">Create Main Tentacle</span>
        <span className="deck-empty-card-desc">
          Set up the main default tentacle to work on your codebase
        </span>
      </div>
    </button>
    <div className="deck-empty-card" role="group">
      <span className="deck-empty-card-icon deck-empty-card-icon--terminal">&gt;_</span>
      <div className="deck-empty-card-text">
        <span className="deck-empty-card-title">Open Agent</span>
        <span className="deck-empty-card-desc">
          Launch your coding agent to create tentacles based on your codebase
        </span>
        <div className="deck-empty-agent-select-row">
          <div className="deck-empty-agent-picker" ref={agentMenuRef}>
            <button
              type="button"
              className="deck-empty-agent-trigger"
              aria-expanded={agentMenuOpen}
              aria-haspopup="menu"
              onClick={() => setAgentMenuOpen((p: boolean) => !p)}
            >
              {AGENT_PROVIDER_OPTIONS.find((o) => o.value === selectedAgent)?.label}
              <svg className="deck-empty-agent-chevron" viewBox="0 0 10 6" aria-hidden="true">
                <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
            {agentMenuOpen && (
              <div className="deck-empty-agent-menu" role="menu">
                {AGENT_PROVIDER_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className="deck-empty-agent-menu-item"
                    role="menuitem"
                    data-active={opt.value === selectedAgent ? "true" : "false"}
                    onClick={() => {
                      setSelectedAgent(opt.value);
                      setAgentMenuOpen(false);
                    }}
                  >
                    {opt.label}
                    {opt.value === selectedAgent && (
                      <span className="deck-empty-agent-menu-check">&#x2713;</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            className="deck-empty-agent-launch"
            disabled={isLaunchingAgent}
            onClick={onLaunchAgent}
          >
            {isLaunchingAgent ? "..." : "Launch"}
          </button>
        </div>
      </div>
    </div>
    <button type="button" className="deck-empty-card" onClick={onAddManually}>
      <span className="deck-empty-card-icon deck-empty-card-icon--terminal">+</span>
      <div className="deck-empty-card-text">
        <span className="deck-empty-card-title">Add Tentacle Manually</span>
        <span className="deck-empty-card-desc">
          Create a custom tentacle with your own configuration
        </span>
      </div>
    </button>
  </div>
);

// ─── Add tentacle form ───────────────────────────────────────────────────────

type OctopusAppearancePayload = {
  animation: string;
  expression: string;
  accessory: string;
  hairColor: string;
};

type AddTentacleFormProps = {
  onSubmit: (
    name: string,
    description: string,
    color: string,
    octopus: OctopusAppearancePayload,
  ) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  error: string | null;
};

const EXPRESSION_OPTIONS: { value: OctopusExpression; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "happy", label: "Happy" },
  { value: "angry", label: "Angry" },
  { value: "surprised", label: "Surprised" },
];

const ACCESSORY_OPTIONS: { value: OctopusAccessory; label: string }[] = [
  { value: "none", label: "None" },
  { value: "long", label: "Long" },
  { value: "mohawk", label: "Mohawk" },
  { value: "side-sweep", label: "Side Sweep" },
  { value: "curly", label: "Curly" },
];

const HAIR_COLORS = [
  "#4a2c0a",
  "#1a1a1a",
  "#c8a04a",
  "#e04020",
  "#f5f5f5",
  "#6b3fa0",
  "#2a6e3f",
  "#1e90ff",
];

const AddTentacleForm = ({ onSubmit, onCancel, isSubmitting, error }: AddTentacleFormProps) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedColor, setSelectedColor] = useState(
    () => OCTOPUS_COLORS[Math.floor(Math.random() * OCTOPUS_COLORS.length)] as string,
  );
  const [selectedExpression, setSelectedExpression] = useState<OctopusExpression>(() => {
    const pick = EXPRESSIONS[Math.floor(Math.random() * EXPRESSIONS.length)] as OctopusExpression;
    return pick;
  });
  const [selectedAccessory, setSelectedAccessory] = useState<OctopusAccessory>(() => {
    const pick = ACCESSORIES[Math.floor(Math.random() * ACCESSORIES.length)] as OctopusAccessory;
    return pick;
  });
  const [selectedAnimation] = useState<OctopusAnimation>(() => {
    const pick = ANIMATIONS[Math.floor(Math.random() * ANIMATIONS.length)] as OctopusAnimation;
    return pick;
  });
  const [selectedHairColor, setSelectedHairColor] = useState(
    () => HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)] as string,
  );
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length === 0) return;
    onSubmit(name.trim(), description.trim(), selectedColor, {
      animation: selectedAnimation,
      expression: selectedExpression,
      accessory: selectedAccessory,
      hairColor: selectedHairColor,
    });
  };

  return (
    <form className="deck-add-form" onSubmit={handleSubmit}>
      <div className="deck-add-form-header">
        <button type="button" className="deck-add-form-back" onClick={onCancel}>
          ← Back
        </button>
        <span className="deck-add-form-title">New Tentacle</span>
      </div>

      <div className="deck-add-form-body">
        <div className="deck-add-form-preview">
          <OctopusGlyph
            color={selectedColor}
            animation={selectedAnimation}
            expression={selectedExpression}
            accessory={selectedAccessory}
            hairColor={selectedHairColor}
            scale={8}
          />
        </div>

        <label className="deck-add-form-label">
          Name
          <input
            ref={nameRef}
            type="text"
            className="deck-add-form-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Database Layer"
          />
        </label>

        <label className="deck-add-form-label">
          Description
          <textarea
            className="deck-add-form-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this tentacle is responsible for..."
            rows={3}
          />
        </label>

        <div className="deck-add-form-label">
          Color
          <div className="deck-add-form-colors">
            {OCTOPUS_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className="deck-add-form-color-swatch"
                data-selected={c === selectedColor ? "true" : "false"}
                style={{ backgroundColor: c }}
                onClick={() => setSelectedColor(c)}
                aria-label={`Select color ${c}`}
              />
            ))}
          </div>
        </div>

        <div className="deck-add-form-row">
          <div className="deck-add-form-label">
            Expression
            <div className="deck-add-form-chips">
              {EXPRESSION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className="deck-add-form-chip"
                  data-selected={opt.value === selectedExpression ? "true" : "false"}
                  onClick={() => setSelectedExpression(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="deck-add-form-label">
            Hair Style
            <div className="deck-add-form-chips">
              {ACCESSORY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className="deck-add-form-chip"
                  data-selected={opt.value === selectedAccessory ? "true" : "false"}
                  onClick={() => setSelectedAccessory(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="deck-add-form-label">
            Hair Color
            <div className="deck-add-form-colors">
              {HAIR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="deck-add-form-color-swatch deck-add-form-color-swatch--small"
                  data-selected={c === selectedHairColor ? "true" : "false"}
                  style={{ backgroundColor: c }}
                  onClick={() => setSelectedHairColor(c)}
                  aria-label={`Select hair color ${c}`}
                />
              ))}
            </div>
          </div>
        </div>

        {error && <div className="deck-add-form-error">{error}</div>}

        <button
          type="submit"
          className="deck-add-form-submit"
          disabled={isSubmitting || name.trim().length === 0}
        >
          {isSubmitting ? "Creating..." : "Create Tentacle"}
        </button>
      </div>
    </form>
  );
};

// ─── Bottom actions (compact cards + clear all for populated state) ──────────

type DeckBottomActionsProps = {
  onClearAll: () => void;
};

const DeckBottomActions = ({ onClearAll }: DeckBottomActionsProps) => {
  const [confirmingClear, setConfirmingClear] = useState(false);

  return (
    <div className="deck-sidebar-clear">
      {confirmingClear ? (
        <div className="deck-bottom-clear-confirm">
          <span className="deck-bottom-clear-label">Clear all tentacles?</span>
          <button
            type="button"
            className="deck-bottom-clear-btn deck-bottom-clear-btn--danger"
            onClick={() => {
              onClearAll();
              setConfirmingClear(false);
            }}
          >
            Confirm
          </button>
          <button
            type="button"
            className="deck-bottom-clear-btn"
            onClick={() => setConfirmingClear(false)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="deck-bottom-clear-link"
          onClick={() => setConfirmingClear(true)}
        >
          <svg className="deck-bottom-clear-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M5.5 1.5h5M2 4h12M6 7v5M10 7v5M3.5 4l.75 9.5a1 1 0 001 .9h5.5a1 1 0 001-.9L12.5 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Clear All
        </button>
      )}
    </div>
  );
};

// ─── Main view ───────────────────────────────────────────────────────────────

type FocusState =
  | { type: "vault"; tentacleId: string; fileName: string }
  | { type: "terminal"; agentId: string; terminalLabel: string };

type EmptyViewMode = "idle" | "adding";

type DeckPrimaryViewProps = {
  onSidebarContent?: ((content: ReactNode) => void) | undefined;
};

export const DeckPrimaryView = ({ onSidebarContent }: DeckPrimaryViewProps) => {
  const [tentacles, setTentacles] = useState<DeckTentacleSummary[]>([]);
  const [focus, setFocus] = useState<FocusState | null>(null);
  const [vaultContent, setVaultContent] = useState<string | null>(null);
  const [loadingVault, setLoadingVault] = useState(false);
  const [emptyViewMode, setEmptyViewMode] = useState<EmptyViewMode>("idle");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [selectedAgent, setSelectedAgent] = useState<TentacleAgentProvider>("claude-code");
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const agentMenuRef = useRef<HTMLDivElement>(null);
  const [isLaunchingAgent, setIsLaunchingAgent] = useState(false);

  // Fetch tentacle list
  const fetchTentacles = useCallback(async () => {
    try {
      const response = await fetch(buildDeckTentaclesUrl(), {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return;
      const data = await response.json();
      setTentacles(data);
    } catch {
      // silently ignore
    }
  }, []);

  useEffect(() => {
    void fetchTentacles();
  }, [fetchTentacles]);

  // Precompute visuals for all tentacles
  const visualsMap = useMemo(() => {
    const map = new Map<string, OctopusVisuals>();
    for (const t of tentacles) {
      map.set(t.tentacleId, deriveOctopusVisuals(t));
    }
    return map;
  }, [tentacles]);

  // Fetch vault file content when focus changes
  useEffect(() => {
    if (!focus || focus.type !== "vault") {
      setVaultContent(null);
      return;
    }

    let cancelled = false;
    setLoadingVault(true);
    const fetchVault = async () => {
      try {
        const response = await fetch(buildDeckVaultFileUrl(focus.tentacleId, focus.fileName), {
          headers: { Accept: "text/markdown" },
        });
        if (cancelled) return;
        if (!response.ok) {
          setVaultContent(null);
          setLoadingVault(false);
          return;
        }
        const text = await response.text();
        if (!cancelled) {
          setVaultContent(text);
          setLoadingVault(false);
        }
      } catch {
        if (!cancelled) {
          setVaultContent(null);
          setLoadingVault(false);
        }
      }
    };
    void fetchVault();
    return () => {
      cancelled = true;
    };
  }, [focus]);

  // Agent menu click-outside/escape
  useEffect(() => {
    if (!agentMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (agentMenuRef.current && !agentMenuRef.current.contains(e.target as Node)) {
        setAgentMenuOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAgentMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [agentMenuOpen]);

  const handleVaultFileClick = useCallback((tentacleId: string, fileName: string) => {
    setFocus({ type: "vault", tentacleId, fileName });
  }, []);

  const handleClose = useCallback(() => {
    setFocus(null);
  }, []);

  const handleLaunchAgent = useCallback(async () => {
    setIsLaunchingAgent(true);
    try {
      const response = await fetch(buildTentaclesUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          name: "tentacle-planner",
          workspaceMode: "shared",
          agentProvider: selectedAgent,
          promptTemplate: "tentacle-planner",
        }),
      });
      if (!response.ok) return;
      const data = await response.json();
      const tentacleId = data.tentacleId as string;
      const agentId = `${tentacleId}-agent-1`;
      setFocus({ type: "terminal", agentId, terminalLabel: "Tentacle Planner" });
    } catch {
      // silently ignore
    } finally {
      setIsLaunchingAgent(false);
    }
  }, [selectedAgent]);

  const handleCreateTentacle = useCallback(
    async (name: string, description: string, color: string, octopus: OctopusAppearancePayload) => {
      setIsCreating(true);
      setCreateError(null);
      try {
        const response = await fetch(buildDeckTentaclesUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ name, description, color, octopus }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          const msg =
            body && typeof body === "object" && "error" in body && typeof body.error === "string"
              ? body.error
              : "Failed to create tentacle";
          setCreateError(msg);
          return;
        }
        setEmptyViewMode("idle");
        await fetchTentacles();
      } catch {
        setCreateError("Network error");
      } finally {
        setIsCreating(false);
      }
    },
    [fetchTentacles],
  );

  const [deletingTentacleId, setDeletingTentacleId] = useState<string | null>(null);

  const handleDeleteTentacle = useCallback(
    async (tentacleId: string) => {
      setDeletingTentacleId(tentacleId);
      try {
        const response = await fetch(buildDeckTentacleUrl(tentacleId), { method: "DELETE" });
        if (!response.ok) return;
        await fetchTentacles();
      } catch {
        // silently ignore
      } finally {
        setDeletingTentacleId(null);
      }
    },
    [fetchTentacles],
  );

  const focusedTentacle =
    focus?.type === "vault" ? tentacles.find((t) => t.tentacleId === focus.tentacleId) : null;
  const mode = focus ? "detail" : "grid";

  // Push sidebar content to the shared sidebar
  const sidebarContent =
    tentacles.length > 0 ? (
      <div className="deck-sidebar-content">
        <div className="deck-sidebar-content-top">
          <ActionCards
            compact
            selectedAgent={selectedAgent}
            setSelectedAgent={setSelectedAgent}
            agentMenuOpen={agentMenuOpen}
            setAgentMenuOpen={setAgentMenuOpen}
            agentMenuRef={agentMenuRef}
            onAddManually={() => {
              setEmptyViewMode("adding");
              setCreateError(null);
            }}
            onLaunchAgent={handleLaunchAgent}
            isLaunchingAgent={isLaunchingAgent}
          />
        </div>
        <div className="deck-sidebar-content-bottom">
          <DeckBottomActions
            onClearAll={async () => {
              for (const t of tentacles) {
                await fetch(buildDeckTentacleUrl(t.tentacleId), { method: "DELETE" });
              }
              await fetchTentacles();
            }}
          />
        </div>
      </div>
    ) : null;

  useEffect(() => {
    onSidebarContent?.(sidebarContent);
    return () => onSidebarContent?.(null);
  });

  // ─── Empty state (no tentacles) ─────────────────────────────────────────────

  if (tentacles.length === 0 && focus?.type !== "terminal") {
    return (
      <section
        className="deck-view"
        data-mode="grid"
        data-empty-mode={emptyViewMode}
        aria-label="Deck"
      >
        <div className="deck-empty-state">
          <div className="deck-empty-left">
            <div className="deck-empty-octopus">
              <OctopusGlyph
                color="#d4a017"
                animation="walk"
                expression="happy"
                accessory="none"
                scale={20}
              />
            </div>
            <ActionCards
              selectedAgent={selectedAgent}
              setSelectedAgent={setSelectedAgent}
              agentMenuOpen={agentMenuOpen}
              setAgentMenuOpen={setAgentMenuOpen}
              agentMenuRef={agentMenuRef}
              onAddManually={() => {
                setEmptyViewMode("adding");
                setCreateError(null);
              }}
              onLaunchAgent={handleLaunchAgent}
              isLaunchingAgent={isLaunchingAgent}
            />
          </div>
          {emptyViewMode === "adding" && (
            <div className="deck-empty-right">
              <AddTentacleForm
                onSubmit={handleCreateTentacle}
                onCancel={() => setEmptyViewMode("idle")}
                isSubmitting={isCreating}
                error={createError}
              />
            </div>
          )}
        </div>
      </section>
    );
  }

  // ─── Populated state ────────────────────────────────────────────────────────

  return (
    <section className="deck-view" data-mode={mode} aria-label="Deck">
      <div className="deck-pods-container">
        {tentacles.map((t) => {
          const isThis = focus?.type === "vault" && focus.tentacleId === t.tentacleId;
          return (
            <div
              key={t.tentacleId}
              className="deck-pod-slot"
              data-pod-role={isThis ? "focused" : focus ? "other" : "idle"}
            >
              <TentaclePod
                tentacle={t}
                visuals={visualsMap.get(t.tentacleId) as OctopusVisuals}
                isFocused={isThis}
                activeFileName={isThis ? focus.fileName : undefined}
                onVaultFileClick={(fileName) =>
                  isThis
                    ? setFocus({ type: "vault", tentacleId: t.tentacleId, fileName })
                    : handleVaultFileClick(t.tentacleId, fileName)
                }
                onClose={handleClose}
                onDelete={() => handleDeleteTentacle(t.tentacleId)}
                isDeleting={deletingTentacleId === t.tentacleId}
              />
            </div>
          );
        })}
      </div>

      <div className="deck-detail-main">
        {focus?.type === "vault" && focusedTentacle && (
          <>
            <header className="deck-detail-main-header">
              <span className="deck-detail-main-path">
                {focusedTentacle.displayName} / <strong>{focus.fileName}</strong>
              </span>
            </header>
            <div className="deck-detail-main-content" key={`${focus.tentacleId}/${focus.fileName}`}>
              {loadingVault ? (
                <span className="deck-detail-loading">Loading…</span>
              ) : vaultContent !== null ? (
                <MarkdownContent content={vaultContent} className="deck-detail-markdown" />
              ) : (
                <span className="deck-detail-loading">File not found.</span>
              )}
            </div>
          </>
        )}
        {focus?.type === "terminal" && (
          <div className="deck-detail-terminal" key={focus.agentId}>
            <header className="deck-detail-main-header">
              <button type="button" className="deck-add-form-back" onClick={handleClose}>
                ← Back
              </button>
              <span className="deck-detail-main-path">
                <strong>{focus.terminalLabel}</strong>
              </span>
            </header>
            <TentacleTerminal terminalId={focus.agentId} terminalLabel={focus.terminalLabel} />
          </div>
        )}
      </div>
    </section>
  );
};
