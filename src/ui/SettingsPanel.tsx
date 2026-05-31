import type { Settings } from "../shared/settingsStore";

interface SettingsPanelProps {
  settings: Settings;
  onRemove: (bundleId: string) => void;
}

export function SettingsPanel({ settings, onRemove }: SettingsPanelProps) {
  return (
    <div className="settings-panel page-stack">
      <header className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Manage app-specific exclusions for the floating picker.</p>
        </div>
      </header>

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
