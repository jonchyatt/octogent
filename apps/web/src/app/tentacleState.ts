export const retainActiveTentacleIds = (
  tentacleIds: string[],
  activeTentacleIds: ReadonlySet<string>,
) => {
  const nextTentacleIds = tentacleIds.filter((tentacleId) => activeTentacleIds.has(tentacleId));
  return nextTentacleIds.length === tentacleIds.length ? tentacleIds : nextTentacleIds;
};

export const retainActiveTentacleEntries = <TState>(
  state: Record<string, TState>,
  activeTentacleIds: ReadonlySet<string>,
) => {
  const retainedStateEntries = Object.entries(state).filter(([tentacleId]) =>
    activeTentacleIds.has(tentacleId),
  );
  if (retainedStateEntries.length === Object.keys(state).length) {
    return state;
  }

  return Object.fromEntries(retainedStateEntries);
};
