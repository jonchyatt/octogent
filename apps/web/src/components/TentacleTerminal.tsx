import { useEffect, useRef, useState } from "react";

import { buildTerminalSocketUrl } from "../runtime/runtimeEndpoints";
import { type AgentRuntimeState, AgentStateBadge, isAgentRuntimeState } from "./AgentStateBadge";
import { wheelDeltaToScrollLines } from "./terminalWheel";
import { ActionButton } from "./ui/ActionButton";

import "xterm/css/xterm.css";

type TentacleTerminalProps = {
  terminalId: string;
  terminalLabel?: string;
  isSelected?: boolean;
  initialPrompt?: string;
  onAddAbove?: () => void;
  onAddBelow?: () => void;
  onDelete?: () => void;
  onSelectTerminal?: (terminalId: string) => void;
  onAgentRuntimeStateChange?: (state: AgentRuntimeState) => void;
};

type TerminalStateMessage = {
  type: "state";
  state: AgentRuntimeState;
};

type TerminalOutputMessage = {
  type: "output";
  data: string;
};

type TerminalHistoryMessage = {
  type: "history";
  data: string;
};

type TerminalServerMessage = TerminalStateMessage | TerminalOutputMessage | TerminalHistoryMessage;
const SHOW_CURSOR_ESCAPE = "\u001b[?25h";

const TerminalAddIcon = ({ direction }: { direction: "up" | "down" }) => {
  const arrow = direction === "up" ? "↑" : "↓";
  return (
    <span aria-hidden="true" className="terminal-add-icon">
      <span className="terminal-add-icon-prompt">&gt;_</span>
      <span className="terminal-add-icon-arrow">{arrow}</span>
    </span>
  );
};

const TerminalDeleteIcon = () => (
  <svg aria-hidden="true" className="terminal-delete-icon" viewBox="0 0 16 16">
    <path
      d="M5 2h6l.7 1.5H14v1H2v-1h2.3L5 2Zm-1 4h8l-.6 7.2c-.1 1-.9 1.8-1.9 1.8H6.5c-1 0-1.8-.8-1.9-1.8L4 6Zm2 1v6h1V7H6Zm3 0v6h1V7H9Z"
      fill="currentColor"
    />
  </svg>
);

const PromptInjectIcon = () => (
  <svg
    aria-hidden="true"
    className="terminal-inject-icon"
    viewBox="0 0 16 16"
    width="14"
    height="14"
  >
    <path d="M2 3h12v1H2V3Zm0 3h8v1H2V6Zm0 3h6v1H2V9Zm9 0l3 2.5L11 14v-5Z" fill="currentColor" />
  </svg>
);

export const TentacleTerminal = ({
  terminalId,
  terminalLabel,
  isSelected,
  initialPrompt,
  onAddAbove,
  onAddBelow,
  onDelete,
  onSelectTerminal,
  onAgentRuntimeStateChange,
}: TentacleTerminalProps) => {
  const socketRef = useRef<WebSocket | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [connectionState, setConnectionState] = useState("connecting");
  const [agentState, setAgentRuntimeState] = useState<AgentRuntimeState>("idle");
  const [isPromptBannerDismissed, setIsPromptBannerDismissed] = useState(false);
  const terminalTitle = terminalLabel && terminalLabel.length > 0 ? terminalLabel : terminalId;

  useEffect(() => {
    onAgentRuntimeStateChange?.(agentState);
  }, [agentState, onAgentRuntimeStateChange]);

  useEffect(() => {
    let isCancelled = false;
    let reconnectTimer: number | null = null;
    let socket: WebSocket | null = null;
    let requestResizeSync = () => {};
    let cleanupTerminal = () => {};
    let activeTerminal: {
      write: (value: string) => void;
      scrollLines: (lineCount: number) => void;
      clear: () => void;
    } | null = null;
    let pendingHistoryData: string | null = null;
    const pendingOutputChunks: string[] = [];

    const connect = () => {
      const nextSocket = new WebSocket(buildTerminalSocketUrl(terminalId));
      socket = nextSocket;
      setConnectionState("connecting");

      nextSocket.addEventListener("open", () => {
        if (isCancelled || socket !== nextSocket) {
          return;
        }
        socketRef.current = nextSocket;
        setConnectionState("connected");
        requestResizeSync();
      });

      nextSocket.addEventListener("close", () => {
        if (isCancelled || socket !== nextSocket) {
          return;
        }
        socketRef.current = null;
        setConnectionState("closed");
        reconnectTimer = window.setTimeout(() => {
          connect();
        }, 900);
      });

      nextSocket.addEventListener("error", () => {
        if (isCancelled || socket !== nextSocket) {
          return;
        }
        setConnectionState("error");
      });

      nextSocket.addEventListener("message", (event) => {
        if (isCancelled || socket !== nextSocket) {
          return;
        }

        if (typeof event.data !== "string") {
          return;
        }

        try {
          const payload = JSON.parse(event.data) as TerminalServerMessage;
          if (payload.type === "history" && typeof payload.data === "string") {
            if (activeTerminal) {
              activeTerminal.clear();
              activeTerminal.write(payload.data);
              activeTerminal.write(SHOW_CURSOR_ESCAPE);
              return;
            }

            pendingHistoryData = payload.data;
            pendingOutputChunks.length = 0;
            return;
          }

          if (payload.type === "output" && typeof payload.data === "string") {
            if (activeTerminal) {
              activeTerminal.write(payload.data);
              activeTerminal.write(SHOW_CURSOR_ESCAPE);
              return;
            }

            pendingOutputChunks.push(payload.data);
            return;
          }

          if (payload.type === "state" && isAgentRuntimeState(payload.state)) {
            setAgentRuntimeState(payload.state);
            return;
          }
        } catch {
          if (activeTerminal) {
            activeTerminal.write(event.data);
            activeTerminal.write(SHOW_CURSOR_ESCAPE);
            return;
          }

          pendingOutputChunks.push(event.data);
        }
      });
    };

    connect();

    if (import.meta.env.MODE === "test") {
      return () => {
        isCancelled = true;
        if (reconnectTimer !== null) {
          window.clearTimeout(reconnectTimer);
        }
        socket?.close();
      };
    }

    void (async () => {
      if (!containerRef.current) {
        return;
      }

      try {
        const [{ Terminal }, { FitAddon }] = await Promise.all([
          import("xterm"),
          import("@xterm/addon-fit"),
        ]);

        if (isCancelled || !containerRef.current) {
          return;
        }

        const rootFontSize = Number.parseFloat(
          window.getComputedStyle(document.documentElement).fontSize,
        );
        const terminalFontSize = Number.isFinite(rootFontSize)
          ? Math.max(13, Math.round(rootFontSize * 0.82))
          : 13;
        const terminalBackground =
          window
            .getComputedStyle(document.documentElement)
            .getPropertyValue("--terminal-bg")
            .trim() || "#101722";

        const terminal = new Terminal({
          convertEol: true,
          cursorBlink: true,
          cursorInactiveStyle: "bar",
          cursorStyle: "bar",
          cursorWidth: 2,
          fontFamily: '"JetBrains Mono", "IBM Plex Mono", monospace',
          fontSize: terminalFontSize,
          theme: {
            background: terminalBackground,
            foreground: "#f0f0f0",
            cursor: "#faa32c",
            cursorAccent: terminalBackground,
          },
        });
        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.open(containerRef.current);
        fitAddon.fit();
        terminal.focus();
        activeTerminal = terminal;

        if (pendingHistoryData !== null) {
          terminal.clear();
          terminal.write(pendingHistoryData);
          pendingHistoryData = null;
        }
        if (pendingOutputChunks.length > 0) {
          for (const chunk of pendingOutputChunks) {
            terminal.write(chunk);
          }
          pendingOutputChunks.length = 0;
        }
        terminal.write(SHOW_CURSOR_ESCAPE);

        const wheelListenerTarget = containerRef.current;
        const viewportWheelTarget =
          wheelListenerTarget.querySelector<HTMLElement>(".xterm-viewport") ?? wheelListenerTarget;
        const onPointerDown = () => {
          terminal.focus();
          terminal.write(SHOW_CURSOR_ESCAPE);
        };
        const onWheel = (event: WheelEvent) => {
          const lines = wheelDeltaToScrollLines(event.deltaY, event.deltaMode);
          if (lines === 0) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          terminal.scrollLines(lines);
        };
        wheelListenerTarget.addEventListener("pointerdown", onPointerDown, {
          capture: true,
        });
        viewportWheelTarget.addEventListener("wheel", onWheel, {
          passive: false,
        });

        let resizeDebounceTimer: number | null = null;
        let lastSentCols = -1;
        let lastSentRows = -1;

        const sendResize = () => {
          if (!socket || socket.readyState !== 1) {
            return;
          }

          if (terminal.cols === lastSentCols && terminal.rows === lastSentRows) {
            return;
          }

          socket.send(
            JSON.stringify({
              type: "resize",
              cols: terminal.cols,
              rows: terminal.rows,
            }),
          );
          lastSentCols = terminal.cols;
          lastSentRows = terminal.rows;
        };

        const scheduleResizeSync = () => {
          if (resizeDebounceTimer !== null) {
            window.clearTimeout(resizeDebounceTimer);
          }
          resizeDebounceTimer = window.setTimeout(() => {
            resizeDebounceTimer = null;
            sendResize();
          }, 60);
        };
        requestResizeSync = scheduleResizeSync;

        const onDataDisposable = terminal.onData((data) => {
          terminal.write(SHOW_CURSOR_ESCAPE);
          if (!socket || socket.readyState !== 1) {
            return;
          }

          socket.send(
            JSON.stringify({
              type: "input",
              data,
            }),
          );
        });

        let observer: ResizeObserver | null = null;
        if ("ResizeObserver" in window) {
          observer = new ResizeObserver(() => {
            fitAddon.fit();
            scheduleResizeSync();
          });
          observer.observe(containerRef.current);
        }

        scheduleResizeSync();
        terminal.write(SHOW_CURSOR_ESCAPE);
        cleanupTerminal = () => {
          wheelListenerTarget.removeEventListener("pointerdown", onPointerDown, true);
          viewportWheelTarget.removeEventListener("wheel", onWheel);
          if (resizeDebounceTimer !== null) {
            window.clearTimeout(resizeDebounceTimer);
          }
          observer?.disconnect();
          onDataDisposable.dispose();
          terminal.dispose();
        };
      } catch {
        setConnectionState("fallback");
      }
    })();

    return () => {
      isCancelled = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      requestResizeSync = () => {};
      cleanupTerminal();
      socket?.close();
    };
  }, [terminalId]);

  return (
    <div
      className={`tentacle-terminal${isSelected ? " tentacle-terminal--selected" : ""}`}
      data-selected={isSelected ? "true" : "false"}
      onFocusCapture={() => {
        onSelectTerminal?.(terminalId);
      }}
      onPointerDownCapture={() => {
        onSelectTerminal?.(terminalId);
      }}
    >
      <div className="terminal-header" data-connection-state={connectionState}>
        <span className="terminal-title">{terminalTitle}</span>
        {initialPrompt && !isPromptBannerDismissed && (
          <div className="terminal-prompt-banner">
            <button
              type="button"
              className="terminal-prompt-banner-inject"
              onClick={() => {
                const ws = socketRef.current;
                if (ws && ws.readyState === 1) {
                  ws.send(JSON.stringify({ type: "input", data: initialPrompt }));
                }
                setIsPromptBannerDismissed(true);
              }}
              title={initialPrompt}
            >
              <PromptInjectIcon />
              <span className="terminal-prompt-banner-text">
                {initialPrompt.length > 60 ? `${initialPrompt.slice(0, 60)}...` : initialPrompt}
              </span>
            </button>
            <button
              type="button"
              className="terminal-prompt-banner-close"
              aria-label="Dismiss prompt"
              onClick={() => {
                setIsPromptBannerDismissed(true);
              }}
            >
              &times;
            </button>
          </div>
        )}
        <div className="terminal-header-actions">
          <ActionButton
            aria-label={`Add terminal above ${terminalId}`}
            className="terminal-add terminal-add-up"
            onClick={() => {
              onAddAbove?.();
            }}
            size="compact"
            variant="info"
          >
            <TerminalAddIcon direction="up" />
          </ActionButton>
          <ActionButton
            aria-label={`Add terminal below ${terminalId}`}
            className="terminal-add terminal-add-down"
            onClick={() => {
              onAddBelow?.();
            }}
            size="compact"
            variant="info"
          >
            <TerminalAddIcon direction="down" />
          </ActionButton>
          <ActionButton
            aria-label={`Delete terminal ${terminalId}`}
            className="terminal-delete"
            disabled={!onDelete}
            onClick={() => {
              onDelete?.();
            }}
            size="compact"
            title={onDelete ? "Delete terminal" : "Root terminal cannot be deleted"}
            variant="danger"
          >
            <TerminalDeleteIcon />
          </ActionButton>
          <AgentStateBadge state={agentState} />
        </div>
      </div>
      <div
        ref={containerRef}
        className="terminal-mount"
        data-testid={`terminal-${terminalId}`}
        aria-label={`Terminal ${terminalId}`}
      />
    </div>
  );
};
