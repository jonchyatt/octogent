import { useEffect, useMemo, useState } from "react";

import type { MonitorConfigSnapshot, MonitorFeedSnapshot } from "../app/types";
import { ActionButton } from "./ui/ActionButton";

type MonitorPrimaryViewProps = {
  monitorConfig: MonitorConfigSnapshot | null;
  monitorFeed: MonitorFeedSnapshot | null;
  monitorError: string | null;
  isRefreshingMonitorFeed: boolean;
  isSavingMonitorConfig: boolean;
  onRefresh: () => void;
  onPatchConfig: (patch: {
    providerId: "x";
    queryTerms: string[];
    credentials?: {
      bearerToken?: string;
    };
    validateCredentials: boolean;
  }) => Promise<boolean>;
};

type MonitorSubtabId = "resources" | "configure";
type MonitorProviderId = "x";

const MONITOR_PROVIDER_TABS: Array<{
  id: MonitorProviderId;
  label: string;
  icon: string;
}> = [{ id: "x", label: "X Monitor", icon: "𝕏" }];

const MONITOR_SUBTABS: Array<{ id: MonitorSubtabId; label: string }> = [
  { id: "resources", label: "Resources" },
  { id: "configure", label: "Configure" },
];

const normalizeTerms = (terms: string[]): string[] => {
  const split = terms
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
  return [...new Set(split)];
};

const formatTimestamp = (value: string | null) => {
  if (!value) {
    return "--";
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

export const MonitorPrimaryView = ({
  monitorConfig,
  monitorFeed,
  monitorError,
  isRefreshingMonitorFeed,
  isSavingMonitorConfig,
  onRefresh,
  onPatchConfig,
}: MonitorPrimaryViewProps) => {
  const activeProviderId: MonitorProviderId = "x";
  const [activeSubtab, setActiveSubtab] = useState<MonitorSubtabId>("resources");
  const [queryTermsDraft, setQueryTermsDraft] = useState<string[]>([]);
  const [queryTermInput, setQueryTermInput] = useState("");
  const [bearerToken, setBearerToken] = useState("");

  useEffect(() => {
    if (!monitorConfig) {
      return;
    }

    setQueryTermsDraft(normalizeTerms(monitorConfig.queryTerms));
  }, [monitorConfig]);

  const usageCapLabel = useMemo(() => {
    if (!monitorFeed?.usage?.cap && monitorFeed?.usage?.cap !== 0) {
      return "--";
    }

    return Math.round(monitorFeed.usage.cap).toLocaleString("en-US");
  }, [monitorFeed]);

  const usageUsedLabel = useMemo(() => {
    if (!monitorFeed?.usage?.used && monitorFeed?.usage?.used !== 0) {
      return "--";
    }

    return Math.round(monitorFeed.usage.used).toLocaleString("en-US");
  }, [monitorFeed]);

  const usageRemainingLabel = useMemo(() => {
    if (!monitorFeed?.usage?.remaining && monitorFeed?.usage?.remaining !== 0) {
      return "--";
    }

    return Math.round(monitorFeed.usage.remaining).toLocaleString("en-US");
  }, [monitorFeed]);

  const credentialsSummary = monitorConfig?.providers.x.credentials;
  const canSaveQueryTerms = queryTermsDraft.length > 0;

  const appendQueryTerm = (raw: string) => {
    const nextTerms = normalizeTerms(raw.split(/[\n,]/));
    if (nextTerms.length === 0) {
      return;
    }

    setQueryTermsDraft((current) => normalizeTerms([...current, ...nextTerms]));
    setQueryTermInput("");
  };

  const removeQueryTerm = (termToRemove: string) => {
    setQueryTermsDraft((current) => current.filter((term) => term !== termToRemove));
  };

  return (
    <section className="monitor-view" aria-label="Monitor primary view">
      <header className="monitor-header">
        <div className="monitor-header-main">
          <nav className="monitor-provider-tabs" aria-label="Monitor providers">
            {MONITOR_PROVIDER_TABS.map((provider) => (
              <button
                aria-current={activeProviderId === provider.id ? "page" : undefined}
                className="monitor-provider-tab"
                data-active={activeProviderId === provider.id ? "true" : "false"}
                key={provider.id}
                type="button"
              >
                <span aria-hidden="true" className="monitor-provider-tab-icon">
                  {provider.icon}
                </span>
                <span>{provider.label}</span>
              </button>
            ))}
          </nav>

          <nav className="monitor-subtabs" aria-label="Monitor subtabs">
            {MONITOR_SUBTABS.map((subtab) => (
              <button
                aria-current={activeSubtab === subtab.id ? "page" : undefined}
                className="monitor-subtab"
                data-active={activeSubtab === subtab.id ? "true" : "false"}
                key={subtab.id}
                onClick={() => {
                  setActiveSubtab(subtab.id);
                }}
                type="button"
              >
                {subtab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="monitor-header-actions">
          <span className="console-status-pill" data-state={monitorFeed?.isStale ? "stale" : "fresh"}>
            {monitorFeed?.isStale ? "STALE" : "FRESH"}
          </span>
          <ActionButton
            aria-label="Refresh monitor feed"
            className="monitor-refresh"
            disabled={isRefreshingMonitorFeed}
            onClick={onRefresh}
            size="dense"
            variant="accent"
          >
            {isRefreshingMonitorFeed ? "Refreshing..." : "Refresh"}
          </ActionButton>
        </div>
      </header>

      {activeSubtab === "configure" ? (
        <section className="monitor-panel-grid monitor-panel-grid--configure" aria-label="Monitor configuration">
          <section className="monitor-panel monitor-panel--connection" aria-label="X connection settings">
            <h3>X Connection</h3>
            <label htmlFor="monitor-x-bearer-token">X bearer token</label>
            <input
              id="monitor-x-bearer-token"
              autoComplete="off"
              className="monitor-input"
              onChange={(event) => {
                setBearerToken(event.target.value);
              }}
              placeholder={credentialsSummary?.isConfigured ? "Saved token is redacted" : "Paste X bearer token"}
              type="password"
              value={bearerToken}
            />

            <ActionButton
              aria-label="Save X credentials"
              className="monitor-save"
              disabled={isSavingMonitorConfig}
              onClick={() => {
                const nextTerms = normalizeTerms(queryTermsDraft);
                const patchCredentials: {
                  bearerToken?: string;
                } = {};
                if (bearerToken.trim().length > 0) {
                  patchCredentials.bearerToken = bearerToken.trim();
                }
                const hasCredentialPatch = Object.keys(patchCredentials).length > 0;
                const patchPayload = {
                  providerId: "x" as const,
                  queryTerms: nextTerms,
                  validateCredentials: true,
                  ...(hasCredentialPatch ? { credentials: patchCredentials } : {}),
                };

                void onPatchConfig(patchPayload).then((saved) => {
                  if (!saved) {
                    return;
                  }

                  setBearerToken("");
                });
              }}
              size="dense"
              variant="primary"
            >
              {isSavingMonitorConfig ? "Saving..." : "Save X credentials"}
            </ActionButton>

            {credentialsSummary && (
              <p className="monitor-credentials-meta">
                {credentialsSummary.isConfigured
                  ? `Saved · token ${credentialsSummary.bearerTokenHint ?? "(redacted)"}`
                  : "Not configured"}
              </p>
            )}
          </section>

          <section className="monitor-panel monitor-panel--query" aria-label="Monitor query settings">
            <h3>Target terms</h3>
            <div className="monitor-query-terms-list" role="list" aria-label="Monitor query terms">
              {queryTermsDraft.map((term) => (
                <div className="monitor-query-term" key={term} role="listitem">
                  <span>{term}</span>
                  <button
                    aria-label={`Remove query term ${term}`}
                    onClick={() => {
                      removeQueryTerm(term);
                    }}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              ))}
              {queryTermsDraft.length === 0 ? (
                <p className="monitor-query-empty">Add at least one query term to save.</p>
              ) : null}
            </div>
            <div className="monitor-query-term-form">
              <input
                aria-label="Add monitor query term"
                className="monitor-input"
                onChange={(event) => {
                  setQueryTermInput(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    appendQueryTerm(queryTermInput);
                  }
                }}
                placeholder="Add term and press Enter"
                type="text"
                value={queryTermInput}
              />
              <ActionButton
                aria-label="Add query term"
                className="monitor-query-add"
                onClick={() => {
                  appendQueryTerm(queryTermInput);
                }}
                size="dense"
                variant="info"
              >
                Add
              </ActionButton>
            </div>
            <ActionButton
              aria-label="Save monitor query terms"
              className="monitor-query-save"
              disabled={isSavingMonitorConfig || !canSaveQueryTerms}
              onClick={() => {
                void onPatchConfig({
                  providerId: "x",
                  queryTerms: normalizeTerms(queryTermsDraft),
                  validateCredentials: false,
                });
              }}
              size="dense"
              variant="primary"
            >
              {isSavingMonitorConfig ? "Saving..." : "Save Terms"}
            </ActionButton>
            <p>Recent search window is limited to the last 7 days.</p>
          </section>
        </section>
      ) : (
        <section className="monitor-resources" aria-label="Monitor resources">
          <section className="monitor-panel monitor-panel--status" aria-label="Monitor status metrics">
            <h3>Status</h3>
            <dl>
              <div>
                <dt>Last sync</dt>
                <dd>{formatTimestamp(monitorFeed?.lastFetchedAt ?? null)}</dd>
              </div>
              <div>
                <dt>Stale after</dt>
                <dd>{formatTimestamp(monitorFeed?.staleAfter ?? null)}</dd>
              </div>
              <div>
                <dt>Usage cap</dt>
                <dd>{usageCapLabel}</dd>
              </div>
              <div>
                <dt>Used</dt>
                <dd>{usageUsedLabel}</dd>
              </div>
              <div>
                <dt>Remaining</dt>
                <dd>{usageRemainingLabel}</dd>
              </div>
              <div>
                <dt>Resets</dt>
                <dd>{formatTimestamp(monitorFeed?.usage?.resetAt ?? null)}</dd>
              </div>
            </dl>
          </section>

          <section className="monitor-feed" aria-label="Monitor feed results">
            <header>
              <h3>Top posts by likes</h3>
              <span>{`${monitorFeed?.posts.length ?? 0} / 30`}</span>
            </header>
            {monitorError ? <p className="monitor-error">{monitorError}</p> : null}
            {monitorFeed?.lastError ? <p className="monitor-error">{monitorFeed.lastError}</p> : null}
            {monitorFeed && monitorFeed.posts.length === 0 ? (
              <p className="monitor-empty">No posts available yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th scope="col">Likes</th>
                    <th scope="col">Author</th>
                    <th scope="col">Post</th>
                    <th scope="col">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {(monitorFeed?.posts ?? []).map((post) => (
                    <tr key={`${post.source}:${post.id}`}>
                      <td>{Math.round(post.likeCount).toLocaleString("en-US")}</td>
                      <td>@{post.author}</td>
                      <td>
                        <a href={post.permalink} rel="noreferrer" target="_blank">
                          {post.text}
                        </a>
                      </td>
                      <td>{formatTimestamp(post.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </section>
      )}
    </section>
  );
};
