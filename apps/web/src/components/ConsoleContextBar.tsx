import type { RefObject } from "react";

type ConsoleContextBarProps = {
  tickerInputRef: RefObject<HTMLInputElement | null>;
  tickerQuery: string;
  onTickerQueryChange: (value: string) => void;
  activeNavLabel: string;
};

export const ConsoleContextBar = ({
  tickerInputRef,
  tickerQuery,
  onTickerQueryChange,
  activeNavLabel,
}: ConsoleContextBarProps) => (
  <div className="console-canvas-controls">
    <label className="console-context-label" htmlFor="console-context-input">
      Context
    </label>
    <input
      id="console-context-input"
      ref={tickerInputRef}
      aria-label="Context search input"
      autoComplete="off"
      className="console-context-input"
      onChange={(event) => {
        onTickerQueryChange(event.target.value);
      }}
      placeholder="Type agent, repo, or branch..."
      type="text"
      value={tickerQuery}
    />
    <div className="console-page-chips" aria-hidden="true">
      <span className="console-chip console-chip--active">{activeNavLabel}</span>
      <span className="console-chip">1D</span>
      <span className="console-chip">1H</span>
      <span className="console-chip">6H</span>
      <span className="console-chip">24H</span>
    </div>
  </div>
);
