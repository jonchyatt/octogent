import type { OctopusAccessory, OctopusAnimation, OctopusExpression } from "./EmptyOctopus";
import { OctopusGlyph } from "./EmptyOctopus";

const ANIMATIONS: { label: string; animation: OctopusAnimation }[] = [
  { label: "Idle", animation: "idle" },
  { label: "Sway", animation: "sway" },
  { label: "Walk", animation: "walk" },
  { label: "Jog", animation: "jog" },
  { label: "Swim Up", animation: "swim-up" },
  { label: "Bounce", animation: "bounce" },
  { label: "Float", animation: "float" },
];

const EXPRESSIONS: { label: string; expression: OctopusExpression }[] = [
  { label: "Normal", expression: "normal" },
  { label: "Happy", expression: "happy" },
  { label: "Sleepy", expression: "sleepy" },
  { label: "Angry", expression: "angry" },
  { label: "Surprised", expression: "surprised" },
];

const COLORS = [
  { label: "Accent (default)" },
  { label: "Coral", hex: "#e05555" },
  { label: "Seafoam", hex: "#3cc9a3" },
  { label: "Lavender", hex: "#a78bfa" },
  { label: "Sky", hex: "#4a9eff" },
  { label: "Sunflower", hex: "#f5c542" },
] as const;

const ACCESSORIES: { label: string; accessory: OctopusAccessory }[] = [
  { label: "None", accessory: "none" },
  { label: "Hair", accessory: "hair" },
];

const SIZES: { label: string; scale: number }[] = [
  { label: "Small", scale: 7 },
  { label: "Medium", scale: 14 },
  { label: "Large", scale: 21 },
];

export const PixPackPrimaryView = () => (
  <section className="pixpack-view" aria-label="2D Pixel Pack">
    <header className="pixpack-header">
      <h2>2D Pixel Pack</h2>
    </header>

    <h3 className="pixpack-section-title">Animations</h3>
    <div className="pixpack-grid">
      {ANIMATIONS.map((a) => (
        <div key={a.label} className="pixpack-card">
          <OctopusGlyph animation={a.animation} />
          <span className="pixpack-card-label">{a.label}</span>
        </div>
      ))}
    </div>

    <h3 className="pixpack-section-title">Expressions</h3>
    <div className="pixpack-grid">
      {EXPRESSIONS.map((e) => (
        <div key={e.label} className="pixpack-card">
          <OctopusGlyph animation="idle" expression={e.expression} />
          <span className="pixpack-card-label">{e.label}</span>
        </div>
      ))}
    </div>

    <h3 className="pixpack-section-title">Colors</h3>
    <div className="pixpack-grid">
      {COLORS.map((c) => (
        <div key={c.label} className="pixpack-card">
          <OctopusGlyph {...("hex" in c ? { color: c.hex } : {})} animation="idle" />
          <span className="pixpack-card-label">{c.label}</span>
          {"hex" in c && <span className="pixpack-card-hex">{c.hex}</span>}
        </div>
      ))}
    </div>

    <h3 className="pixpack-section-title">Accessories</h3>
    <div className="pixpack-grid">
      {ACCESSORIES.map((a) => (
        <div key={a.label} className="pixpack-card">
          <OctopusGlyph animation="idle" accessory={a.accessory} />
          <span className="pixpack-card-label">{a.label}</span>
        </div>
      ))}
    </div>

    <h3 className="pixpack-section-title">Sizes</h3>
    <div className="pixpack-grid pixpack-grid--sizes">
      {SIZES.map((s) => (
        <div key={s.label} className="pixpack-card">
          <OctopusGlyph animation="sway" scale={s.scale} />
          <span className="pixpack-card-label">{s.label}</span>
          <span className="pixpack-card-hex">{s.scale}px/px</span>
        </div>
      ))}
    </div>
  </section>
);
