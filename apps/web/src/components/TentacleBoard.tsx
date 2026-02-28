import {
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  type RefObject,
} from "react";

import type { TentacleView, TentacleWorkspaceMode } from "../app/types";
import { TENTACLE_MIN_WIDTH } from "../layout/tentaclePaneSizing";
import type { CodexState } from "./CodexStateBadge";
import { EmptyOctopus } from "./EmptyOctopus";
import { TentacleTerminal } from "./TentacleTerminal";
import { ActionButton } from "./ui/ActionButton";

type TentacleBoardProps = {
  tentaclesRef: RefObject<HTMLElement | null>;
  tentacleNameInputRef: RefObject<HTMLInputElement | null>;
  isLoading: boolean;
  columns: TentacleView;
  visibleColumns: TentacleView;
  loadError: string | null;
  tentacleWidths: Record<string, number>;
  editingTentacleId: string | null;
  tentacleNameDraft: string;
  isDeletingTentacleId: string | null;
  onTentacleHeaderWheel: (event: ReactWheelEvent<HTMLElement>) => void;
  onTentacleNameDraftChange: (name: string) => void;
  onSubmitTentacleRename: (tentacleId: string, currentTentacleName: string) => void;
  onCancelTentacleRename: () => void;
  onBeginTentacleNameEdit: (tentacleId: string, currentTentacleName: string) => void;
  onMinimizeTentacle: (tentacleId: string) => void;
  onRequestDeleteTentacle: (tentacleId: string, tentacleName: string) => void;
  onTentacleStateChange: (tentacleId: string, state: CodexState) => void;
  onTentacleDividerKeyDown: (
    leftTentacleId: string,
    rightTentacleId: string,
  ) => (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onTentacleDividerPointerDown: (
    leftTentacleId: string,
    rightTentacleId: string,
  ) => (event: ReactPointerEvent<HTMLDivElement>) => void;
};

const renderTentacleWorkspaceLabel = (workspaceMode: TentacleWorkspaceMode) =>
  workspaceMode === "worktree" ? "WORKTREE" : "MAIN";

export const TentacleBoard = ({
  tentaclesRef,
  tentacleNameInputRef,
  isLoading,
  columns,
  visibleColumns,
  loadError,
  tentacleWidths,
  editingTentacleId,
  tentacleNameDraft,
  isDeletingTentacleId,
  onTentacleHeaderWheel,
  onTentacleNameDraftChange,
  onSubmitTentacleRename,
  onCancelTentacleRename,
  onBeginTentacleNameEdit,
  onMinimizeTentacle,
  onRequestDeleteTentacle,
  onTentacleStateChange,
  onTentacleDividerKeyDown,
  onTentacleDividerPointerDown,
}: TentacleBoardProps) => {
  return (
    <main
      ref={tentaclesRef}
      className="tentacles"
      aria-label="Tentacle board"
      onWheel={onTentacleHeaderWheel}
    >
      {isLoading && (
        <section className="empty-state" aria-label="Loading">
          <h2>Loading tentacles...</h2>
        </section>
      )}

      {!isLoading && columns.length === 0 && (
        <section className="empty-state" aria-label="Empty state">
          <EmptyOctopus />
          <h2>No active tentacles</h2>
          <p>When agents start, tentacles will appear here.</p>
          {loadError && <p className="empty-state-subtle">{loadError}</p>}
        </section>
      )}

      {!isLoading && columns.length > 0 && visibleColumns.length === 0 && (
        <section className="empty-state" aria-label="All minimized">
          <h2>All tentacles minimized</h2>
          <p>Use the Active Agents sidebar to maximize a tentacle.</p>
          {loadError && <p className="empty-state-subtle">{loadError}</p>}
        </section>
      )}

      {visibleColumns.map((column, index) => {
        const rightNeighbor = visibleColumns[index + 1];
        return (
          <Fragment key={column.tentacleId}>
            <section
              className="tentacle-column"
              aria-label={column.tentacleId}
              style={{
                width: `${tentacleWidths[column.tentacleId] ?? TENTACLE_MIN_WIDTH}px`,
              }}
            >
              <div className="tentacle-column-header">
                <div className="tentacle-column-heading">
                  {editingTentacleId === column.tentacleId ? (
                    <>
                      <input
                        ref={tentacleNameInputRef}
                        aria-label={`Tentacle name for ${column.tentacleId}`}
                        className="tentacle-name-editor"
                        onBlur={() => {
                          onSubmitTentacleRename(column.tentacleId, column.tentacleName);
                        }}
                        onChange={(event) => {
                          onTentacleNameDraftChange(event.target.value);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            onSubmitTentacleRename(column.tentacleId, column.tentacleName);
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            onCancelTentacleRename();
                          }
                        }}
                        type="text"
                        value={tentacleNameDraft}
                      />
                      <span
                        className={`tentacle-workspace-badge tentacle-workspace-badge--${column.tentacleWorkspaceMode}`}
                      >
                        {renderTentacleWorkspaceLabel(column.tentacleWorkspaceMode)}
                      </span>
                    </>
                  ) : (
                    <h2>
                      <button
                        className="tentacle-name-display"
                        onClick={() => {
                          onBeginTentacleNameEdit(column.tentacleId, column.tentacleName);
                        }}
                        type="button"
                      >
                        {column.tentacleName}
                      </button>
                      <span
                        className={`tentacle-workspace-badge tentacle-workspace-badge--${column.tentacleWorkspaceMode}`}
                      >
                        {renderTentacleWorkspaceLabel(column.tentacleWorkspaceMode)}
                      </span>
                    </h2>
                  )}
                </div>
                {editingTentacleId !== column.tentacleId && (
                  <div className="tentacle-header-actions">
                    <ActionButton
                      aria-label={`Minimize tentacle ${column.tentacleId}`}
                      className="tentacle-minimize"
                      onClick={() => {
                        onMinimizeTentacle(column.tentacleId);
                      }}
                      size="dense"
                      variant="info"
                    >
                      Minimize
                    </ActionButton>
                    <ActionButton
                      aria-label={`Rename tentacle ${column.tentacleId}`}
                      className="tentacle-rename"
                      onClick={() => {
                        onBeginTentacleNameEdit(column.tentacleId, column.tentacleName);
                      }}
                      size="dense"
                      variant="accent"
                    >
                      Rename
                    </ActionButton>
                    <ActionButton
                      aria-label={`Delete tentacle ${column.tentacleId}`}
                      className="tentacle-delete"
                      disabled={isDeletingTentacleId === column.tentacleId}
                      onClick={() => {
                        onRequestDeleteTentacle(column.tentacleId, column.tentacleName);
                      }}
                      size="dense"
                      variant="danger"
                    >
                      {isDeletingTentacleId === column.tentacleId ? "Deleting..." : "Delete"}
                    </ActionButton>
                  </div>
                )}
              </div>
              <TentacleTerminal
                tentacleId={column.tentacleId}
                onCodexStateChange={(state) => {
                  onTentacleStateChange(column.tentacleId, state);
                }}
              />
            </section>

            {rightNeighbor && (
              <div
                aria-label={`Resize between ${column.tentacleId} and ${rightNeighbor.tentacleId}`}
                aria-orientation="vertical"
                className="tentacle-divider"
                onKeyDown={onTentacleDividerKeyDown(column.tentacleId, rightNeighbor.tentacleId)}
                onPointerDown={onTentacleDividerPointerDown(
                  column.tentacleId,
                  rightNeighbor.tentacleId,
                )}
                role="separator"
                tabIndex={0}
              />
            )}
          </Fragment>
        );
      })}
    </main>
  );
};
