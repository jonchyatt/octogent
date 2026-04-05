import {
  TERMINAL_COMPLETION_SOUND_OPTIONS,
  type TerminalCompletionSoundId,
} from "../app/notificationSounds";
import { ActionButton } from "./ui/ActionButton";
import { SettingsToggle } from "./ui/SettingsToggle";

type SettingsPrimaryViewProps = {
  terminalCompletionSound: TerminalCompletionSoundId;
  isRuntimeStatusStripVisible: boolean;
  isMonitorVisible: boolean;
  isCodexUsageVisible: boolean;
  isClaudeUsageVisible: boolean;
  onTerminalCompletionSoundChange: (soundId: TerminalCompletionSoundId) => void;
  onPreviewTerminalCompletionSound: (soundId: TerminalCompletionSoundId) => void;
  onRuntimeStatusStripVisibilityChange: (visible: boolean) => void;
  onMonitorVisibilityChange: (visible: boolean) => void;
  onCodexUsageVisibilityChange: (visible: boolean) => void;
  onClaudeUsageVisibilityChange: (visible: boolean) => void;
};

export const SettingsPrimaryView = ({
  terminalCompletionSound,
  isRuntimeStatusStripVisible,
  isMonitorVisible,
  isCodexUsageVisible,
  isClaudeUsageVisible,
  onTerminalCompletionSoundChange,
  onPreviewTerminalCompletionSound,
  onRuntimeStatusStripVisibilityChange,
  onMonitorVisibilityChange,
  onCodexUsageVisibilityChange,
  onClaudeUsageVisibilityChange,
}: SettingsPrimaryViewProps) => (
  <section className="settings-view" aria-label="Settings primary view">
    <section className="settings-panel" aria-label="Completion notification settings">
      <header className="settings-panel-header">
        <h2>Tentacle completion sound</h2>
        <p>Play a notification when a tentacle moves from processing to idle.</p>
      </header>

      <div
        className="settings-sound-picker"
        role="radiogroup"
        aria-label="Tentacle completion notification sound"
      >
        {TERMINAL_COMPLETION_SOUND_OPTIONS.map((option) => (
          <button
            aria-checked={terminalCompletionSound === option.id}
            className="settings-sound-option"
            data-active={terminalCompletionSound === option.id ? "true" : "false"}
            key={option.id}
            onClick={() => {
              onTerminalCompletionSoundChange(option.id);
              onPreviewTerminalCompletionSound(option.id);
            }}
            role="radio"
            type="button"
          >
            <span className="settings-sound-option-label">{option.label}</span>
            <span className="settings-sound-option-description">{option.description}</span>
          </button>
        ))}
      </div>

      <div className="settings-panel-actions">
        <ActionButton
          aria-label="Preview selected completion sound"
          className="settings-sound-preview"
          onClick={() => {
            onPreviewTerminalCompletionSound(terminalCompletionSound);
          }}
          size="dense"
          variant="accent"
        >
          Preview
        </ActionButton>
        <span className="settings-saved-pill">Saved to workspace</span>
      </div>
    </section>
    <section className="settings-panel" aria-label="Workspace surface visibility settings">
      <header className="settings-panel-header">
        <h2>Workspace surface visibility</h2>
        <p>Enable or disable monitor surfaces in the main workspace shell.</p>
      </header>

      <div className="settings-toggle-grid" role="group" aria-label="Workspace surface visibility">
        <SettingsToggle
          label="X Monitor"
          description="Auto-fetch X feed and show monitor tab"
          ariaLabel="Enable X Monitor"
          checked={isMonitorVisible}
          onChange={onMonitorVisibilityChange}
        />
        <SettingsToggle
          label="Runtime status strip"
          description="Top console status strip metrics"
          ariaLabel="Show runtime status strip"
          checked={isRuntimeStatusStripVisible}
          onChange={onRuntimeStatusStripVisibilityChange}
        />
      </div>
    </section>
    <section className="settings-panel" aria-label="Usage telemetry visibility settings">
      <header className="settings-panel-header">
        <h2>Usage telemetry visibility</h2>
        <p>Enable or disable sidebar usage sections for Codex and Claude Code.</p>
      </header>

      <div className="settings-toggle-grid" role="group" aria-label="Usage telemetry visibility">
        <SettingsToggle
          label="Codex token usage"
          description="Active Agents sidebar footer"
          ariaLabel="Show Codex token usage in sidebar"
          checked={isCodexUsageVisible}
          onChange={onCodexUsageVisibilityChange}
        />
        <SettingsToggle
          label="Claude token usage"
          description="Active Agents sidebar footer"
          ariaLabel="Show Claude token usage in sidebar"
          checked={isClaudeUsageVisible}
          onChange={onClaudeUsageVisibilityChange}
        />
      </div>
    </section>
  </section>
);
