import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { buildUiStateUrl } from "../../runtime/runtimeEndpoints";
import type { PrimaryNavIndex } from "../constants";
import { DEFAULT_SIDEBAR_WIDTH, UI_STATE_SAVE_DEBOUNCE_MS } from "../constants";
import {
  DEFAULT_TENTACLE_COMPLETION_SOUND,
  type TentacleCompletionSoundId,
} from "../notificationSounds";
import { clampSidebarWidth, normalizeFrontendUiStateSnapshot } from "../normalizers";
import type { FrontendUiStateSnapshot, TentacleView } from "../types";

type UsePersistedUiStateOptions = {
  columns: TentacleView;
};

type UsePersistedUiStateResult = {
  activePrimaryNav: PrimaryNavIndex;
  setActivePrimaryNav: Dispatch<SetStateAction<PrimaryNavIndex>>;
  isUiStateHydrated: boolean;
  setIsUiStateHydrated: Dispatch<SetStateAction<boolean>>;
  isAgentsSidebarVisible: boolean;
  setIsAgentsSidebarVisible: Dispatch<SetStateAction<boolean>>;
  sidebarWidth: number;
  setSidebarWidth: Dispatch<SetStateAction<number>>;
  isActiveAgentsSectionExpanded: boolean;
  setIsActiveAgentsSectionExpanded: Dispatch<SetStateAction<boolean>>;
  isRuntimeStatusStripVisible: boolean;
  setIsRuntimeStatusStripVisible: Dispatch<SetStateAction<boolean>>;
  isMonitorVisible: boolean;
  setIsMonitorVisible: Dispatch<SetStateAction<boolean>>;
  isBottomTelemetryVisible: boolean;
  setIsBottomTelemetryVisible: Dispatch<SetStateAction<boolean>>;
  isCodexUsageVisible: boolean;
  setIsCodexUsageVisible: Dispatch<SetStateAction<boolean>>;
  isClaudeUsageVisible: boolean;
  setIsClaudeUsageVisible: Dispatch<SetStateAction<boolean>>;
  isClaudeUsageSectionExpanded: boolean;
  setIsClaudeUsageSectionExpanded: Dispatch<SetStateAction<boolean>>;
  isCodexUsageSectionExpanded: boolean;
  setIsCodexUsageSectionExpanded: Dispatch<SetStateAction<boolean>>;
  tentacleCompletionSound: TentacleCompletionSoundId;
  setTentacleCompletionSound: Dispatch<SetStateAction<TentacleCompletionSoundId>>;
  minimizedTentacleIds: string[];
  setMinimizedTentacleIds: Dispatch<SetStateAction<string[]>>;
  tentacleWidths: Record<string, number>;
  setTentacleWidths: Dispatch<SetStateAction<Record<string, number>>>;
  readUiState: (signal?: AbortSignal) => Promise<FrontendUiStateSnapshot | null>;
  applyHydratedUiState: (
    snapshot: FrontendUiStateSnapshot | null,
    nextColumns: TentacleView,
  ) => void;
};

export const usePersistedUiState = ({
  columns,
}: UsePersistedUiStateOptions): UsePersistedUiStateResult => {
  const [activePrimaryNav, setActivePrimaryNav] = useState<PrimaryNavIndex>(1);
  const [isAgentsSidebarVisible, setIsAgentsSidebarVisible] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isActiveAgentsSectionExpanded, setIsActiveAgentsSectionExpanded] = useState(true);
  const [isRuntimeStatusStripVisible, setIsRuntimeStatusStripVisible] = useState(true);
  const [isMonitorVisible, setIsMonitorVisible] = useState(true);
  const [isBottomTelemetryVisible, setIsBottomTelemetryVisible] = useState(true);
  const [isCodexUsageVisible, setIsCodexUsageVisible] = useState(true);
  const [isClaudeUsageVisible, setIsClaudeUsageVisible] = useState(true);
  const [isClaudeUsageSectionExpanded, setIsClaudeUsageSectionExpanded] = useState(true);
  const [isCodexUsageSectionExpanded, setIsCodexUsageSectionExpanded] = useState(true);
  const [tentacleCompletionSound, setTentacleCompletionSound] = useState<TentacleCompletionSoundId>(
    DEFAULT_TENTACLE_COMPLETION_SOUND,
  );
  const [isUiStateHydrated, setIsUiStateHydrated] = useState(false);
  const [minimizedTentacleIds, setMinimizedTentacleIds] = useState<string[]>([]);
  const [tentacleWidths, setTentacleWidths] = useState<Record<string, number>>({});

  const readUiState = useCallback(async (signal?: AbortSignal) => {
    try {
      const requestOptions: {
        method: "GET";
        headers: { Accept: string };
        signal?: AbortSignal;
      } = {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      };
      if (signal) {
        requestOptions.signal = signal;
      }

      const response = await fetch(buildUiStateUrl(), requestOptions);
      if (!response.ok) {
        return null;
      }

      return normalizeFrontendUiStateSnapshot(await response.json());
    } catch {
      return null;
    }
  }, []);

  const applyHydratedUiState = useCallback(
    (snapshot: FrontendUiStateSnapshot | null, nextColumns: TentacleView) => {
      if (!snapshot) {
        return;
      }

      if (
        snapshot.activePrimaryNav !== undefined &&
        snapshot.activePrimaryNav >= 1 &&
        snapshot.activePrimaryNav <= 7
      ) {
        setActivePrimaryNav(snapshot.activePrimaryNav as PrimaryNavIndex);
      }

      if (snapshot.isAgentsSidebarVisible !== undefined) {
        setIsAgentsSidebarVisible(snapshot.isAgentsSidebarVisible);
      }

      if (snapshot.sidebarWidth !== undefined) {
        setSidebarWidth(clampSidebarWidth(snapshot.sidebarWidth));
      }

      if (snapshot.isActiveAgentsSectionExpanded !== undefined) {
        setIsActiveAgentsSectionExpanded(snapshot.isActiveAgentsSectionExpanded);
      }

      if (snapshot.isRuntimeStatusStripVisible !== undefined) {
        setIsRuntimeStatusStripVisible(snapshot.isRuntimeStatusStripVisible);
      }

      if (snapshot.isMonitorVisible !== undefined) {
        setIsMonitorVisible(snapshot.isMonitorVisible);
      }

      if (snapshot.isBottomTelemetryVisible !== undefined) {
        setIsBottomTelemetryVisible(snapshot.isBottomTelemetryVisible);
      }

      if (snapshot.isCodexUsageVisible !== undefined) {
        setIsCodexUsageVisible(snapshot.isCodexUsageVisible);
      }

      if (snapshot.isClaudeUsageVisible !== undefined) {
        setIsClaudeUsageVisible(snapshot.isClaudeUsageVisible);
      }

      if (snapshot.isCodexUsageSectionExpanded !== undefined) {
        setIsCodexUsageSectionExpanded(snapshot.isCodexUsageSectionExpanded);
      }

      if (snapshot.isClaudeUsageSectionExpanded !== undefined) {
        setIsClaudeUsageSectionExpanded(snapshot.isClaudeUsageSectionExpanded);
      }

      if (snapshot.tentacleCompletionSound !== undefined) {
        setTentacleCompletionSound(snapshot.tentacleCompletionSound);
      }

      if (snapshot.minimizedTentacleIds) {
        const activeTentacleIds = new Set(nextColumns.map((column) => column.tentacleId));
        setMinimizedTentacleIds(
          snapshot.minimizedTentacleIds.filter((tentacleId) => activeTentacleIds.has(tentacleId)),
        );
      }

      if (snapshot.tentacleWidths) {
        const activeTentacleIds = new Set(nextColumns.map((column) => column.tentacleId));
        setTentacleWidths(
          Object.entries(snapshot.tentacleWidths).reduce<Record<string, number>>(
            (acc, [tentacleId, width]) => {
              if (activeTentacleIds.has(tentacleId)) {
                acc[tentacleId] = width;
              }
              return acc;
            },
            {},
          ),
        );
      }
    },
    [],
  );

  useEffect(() => {
    if (!isUiStateHydrated) {
      return;
    }

    const activeTentacleIds = new Set(columns.map((column) => column.tentacleId));
    const payload: FrontendUiStateSnapshot = {
      activePrimaryNav,
      isAgentsSidebarVisible,
      sidebarWidth: clampSidebarWidth(sidebarWidth),
      isActiveAgentsSectionExpanded,
      isRuntimeStatusStripVisible,
      isMonitorVisible,
      isBottomTelemetryVisible,
      isCodexUsageVisible,
      isClaudeUsageVisible,
      isClaudeUsageSectionExpanded,
      isCodexUsageSectionExpanded,
      tentacleCompletionSound,
      minimizedTentacleIds: minimizedTentacleIds.filter((tentacleId) =>
        activeTentacleIds.has(tentacleId),
      ),
      tentacleWidths: Object.entries(tentacleWidths).reduce<Record<string, number>>(
        (acc, [tentacleId, width]) => {
          if (activeTentacleIds.has(tentacleId)) {
            acc[tentacleId] = width;
          }
          return acc;
        },
        {},
      ),
    };

    const timerId = window.setTimeout(() => {
      void fetch(buildUiStateUrl(), {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }).catch((error: unknown) => {
        console.warn("[ui-state] Failed to persist UI state:", error);
      });
    }, UI_STATE_SAVE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [
    activePrimaryNav,
    columns,
    isActiveAgentsSectionExpanded,
    isAgentsSidebarVisible,
    isBottomTelemetryVisible,
    isRuntimeStatusStripVisible,
    isMonitorVisible,
    isCodexUsageVisible,
    isClaudeUsageVisible,
    isClaudeUsageSectionExpanded,
    isCodexUsageSectionExpanded,
    isUiStateHydrated,
    minimizedTentacleIds,
    sidebarWidth,
    tentacleCompletionSound,
    tentacleWidths,
  ]);

  return {
    activePrimaryNav,
    setActivePrimaryNav,
    isUiStateHydrated,
    setIsUiStateHydrated,
    isAgentsSidebarVisible,
    setIsAgentsSidebarVisible,
    sidebarWidth,
    setSidebarWidth,
    isActiveAgentsSectionExpanded,
    setIsActiveAgentsSectionExpanded,
    isRuntimeStatusStripVisible,
    setIsRuntimeStatusStripVisible,
    isMonitorVisible,
    setIsMonitorVisible,
    isBottomTelemetryVisible,
    setIsBottomTelemetryVisible,
    isCodexUsageVisible,
    setIsCodexUsageVisible,
    isClaudeUsageVisible,
    setIsClaudeUsageVisible,
    isClaudeUsageSectionExpanded,
    setIsClaudeUsageSectionExpanded,
    isCodexUsageSectionExpanded,
    setIsCodexUsageSectionExpanded,
    tentacleCompletionSound,
    setTentacleCompletionSound,
    minimizedTentacleIds,
    setMinimizedTentacleIds,
    tentacleWidths,
    setTentacleWidths,
    readUiState,
    applyHydratedUiState,
  };
};
