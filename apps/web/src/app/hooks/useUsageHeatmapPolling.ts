import { useCallback, useEffect, useRef, useState } from "react";

import { buildUsageHeatmapUrl } from "../../runtime/runtimeEndpoints";

export type UsageSlice = {
  key: string;
  tokens: number;
};

export type UsageDayEntry = {
  date: string;
  totalTokens: number;
  projects: UsageSlice[];
  models: UsageSlice[];
  sessions: number;
};

export type UsageChartData = {
  days: UsageDayEntry[];
  projects: string[];
  models: string[];
};

const POLL_INTERVAL_MS = 120_000;

export const useUsageHeatmapPolling = (options: { enabled: boolean }) => {
  const [heatmapData, setHeatmapData] = useState<UsageChartData | null>(null);
  const [isLoadingHeatmap, setIsLoadingHeatmap] = useState(false);
  const isInFlightRef = useRef(false);
  const isDisposedRef = useRef(false);

  const fetchHeatmap = useCallback(async () => {
    if (isDisposedRef.current || isInFlightRef.current) return;
    isInFlightRef.current = true;
    setIsLoadingHeatmap(true);

    try {
      const response = await fetch(buildUsageHeatmapUrl("all"), {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Usage chart request failed (${response.status})`);
      }

      const parsed = (await response.json()) as UsageChartData;
      if (!isDisposedRef.current) {
        setHeatmapData(parsed);
      }
    } catch {
      // silently ignore — data will remain null/stale
    } finally {
      isInFlightRef.current = false;
      if (!isDisposedRef.current) {
        setIsLoadingHeatmap(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!options.enabled) return;
    isDisposedRef.current = false;

    void fetchHeatmap();
    const timerId = window.setInterval(() => {
      void fetchHeatmap();
    }, POLL_INTERVAL_MS);

    return () => {
      isDisposedRef.current = true;
      window.clearInterval(timerId);
    };
  }, [options.enabled, fetchHeatmap]);

  const refresh = useCallback(() => {
    void fetchHeatmap();
  }, [fetchHeatmap]);

  return {
    heatmapData,
    isLoadingHeatmap,
    refreshHeatmap: refresh,
  };
};
