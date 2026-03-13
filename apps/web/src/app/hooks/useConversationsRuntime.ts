import { useCallback, useEffect, useRef, useState } from "react";

import {
  buildConversationExportUrl,
  buildConversationSessionUrl,
  buildConversationsUrl,
} from "../../runtime/runtimeEndpoints";
import {
  normalizeConversationSessionDetail,
  normalizeConversationSessionSummary,
} from "../normalizers";
import type { ConversationSessionDetail, ConversationSessionSummary } from "../types";

type ConversationExportFormat = "json" | "md";

type ConversationExportResult = {
  filename: string;
  contentType: string;
  content: string;
};

type UseConversationsRuntimeOptions = {
  enabled?: boolean;
};

type UseConversationsRuntimeResult = {
  sessions: ConversationSessionSummary[];
  selectedSessionId: string | null;
  selectedSession: ConversationSessionDetail | null;
  isLoadingSessions: boolean;
  isLoadingSelectedSession: boolean;
  isExporting: boolean;
  isClearing: boolean;
  errorMessage: string | null;
  selectSession: (sessionId: string) => void;
  refreshSessions: () => Promise<void>;
  clearAllSessions: () => Promise<void>;
  exportSession: (
    sessionId: string,
    format: ConversationExportFormat,
  ) => Promise<ConversationExportResult | null>;
};

const buildErrorMessage = (fallback: string, error: unknown) =>
  error instanceof Error && error.message.length > 0 ? error.message : fallback;

const buildExportFilename = (sessionId: string, format: ConversationExportFormat) =>
  `${sessionId}.${format === "json" ? "json" : "md"}`;

export const useConversationsRuntime = ({
  enabled = true,
}: UseConversationsRuntimeOptions = {}): UseConversationsRuntimeResult => {
  const [sessions, setSessions] = useState<ConversationSessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<ConversationSessionDetail | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isLoadingSelectedSession, setIsLoadingSelectedSession] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const selectedSessionRequestRef = useRef(0);

  const refreshSessions = useCallback(async () => {
    if (!enabled) {
      return;
    }

    setIsLoadingSessions(true);
    try {
      const response = await fetch(buildConversationsUrl(), {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Unable to read conversations (${response.status})`);
      }

      const payload = (await response.json()) as unknown;
      const normalized = Array.isArray(payload)
        ? payload
            .map((entry) => normalizeConversationSessionSummary(entry))
            .filter((entry): entry is ConversationSessionSummary => entry !== null)
        : [];
      setSessions(normalized);
      setSelectedSessionId((current) => {
        if (current && normalized.some((session) => session.sessionId === current)) {
          return current;
        }

        return normalized[0]?.sessionId ?? null;
      });
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(buildErrorMessage("Unable to load conversations.", error));
    } finally {
      setIsLoadingSessions(false);
    }
  }, [enabled]);

  const clearAllSessions = useCallback(async () => {
    if (!enabled) {
      return;
    }

    setIsClearing(true);
    try {
      const response = await fetch(buildConversationsUrl(), {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(`Unable to clear conversations (${response.status})`);
      }

      setSessions([]);
      setSelectedSessionId(null);
      setSelectedSession(null);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(buildErrorMessage("Unable to clear conversations.", error));
    } finally {
      setIsClearing(false);
    }
  }, [enabled]);

  const selectSession = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId);
  }, []);

  const exportSession = useCallback(
    async (
      sessionId: string,
      format: ConversationExportFormat,
    ): Promise<ConversationExportResult | null> => {
      if (!enabled) {
        return null;
      }

      setIsExporting(true);
      try {
        const response = await fetch(buildConversationExportUrl(sessionId, format), {
          method: "GET",
          headers: {
            Accept: format === "json" ? "application/json" : "text/markdown",
          },
        });

        if (!response.ok) {
          throw new Error(`Unable to export conversation (${response.status})`);
        }

        if (format === "json") {
          const payload = (await response.json()) as unknown;
          const normalized = normalizeConversationSessionDetail(payload);
          const json = `${JSON.stringify(normalized ?? payload, null, 2)}\n`;
          return {
            filename: buildExportFilename(sessionId, "json"),
            contentType: "application/json",
            content: json,
          };
        }

        const markdown = await response.text();
        return {
          filename: buildExportFilename(sessionId, "md"),
          contentType: "text/markdown",
          content: markdown,
        };
      } catch (error) {
        setErrorMessage(buildErrorMessage("Unable to export conversation.", error));
        return null;
      } finally {
        setIsExporting(false);
      }
    },
    [enabled],
  );

  useEffect(() => {
    if (!enabled) {
      setSessions([]);
      setSelectedSessionId(null);
      setSelectedSession(null);
      setIsLoadingSessions(false);
      setIsLoadingSelectedSession(false);
      setIsExporting(false);
      setIsClearing(false);
      setErrorMessage(null);
      return;
    }

    void refreshSessions();
  }, [enabled, refreshSessions]);

  useEffect(() => {
    if (!enabled || !selectedSessionId) {
      setSelectedSession(null);
      return;
    }

    const requestId = selectedSessionRequestRef.current + 1;
    selectedSessionRequestRef.current = requestId;
    setIsLoadingSelectedSession(true);

    const loadSelectedSession = async () => {
      try {
        const response = await fetch(buildConversationSessionUrl(selectedSessionId), {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(`Unable to read conversation (${response.status})`);
        }

        const payload = normalizeConversationSessionDetail(await response.json());
        if (!payload) {
          throw new Error("Conversation response is invalid.");
        }

        if (selectedSessionRequestRef.current === requestId) {
          setSelectedSession(payload);
          setErrorMessage(null);
        }
      } catch (error) {
        if (selectedSessionRequestRef.current === requestId) {
          setSelectedSession(null);
          setErrorMessage(buildErrorMessage("Unable to read conversation.", error));
        }
      } finally {
        if (selectedSessionRequestRef.current === requestId) {
          setIsLoadingSelectedSession(false);
        }
      }
    };

    void loadSelectedSession();
  }, [enabled, selectedSessionId]);

  return {
    sessions,
    selectedSessionId,
    selectedSession,
    isLoadingSessions,
    isLoadingSelectedSession,
    isExporting,
    isClearing,
    errorMessage,
    selectSession,
    refreshSessions,
    clearAllSessions,
    exportSession,
  };
};
