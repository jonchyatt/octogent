import {
  TENTACLE_COMPLETION_SOUND_OPTIONS,
  type TentacleCompletionSoundId,
} from "../app/notificationSounds";
import { ActionButton } from "./ui/ActionButton";

type SettingsPrimaryViewProps = {
  tentacleCompletionSound: TentacleCompletionSoundId;
  isRuntimeStatusStripVisible: boolean;
  isMonitorVisible: boolean;
  isBottomTelemetryVisible: boolean;
  isCodexUsageVisible: boolean;
  isClaudeUsageVisible: boolean;
  onTentacleCompletionSoundChange: (soundId: TentacleCompletionSoundId) => void;
  onPreviewTentacleCompletionSound: (soundId: TentacleCompletionSoundId) => void;
  onRuntimeStatusStripVisibilityChange: (visible: boolean) => void;
  onMonitorVisibilityChange: (visible: boolean) => void;
  onBottomTelemetryVisibilityChange: (visible: boolean) => void;
  onCodexUsageVisibilityChange: (visible: boolean) => void;
  onClaudeUsageVisibilityChange: (visible: boolean) => void;
};

export const SettingsPrimaryView = ({
  tentacleCompletionSound,
  isRuntimeStatusStripVisible,
  isMonitorVisible,
  isBottomTelemetryVisible,
  isCodexUsageVisible,
  isClaudeUsageVisible,
  onTentacleCompletionSoundChange,
  onPreviewTentacleCompletionSound,
  onRuntimeStatusStripVisibilityChange,
  onMonitorVisibilityChange,
  onBottomTelemetryVisibilityChange,
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
        {TENTACLE_COMPLETION_SOUND_OPTIONS.map((option) => (
          <button
            aria-checked={tentacleCompletionSound === option.id}
            className="settings-sound-option"
            data-active={tentacleCompletionSound === option.id ? "true" : "false"}
            key={option.id}
            onClick={() => {
              onTentacleCompletionSoundChange(option.id);
              onPreviewTentacleCompletionSound(option.id);
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
            onPreviewTentacleCompletionSound(tentacleCompletionSound);
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
        <button
          aria-checked={isRuntimeStatusStripVisible}
          aria-label="Show runtime status strip"
          className="settings-toggle-option"
          data-active={isRuntimeStatusStripVisible ? "true" : "false"}
          onClick={() => {
            onRuntimeStatusStripVisibilityChange(!isRuntimeStatusStripVisible);
          }}
          role="switch"
          type="button"
        >
          <span className="settings-toggle-copy">
            <span className="settings-toggle-label">Runtime status strip</span>
            <span className="settings-toggle-description">Top console status strip metrics</span>
          </span>
          <span className="settings-toggle-switch" aria-hidden="true">
            <span className="settings-toggle-thumb" />
          </span>
          <span className="settings-toggle-state">
            {isRuntimeStatusStripVisible ? "Enabled" : "Disabled"}
          </span>
        </button>
        <button
          aria-checked={isMonitorVisible}
          aria-label="Show Monitor workspace view"
          className="settings-toggle-option"
          data-active={isMonitorVisible ? "true" : "false"}
          onClick={() => {
            onMonitorVisibilityChange(!isMonitorVisible);
          }}
          role="switch"
          type="button"
        >
          <span className="settings-toggle-copy">
            <span className="settings-toggle-label">Monitor workspace view</span>
            <span className="settings-toggle-description">Monitor tab and runtime syncing</span>
          </span>
          <span className="settings-toggle-switch" aria-hidden="true">
            <span className="settings-toggle-thumb" />
          </span>
          <span className="settings-toggle-state">{isMonitorVisible ? "Enabled" : "Disabled"}</span>
        </button>
        <button
          aria-checked={isBottomTelemetryVisible}
          aria-label="Show bottom telemetry tape"
          className="settings-toggle-option"
          data-active={isBottomTelemetryVisible ? "true" : "false"}
          disabled={!isMonitorVisible}
          onClick={() => {
            onBottomTelemetryVisibilityChange(!isBottomTelemetryVisible);
          }}
          role="switch"
          type="button"
        >
          <span className="settings-toggle-copy">
            <span className="settings-toggle-label">Bottom telemetry tape</span>
            <span className="settings-toggle-description">
              Scrolling tape under the workspace canvas
            </span>
          </span>
          <span className="settings-toggle-switch" aria-hidden="true">
            <span className="settings-toggle-thumb" />
          </span>
          <span className="settings-toggle-state">
            {!isMonitorVisible
              ? "Disabled (Monitor off)"
              : isBottomTelemetryVisible
                ? "Enabled"
                : "Disabled"}
          </span>
        </button>
      </div>
    </section>
    <section className="settings-panel" aria-label="Usage telemetry visibility settings">
      <header className="settings-panel-header">
        <h2>Usage telemetry visibility</h2>
        <p>Enable or disable sidebar usage sections for Codex and Claude Code.</p>
      </header>

      <div className="settings-toggle-grid" role="group" aria-label="Usage telemetry visibility">
        <button
          aria-checked={isCodexUsageVisible}
          aria-label="Show Codex token usage in sidebar"
          className="settings-toggle-option"
          data-active={isCodexUsageVisible ? "true" : "false"}
          onClick={() => {
            onCodexUsageVisibilityChange(!isCodexUsageVisible);
          }}
          role="switch"
          type="button"
        >
          <span className="settings-toggle-copy">
            <span className="settings-toggle-label">Codex token usage</span>
            <span className="settings-toggle-description">Active Agents sidebar footer</span>
          </span>
          <span className="settings-toggle-switch" aria-hidden="true">
            <span className="settings-toggle-thumb" />
          </span>
          <span className="settings-toggle-state">
            {isCodexUsageVisible ? "Enabled" : "Disabled"}
          </span>
        </button>
        <button
          aria-checked={isClaudeUsageVisible}
          aria-label="Show Claude token usage in sidebar"
          className="settings-toggle-option"
          data-active={isClaudeUsageVisible ? "true" : "false"}
          onClick={() => {
            onClaudeUsageVisibilityChange(!isClaudeUsageVisible);
          }}
          role="switch"
          type="button"
        >
          <span className="settings-toggle-copy">
            <span className="settings-toggle-label">Claude token usage</span>
            <span className="settings-toggle-description">Active Agents sidebar footer</span>
          </span>
          <span className="settings-toggle-switch" aria-hidden="true">
            <span className="settings-toggle-thumb" />
          </span>
          <span className="settings-toggle-state">
            {isClaudeUsageVisible ? "Enabled" : "Disabled"}
          </span>
        </button>
      </div>
    </section>
  </section>
);
