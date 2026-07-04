import type { AppLanguage, PromptInsertionMode, Settings } from "../shared/settingsStore";
import { LANGUAGE_LABELS, getMessages } from "../shared/i18n";

interface SettingsPanelProps {
  settings: Settings;
  onRemove: (bundleId: string) => void;
  onLanguageChange: (language: AppLanguage) => void;
  onPromptInsertionModeChange: (mode: PromptInsertionMode) => void;
}

export function SettingsPanel({
  settings,
  onRemove,
  onLanguageChange,
  onPromptInsertionModeChange,
}: SettingsPanelProps) {
  const t = getMessages(settings.language);

  return (
    <div className="settings-panel page-stack">
      <header className="page-header">
        <div>
          <h1>{t.settings.title}</h1>
          <p>{t.settings.subtitle}</p>
        </div>
      </header>

      <section className="list-panel settings-section">
        <div className="section-heading">
          <h2>{t.settings.languageTitle}</h2>
          <p>{t.settings.languageDescription}</p>
        </div>
        <label className="settings-field">
          <span>{t.settings.languageField}</span>
          <select
            className="field settings-select"
            value={settings.language}
            onChange={(event) => onLanguageChange(event.target.value as AppLanguage)}
          >
            <option value="zh-CN">{LANGUAGE_LABELS["zh-CN"]}</option>
            <option value="en-US">{LANGUAGE_LABELS["en-US"]}</option>
          </select>
        </label>
      </section>

      <section className="list-panel settings-section">
        <div className="section-heading">
          <h2>{t.settings.clickBehaviorTitle}</h2>
          <p>{t.settings.clickBehaviorDescription}</p>
        </div>
        <div className="segmented-control" aria-label={t.settings.clickBehaviorTitle}>
          <button
            className={settings.promptInsertion.mode === "paste_only" ? "is-selected" : ""}
            type="button"
            aria-pressed={settings.promptInsertion.mode === "paste_only"}
            onClick={() => onPromptInsertionModeChange("paste_only")}
          >
            {t.settings.pasteOnly}
          </button>
          <button
            className={
              settings.promptInsertion.mode === "paste_and_submit" ? "is-selected" : ""
            }
            type="button"
            aria-pressed={settings.promptInsertion.mode === "paste_and_submit"}
            onClick={() => onPromptInsertionModeChange("paste_and_submit")}
          >
            {t.settings.pasteAndSubmit}
          </button>
        </div>
      </section>

      <section className="list-panel">
        <div className="section-heading">
          <h2>{t.settings.blacklistedAppsTitle}</h2>
          <p>{t.settings.blacklistedAppsDescription}</p>
        </div>
      {settings.blacklistedApps.length === 0 ? (
        <p className="empty-state-block">{t.settings.noBlacklistedApps}</p>
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
                {t.common.remove}
              </button>
            </li>
          ))}
        </ul>
      )}
      </section>
    </div>
  );
}
