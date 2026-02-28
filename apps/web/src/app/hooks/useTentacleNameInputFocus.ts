import { useEffect } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";

import type { TentacleView } from "../types";

type UseTentacleNameInputFocusOptions = {
  columns: TentacleView;
  editingTentacleId: string | null;
  setEditingTentacleId: Dispatch<SetStateAction<string | null>>;
  tentacleNameInputRef: RefObject<HTMLInputElement | null>;
};

export const useTentacleNameInputFocus = ({
  columns,
  editingTentacleId,
  setEditingTentacleId,
  tentacleNameInputRef,
}: UseTentacleNameInputFocusOptions) => {
  useEffect(() => {
    if (!editingTentacleId) {
      return;
    }

    if (!columns.some((column) => column.tentacleId === editingTentacleId)) {
      setEditingTentacleId(null);
      return;
    }

    const input = tentacleNameInputRef.current;
    if (!input) {
      return;
    }

    input.focus();
    input.select();
  }, [columns, editingTentacleId, setEditingTentacleId, tentacleNameInputRef]);
};
