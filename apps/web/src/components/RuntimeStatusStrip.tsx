import { GITHUB_SPARKLINE_HEIGHT, GITHUB_SPARKLINE_WIDTH } from "../app/constants";

type RuntimeStatusStripProps = {
  githubRepoLabel: string;
  githubStarCountLabel: string;
  githubStatusPill: string;
  sparklinePoints: string;
  githubOpenIssuesLabel: string;
  githubOpenPrsLabel: string;
  githubCommitCount30d: number;
};

export const RuntimeStatusStrip = ({
  githubRepoLabel,
  githubStarCountLabel,
  githubStatusPill,
  sparklinePoints,
  githubOpenIssuesLabel,
  githubOpenPrsLabel,
  githubCommitCount30d,
}: RuntimeStatusStripProps) => {
  return (
    <section className="console-status-strip" aria-label="Runtime status strip">
      <div className="console-status-main">
        <span className="console-status-symbol">{githubRepoLabel}</span>
        <span className="console-status-stars" aria-label={`GitHub stars ${githubStarCountLabel}`}>
          <svg aria-hidden="true" className="console-status-star-icon" viewBox="0 0 16 16">
            <path d="M8 .25l2.2 4.69 5.18.8-3.73 3.82.88 5.44L8 12.62 3.47 15l.88-5.44L.62 5.74l5.18-.8L8 .25z" />
          </svg>
          <strong className="console-status-metric">{githubStarCountLabel}</strong>
        </span>
        <span className="console-status-pill">{githubStatusPill}</span>
      </div>
      <div className="console-status-sparkline" aria-label="Commits per day over last 30 days">
        <div className="console-status-sparkline-chart">
          <svg
            viewBox={`0 0 ${GITHUB_SPARKLINE_WIDTH} ${GITHUB_SPARKLINE_HEIGHT}`}
            role="presentation"
          >
            <polyline points={sparklinePoints} />
          </svg>
        </div>
        <span className="console-status-sparkline-label">COMMITS/DAY · LAST 30 DAYS</span>
      </div>
      <dl className="console-status-stats">
        <div>
          <dd>{githubOpenIssuesLabel}</dd>
          <dt>ISSUES</dt>
        </div>
        <div>
          <dd>{githubOpenPrsLabel}</dd>
          <dt>PRS</dt>
        </div>
        <div>
          <dd>{githubCommitCount30d}</dd>
          <dt>COMMITS 30D</dt>
        </div>
      </dl>
    </section>
  );
};
