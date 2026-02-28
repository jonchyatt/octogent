import { ActionButton } from "./ui/ActionButton";

type PendingDeleteTentacle = {
  tentacleId: string;
  tentacleName: string;
};

type DeleteTentacleDialogProps = {
  pendingDeleteTentacle: PendingDeleteTentacle;
  isDeletingTentacleId: string | null;
  onCancel: () => void;
  onConfirmDelete: () => void;
};

export const DeleteTentacleDialog = ({
  pendingDeleteTentacle,
  isDeletingTentacleId,
  onCancel,
  onConfirmDelete,
}: DeleteTentacleDialogProps) => {
  return (
    <div className="delete-confirm-backdrop" role="presentation">
      <dialog
        aria-label={`Delete confirmation for ${pendingDeleteTentacle.tentacleName}`}
        className="delete-confirm-dialog"
        onKeyDown={(event) => {
          if (event.key !== "Escape" || isDeletingTentacleId !== null) {
            return;
          }
          event.preventDefault();
          onCancel();
        }}
        open
      >
        <header className="delete-confirm-header">
          <h2>Delete Tentacle</h2>
          <span className="pill blocked">DESTRUCTIVE</span>
        </header>
        <div className="delete-confirm-body">
          <p className="delete-confirm-message">
            Delete <strong>{pendingDeleteTentacle.tentacleName}</strong> and terminate all of its
            active sessions.
          </p>
          <p className="delete-confirm-warning">This action cannot be undone.</p>
          <dl className="delete-confirm-details">
            <div>
              <dt>Name</dt>
              <dd>{pendingDeleteTentacle.tentacleName}</dd>
            </div>
            <div>
              <dt>ID</dt>
              <dd>{pendingDeleteTentacle.tentacleId}</dd>
            </div>
          </dl>
        </div>
        <div className="delete-confirm-actions">
          <ActionButton
            aria-label="Cancel delete"
            className="delete-confirm-cancel"
            onClick={onCancel}
            size="dense"
            variant="accent"
          >
            Cancel
          </ActionButton>
          <ActionButton
            aria-label={`Confirm delete ${pendingDeleteTentacle.tentacleId}`}
            className="delete-confirm-submit"
            disabled={isDeletingTentacleId === pendingDeleteTentacle.tentacleId}
            onClick={onConfirmDelete}
            size="dense"
            variant="danger"
          >
            {isDeletingTentacleId === pendingDeleteTentacle.tentacleId ? "Deleting..." : "Delete"}
          </ActionButton>
        </div>
      </dialog>
    </div>
  );
};
