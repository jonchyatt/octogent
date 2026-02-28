import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";

import { retainActiveTentacleEntries, retainActiveTentacleIds } from "../tentacleState";
import type { TentacleView } from "../types";

type UseTentacleStateReconciliationOptions<TState> = {
  columns: TentacleView;
  setMinimizedTentacleIds: Dispatch<SetStateAction<string[]>>;
  setTentacleStates: Dispatch<SetStateAction<Record<string, TState>>>;
};

export const useTentacleStateReconciliation = <TState>({
  columns,
  setMinimizedTentacleIds,
  setTentacleStates,
}: UseTentacleStateReconciliationOptions<TState>) => {
  useEffect(() => {
    const activeTentacleIds = new Set(columns.map((column) => column.tentacleId));
    setMinimizedTentacleIds((current) => retainActiveTentacleIds(current, activeTentacleIds));
    setTentacleStates((current) => retainActiveTentacleEntries(current, activeTentacleIds));
  }, [columns, setMinimizedTentacleIds, setTentacleStates]);
};
