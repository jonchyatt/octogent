import { TELEMETRY_TAPE_ITEMS } from "../app/constants";

export const TelemetryTape = () => {
  return (
    <section className="console-telemetry-tape" aria-label="Telemetry ticker tape">
      <div className="console-telemetry-track">
        {[...TELEMETRY_TAPE_ITEMS, ...TELEMETRY_TAPE_ITEMS].map((item, index) => (
          <span
            className={`console-telemetry-item ${item.change >= 0 ? "is-up" : "is-down"}`}
            key={`${item.symbol}-${index}`}
          >
            <strong>{item.symbol}</strong>
            <span>
              {item.change >= 0 ? `+${item.change.toFixed(2)}%` : `${item.change.toFixed(2)}%`}
            </span>
          </span>
        ))}
      </div>
    </section>
  );
};
