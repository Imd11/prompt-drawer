import type { PromptInsertionMode, Settings } from "../shared/settingsStore";

interface SettingsPanelProps {
  settings: Settings;
  onRemove: (bundleId: string) => void;
  onPromptInsertionModeChange: (mode: PromptInsertionMode) => void;
}

export function SettingsPanel({
  settings,
  onRemove,
  onPromptInsertionModeChange,
}: SettingsPanelProps) {
  return (
    <div className="settings-panel page-stack">
      <header className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Control how prompts are inserted from Calico.</p>
        </div>
      </header>

      <section className="list-panel settings-section">
        <div className="section-heading">
          <h2>Prompt Click Behavior</h2>
          <p>Choose whether selecting a prompt only pastes it or also presses Return.</p>
        </div>
        <div className="segmented-control" aria-label="Prompt click behavior">
          <button
            className={settings.promptInsertion.mode === "paste_only" ? "is-selected" : ""}
            type="button"
            aria-pressed={settings.promptInsertion.mode === "paste_only"}
            onClick={() => onPromptInsertionModeChange("paste_only")}
          >
            Paste only
          </button>
          <button
            className={
              settings.promptInsertion.mode === "paste_and_submit" ? "is-selected" : ""
            }
            type="button"
            aria-pressed={settings.promptInsertion.mode === "paste_and_submit"}
            onClick={() => onPromptInsertionModeChange("paste_and_submit")}
          >
            Paste + Return
          </button>
        </div>
      </section>

      <section className="list-panel">
        <div className="section-heading">
          <h2>Blacklisted Apps</h2>
          <p>The picker stays hidden for apps in this list.</p>
        </div>
      {settings.blacklistedApps.length === 0 ? (
        <p className="empty-state-block">No blacklisted apps</p>
      ) : (
        <ul className="blacklist">
          {settings.blacklistedApps.map((app) => (
            <li key={app.bundleId}>
              <div>
                <strong>{app.name}</strong>
                <span>{app.bundleId}</span>
              </div>
              <button
                className="button button-ghost-danger"
                onClick={() => onRemove(app.bundleId)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      </section>
    </div>
  );
}
