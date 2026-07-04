# Refine Local Controls and Calico Click Motion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the specific local control and interaction issues identified in the current Prompt Picker settings, prompt manager, and Calico button flows without redesigning the overall settings/manager visual system.

**Architecture:** Keep the current low-saturation blue-gray window, near-white panels, card layout, typography, spacing, and overall page composition intact. Implement small targeted component changes: shared active-thumb segmented controls, custom language dropdown, manager-origin settings back navigation, clearer group metadata, seconds-based group interval UI, and removal of Calico motion changes on prompt-popover open. Preserve existing storage and execution data contracts, especially `intervalMs`.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, CSS, Tauri 2, static `public/overlay.html` Calico button runtime.

---

## Scope Boundaries

- Do not redesign the overall settings page or prompt manager page.
- Do not change global page background, panel background, card borders, primary layout, typography scale, or main window dimensions.
- Do not change prompt creation, editing, deletion, reorder, import/export, autosend, storage schema, or Tauri window behavior except where explicitly required below.
- Do not change `intervalMs` storage or backend execution units. Only convert units in the UI.
- Do not reintroduce the hidden apps section in Settings.
- Do not use purple, high-saturation blue, or native macOS dropdown menus for the controls touched in this plan.
- Do not stage `dist`, `node_modules`, `src-tauri/target`, release bundles, or unrelated generated artifacts.

## Current Worktree Notes

At the time this plan was written, the hidden apps section had already been removed from `SettingsPanel` in the working tree but not committed. There were also pre-existing generated artifact changes under `dist` and `src-tauri/target`. The implementation should preserve those unrelated generated changes but not stage them.

Before implementation:

```bash
git status --short --branch
```

Expected: source changes may include the hidden apps removal; generated artifacts may be dirty. Use exact-path `git add` commands only.

---

### Task 1: Lock In Hidden Apps Removal From Settings

**Files:**
- Modify/verify: `src/ui/SettingsPanel.tsx`
- Modify/verify: `src/ui/SettingsPanel.test.tsx`
- Modify/verify: `src/App.tsx`
- Modify/verify: `src/styles.css`

**Step 1: Verify hidden apps UI is absent**

Confirm `SettingsPanel.tsx` does not render:

```tsx
t.settings.blacklistedAppsTitle
t.settings.noBlacklistedApps
settings.blacklistedApps.map(...)
```

Confirm `SettingsPanelProps` does not include:

```tsx
onRemove: (bundleId: string) => void;
```

Confirm `App.tsx` does not pass `onRemove` into `SettingsPanel`.

**Step 2: Keep or add the regression test**

`src/ui/SettingsPanel.test.tsx` should include:

```tsx
it("does not render hidden apps settings", () => {
  renderPanel();

  expect(screen.queryByText("隐藏应用")).toBeNull();
  expect(screen.queryByText("暂无隐藏应用")).toBeNull();
  expect(screen.queryByText("Example App")).toBeNull();
});
```

**Step 3: Remove dead CSS**

Confirm these selectors do not remain in `src/styles.css`:

```css
.settings-empty-row
.settings-blacklist
.blacklist
```

Only remove them if no remaining source files use them.

**Step 4: Run focused tests**

Run:

```bash
npm test -- src/ui/SettingsPanel.test.tsx src/app/App.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/ui/SettingsPanel.tsx src/ui/SettingsPanel.test.tsx src/App.tsx src/styles.css
git commit -m "refactor: remove hidden apps settings section"
```

Do not stage generated artifacts.

---

### Task 2: Unify Segmented Controls With a Clear Active Thumb

**Files:**
- Modify: `src/styles.css`
- Modify: `src/ui/PromptManager.tsx`
- Modify: `src/ui/PromptManager.test.tsx`
- Modify: `src/ui/SettingsPanel.test.tsx`

**Goal:** Make both segmented controls feel like the same component with a clear active state:

- Settings: `只填入输入框 / 填入并发送`
- Prompt manager: `单个 / 群组`
- Prompt manager edit form: `单个 / 群组`

**Step 1: Write tests for consistent selected state semantics**

In `src/ui/PromptManager.test.tsx`, add:

```tsx
it("marks prompt container type segments with pressed state", () => {
  renderManager();

  expect(screen.getByRole("button", { name: "单个" }).getAttribute("aria-pressed"))
    .toBe("true");
  expect(screen.getByRole("button", { name: "群组" }).getAttribute("aria-pressed"))
    .toBe("false");

  fireEvent.click(screen.getByRole("button", { name: "群组" }));

  expect(screen.getByRole("button", { name: "单个" }).getAttribute("aria-pressed"))
    .toBe("false");
  expect(screen.getByRole("button", { name: "群组" }).getAttribute("aria-pressed"))
    .toBe("true");
});
```

In `src/ui/SettingsPanel.test.tsx`, keep the existing pressed-state assertions for prompt insertion mode.

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/ui/PromptManager.test.tsx
```

Expected: FAIL because manager segmented buttons do not have `aria-pressed`.

**Step 3: Add `aria-pressed` to manager segmented buttons**

In `src/ui/PromptManager.tsx`, update create mode buttons:

```tsx
<button
  className={draft.type === "single" ? "is-selected" : ""}
  type="button"
  aria-pressed={draft.type === "single"}
  onClick={() => setDraft({ ...draft, type: "single" })}
>
  {messages.manager.single}
</button>
```

Do the same for:

- create `group`
- edit `single`
- edit `group`

**Step 4: Replace conflicting segmented CSS with one shared active-thumb style**

In `src/styles.css`, keep the existing page/card colors intact. Change only segmented-control selectors.

Target CSS:

```css
.segmented-control {
  display: inline-grid;
  grid-auto-flow: column;
  align-items: center;
  width: fit-content;
  gap: 2px;
  padding: 2px;
  overflow: hidden;
  background: #eef3f6;
  border: 1px solid var(--pp-border-strong);
  border-radius: var(--pp-radius-md);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.72);
}

.segmented-control button {
  min-width: 82px;
  min-height: 30px;
  padding: 0 12px;
  color: #475467;
  background: transparent;
  border-radius: 6px;
  box-shadow: none;
  cursor: pointer;
  font-size: 13px;
  font-weight: 650;
  transition:
    background 120ms ease,
    box-shadow 120ms ease,
    color 120ms ease,
    transform 120ms ease;
}

.segmented-control button.is-selected {
  color: #ffffff;
  background: var(--pp-text);
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
}

.segmented-control button:active {
  transform: translateY(1px);
}
```

Then remove or neutralize conflicting selected-state overrides:

```css
.settings-segmented-control button.is-selected { ... }
.prompt-manager .segmented-control button.is-selected { ... }
```

Keep sizing-only overrides if needed:

```css
.settings-segmented-control {
  height: 34px;
}

.settings-segmented-control button,
.prompt-manager .segmented-control button {
  min-width: 78px;
}
```

**Step 5: Run focused tests**

Run:

```bash
npm test -- src/ui/SettingsPanel.test.tsx src/ui/PromptManager.test.tsx
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/styles.css src/ui/PromptManager.tsx src/ui/PromptManager.test.tsx src/ui/SettingsPanel.test.tsx
git commit -m "style: unify segmented control active states"
```

---

### Task 3: Remove Time From Group Badges and Make Badge UI Neutral

**Files:**
- Modify: `src/shared/i18n.ts`
- Modify: `src/ui/PromptManager.tsx`
- Modify: `src/ui/PromptQuickList.tsx`
- Modify: `src/ui/PromptManager.test.tsx`
- Modify: `src/ui/PromptQuickList.test.tsx`
- Modify: `src/styles.css`

**Goal:** Group badges should show group type and count only. They must not show `700ms`, and they must not use purple or saturated blue styling.

**Step 1: Write failing tests for group metadata**

In `src/ui/PromptManager.test.tsx`, update the group distinction test:

```tsx
expect(screen.getByText("群组 · 2 条")).toBeTruthy();
expect(screen.queryByText(/700ms/)).toBeNull();
```

In `src/ui/PromptQuickList.test.tsx`, add or update a group badge test:

```tsx
expect(screen.getByText("群组 · 2 条")).toBeTruthy();
expect(screen.queryByText(/700ms/)).toBeNull();
```

**Step 2: Run tests to verify failure**

Run:

```bash
npm test -- src/ui/PromptManager.test.tsx src/ui/PromptQuickList.test.tsx
```

Expected: FAIL because current `groupMeta` still renders `700ms`.

**Step 3: Update i18n metadata format**

In `src/shared/i18n.ts`, change:

```ts
groupMeta: (count: number, intervalMs: number) => `群组 · ${count} 条 · ${intervalMs}ms`,
```

to:

```ts
groupMeta: (count: number) => `群组 · ${count} 条`,
```

Change English:

```ts
groupMeta: (count: number) => `Group · ${count} prompts`,
```

**Step 4: Update call sites**

In `src/ui/PromptManager.tsx`, change:

```tsx
{messages.manager.groupMeta(count, prompt.intervalMs)}
```

to:

```tsx
{messages.manager.groupMeta(count)}
```

In `src/ui/PromptQuickList.tsx`, change:

```tsx
{groupMeta(getPromptContainerBodies(prompt).length, prompt.intervalMs)}
```

to:

```tsx
{groupMeta(getPromptContainerBodies(prompt).length)}
```

**Step 5: Make badge UI neutral**

In `src/styles.css`, change manager and quick-list badges to neutral metadata styling:

```css
.prompt-kind-badge,
.prompt-quick-meta {
  min-height: 21px;
  padding: 2px 7px;
  color: #475467;
  background: #f2f5f7;
  border: 1px solid var(--pp-border);
  border-radius: 6px;
  font-size: 11px;
  font-weight: 620;
  line-height: 1.25;
}
```

Remove saturated blue/purple badge overrides:

```css
color: #1d4ed8;
background: #eff6ff;
border-color: #bfdbfe;
color: #2455c3;
background: var(--pp-accent-soft);
border-color: #d5e3ff;
border-radius: 999px;
```

**Step 6: Run focused tests**

Run:

```bash
npm test -- src/ui/PromptManager.test.tsx src/ui/PromptQuickList.test.tsx
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src/shared/i18n.ts src/ui/PromptManager.tsx src/ui/PromptQuickList.tsx src/ui/PromptManager.test.tsx src/ui/PromptQuickList.test.tsx src/styles.css
git commit -m "style: simplify group prompt metadata badges"
```

---

### Task 4: Show Group Prompt Interval in Seconds in Create and Edit Forms

**Files:**
- Modify: `src/ui/PromptManager.tsx`
- Modify: `src/ui/PromptManager.test.tsx`
- Modify: `src/styles.css`

**Goal:** The interval field should display and accept seconds (`s`) in the UI while continuing to store and emit milliseconds through `intervalMs`.

**Step 1: Write tests for seconds display and conversion**

Add to `src/ui/PromptManager.test.tsx`:

```tsx
it("shows group interval in seconds while creating a group", () => {
  renderManager();

  fireEvent.click(screen.getByRole("button", { name: "群组" }));

  const intervalInput = screen.getByLabelText("提示词间隔") as HTMLInputElement;
  expect(intervalInput.value).toBe("0.7");
  expect(screen.getByText("s")).toBeTruthy();
  expect(screen.queryByText("ms")).toBeNull();
});

it("converts group interval seconds to milliseconds when creating a group", () => {
  let createdGroup: { intervalMs: number } | null = null;
  renderManager({ onCreateGroup: (input) => { createdGroup = input; } });

  fireEvent.click(screen.getByRole("button", { name: "群组" }));
  fireEvent.change(screen.getByPlaceholderText("标题"), {
    target: { value: "Timed Group" },
  });
  fireEvent.change(screen.getAllByLabelText(/提示词 \d+ 内容/i)[0], {
    target: { value: "First" },
  });
  fireEvent.change(screen.getByLabelText("提示词间隔"), {
    target: { value: "1.5" },
  });
  fireEvent.click(screen.getByRole("button", { name: "添加群组" }));

  expect(createdGroup?.intervalMs).toBe(1500);
});
```

Add an edit-mode test:

```tsx
it("shows existing group interval in seconds while editing", () => {
  renderManager();

  fireEvent.click(screen.getAllByRole("button", { name: "编辑" })[1]);

  expect((screen.getByLabelText("提示词间隔") as HTMLInputElement).value).toBe("0.7");
});
```

**Step 2: Run tests to verify failure**

Run:

```bash
npm test -- src/ui/PromptManager.test.tsx
```

Expected: FAIL because the UI currently shows `700` and `ms`.

**Step 3: Add conversion helpers**

Near the existing helper functions in `src/ui/PromptManager.tsx`, add:

```ts
const GROUP_INTERVAL_MIN_MS = 200;
const GROUP_INTERVAL_MAX_MS = 3000;
const GROUP_INTERVAL_STEP_SECONDS = 0.1;

function intervalMsToSeconds(intervalMs: number): number {
  return Number((intervalMs / 1000).toFixed(2));
}

function intervalSecondsToMs(seconds: number): number {
  if (!Number.isFinite(seconds)) return GROUP_INTERVAL_MIN_MS;
  const clampedSeconds = Math.min(
    GROUP_INTERVAL_MAX_MS / 1000,
    Math.max(GROUP_INTERVAL_MIN_MS / 1000, seconds)
  );
  return Math.round(clampedSeconds * 1000);
}
```

**Step 4: Update `GroupFields` interval input**

Change the input from milliseconds:

```tsx
<input
  className="field"
  type="number"
  min={200}
  max={3000}
  step={50}
  value={intervalMs}
  onChange={(e) => onIntervalChange(Number(e.target.value))}
/>
<span>ms</span>
```

to seconds:

```tsx
<input
  className="field"
  type="number"
  min={GROUP_INTERVAL_MIN_MS / 1000}
  max={GROUP_INTERVAL_MAX_MS / 1000}
  step={GROUP_INTERVAL_STEP_SECONDS}
  value={intervalMsToSeconds(intervalMs)}
  onChange={(e) => onIntervalChange(intervalSecondsToMs(Number(e.target.value)))}
/>
<span>s</span>
```

**Step 5: Run focused tests**

Run:

```bash
npm test -- src/ui/PromptManager.test.tsx
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/ui/PromptManager.tsx src/ui/PromptManager.test.tsx src/styles.css
git commit -m "refactor: show group interval in seconds"
```

---

### Task 5: Add Manager-Origin Back Arrow on Settings Page

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/ui/SettingsPanel.tsx`
- Modify: `src/shared/i18n.ts`
- Modify: `src/app/App.test.tsx`
- Modify: `src/ui/SettingsPanel.test.tsx`
- Modify: `src/styles.css`

**Goal:** If the user opens Settings from the prompt manager page, Settings must show a left-arrow button in the top-left header that returns to the prompt manager. If Settings is opened directly from the menu bar, do not show that arrow.

**Step 1: Write App tests**

In `src/app/App.test.tsx`, add:

```tsx
it("shows a settings back arrow when settings is opened from manager", async () => {
  currentWindowLabel = "main";
  window.history.pushState({}, "", "/?mode=manager");
  mockPromptAndSettingsFiles();

  await act(async () => {
    render(<App />);
  });

  await screen.findByRole("heading", { name: "管理提示词" });
  fireEvent.click(screen.getByRole("button", { name: "设置" }));

  expect(await screen.findByRole("heading", { name: "设置" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "返回管理提示词" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "返回管理提示词" }));

  expect(await screen.findByRole("heading", { name: "管理提示词" })).toBeTruthy();
});

it("does not show a settings back arrow when settings is opened from the menu bar", async () => {
  currentWindowLabel = "main";
  mockPromptAndSettingsFiles();

  await act(async () => {
    render(<App />);
  });

  await screen.findByRole("heading", { name: "管理提示词" });
  await act(async () => {
    eventHandlers.get("open-settings-window")?.({ payload: null });
  });

  expect(await screen.findByRole("heading", { name: "设置" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "返回管理提示词" })).toBeNull();
});
```

Use the existing file-loading mock style in `App.test.tsx`; if no helper exists, add a small local helper in the test file rather than duplicating large mock blocks.

**Step 2: Run tests to verify failure**

Run:

```bash
npm test -- src/app/App.test.tsx
```

Expected: FAIL because Settings has no back arrow and App does not track origin.

**Step 3: Add i18n label**

In `src/shared/i18n.ts`, add under `settings`:

```ts
backToManager: "返回管理提示词",
```

English:

```ts
backToManager: "Back to prompt manager",
```

**Step 4: Add optional SettingsPanel back prop**

In `src/ui/SettingsPanel.tsx`, extend props:

```tsx
onBack?: () => void;
```

Render:

```tsx
<header className="page-header settings-page-header">
  <div className="settings-title-row">
    {onBack ? (
      <button
        className="button icon-button settings-back-button"
        type="button"
        aria-label={t.settings.backToManager}
        onClick={onBack}
      >
        ←
      </button>
    ) : null}
    <h1>{t.settings.title}</h1>
  </div>
</header>
```

**Step 5: Track settings origin in App**

In `src/App.tsx`, add:

```tsx
const [settingsReturnTarget, setSettingsReturnTarget] = useState<"manager" | null>(null);
```

When menu bar opens manager:

```tsx
setSettingsReturnTarget(null);
setMode("manager");
```

When menu bar opens settings:

```tsx
setSettingsReturnTarget(null);
setMode("settings");
```

When manager settings button is clicked:

```tsx
onOpenSettings={() => {
  setSettingsReturnTarget("manager");
  setMode("settings");
}}
```

When rendering SettingsPanel:

```tsx
onBack={settingsReturnTarget === "manager" ? () => {
  setSettingsReturnTarget(null);
  setMode("manager");
} : undefined}
```

**Step 6: Add back button CSS**

In `src/styles.css`:

```css
.settings-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.settings-back-button {
  width: 34px;
  height: 34px;
  min-height: 34px;
  color: #344054;
  background: var(--pp-surface);
  border-color: var(--pp-border-strong);
  border-radius: 8px;
  font-size: 18px;
  font-weight: 700;
}

.settings-back-button:hover {
  background: var(--pp-surface-subtle);
}
```

**Step 7: Run tests**

Run:

```bash
npm test -- src/app/App.test.tsx src/ui/SettingsPanel.test.tsx
```

Expected: PASS.

**Step 8: Commit**

```bash
git add src/App.tsx src/ui/SettingsPanel.tsx src/shared/i18n.ts src/app/App.test.tsx src/ui/SettingsPanel.test.tsx src/styles.css
git commit -m "feat: return from settings to prompt manager"
```

---

### Task 6: Replace Native Language Select With Custom Dropdown and Neutral Focus States

**Files:**
- Create: `src/ui/LanguageDropdown.tsx`
- Modify: `src/ui/SettingsPanel.tsx`
- Modify: `src/ui/SettingsPanel.test.tsx`
- Modify: `src/styles.css`

**Goal:** Replace the native macOS `<select>` with a Prompt Picker dropdown that opens downward, matches the current panel style, and avoids bright blue/purple active/focus outlines.

**Step 1: Write dropdown tests**

In `src/ui/SettingsPanel.test.tsx`, replace select-specific tests with dropdown behavior tests:

```tsx
it("renders language selection as a custom dropdown row", () => {
  renderPanel();

  const trigger = screen.getByRole("button", { name: /界面语言.*中文/ });
  const row = trigger.closest(".settings-row");

  expect(row).toBeTruthy();
  expect(row?.querySelector(".settings-row-control")?.contains(trigger)).toBe(true);
  expect(screen.queryByRole("combobox")).toBeNull();
});

it("opens and selects language from the custom dropdown", () => {
  let selectedLanguage: AppLanguage | null = null;
  renderPanel(mockSettings, () => {}, (language) => { selectedLanguage = language; });

  fireEvent.click(screen.getByRole("button", { name: /界面语言.*中文/ }));

  expect(screen.getByRole("listbox", { name: "界面语言" })).toBeTruthy();
  fireEvent.click(screen.getByRole("option", { name: "English" }));

  expect(selectedLanguage).toBe("en-US");
  expect(screen.queryByRole("listbox", { name: "界面语言" })).toBeNull();
});

it("closes the language dropdown with Escape", () => {
  renderPanel();

  fireEvent.click(screen.getByRole("button", { name: /界面语言.*中文/ }));
  fireEvent.keyDown(document, { key: "Escape" });

  expect(screen.queryByRole("listbox", { name: "界面语言" })).toBeNull();
});
```

**Step 2: Run tests to verify failure**

Run:

```bash
npm test -- src/ui/SettingsPanel.test.tsx
```

Expected: FAIL because SettingsPanel still uses a native `<select>`.

**Step 3: Create LanguageDropdown component**

Create `src/ui/LanguageDropdown.tsx`:

```tsx
import { useEffect, useId, useRef, useState } from "react";
import type { AppLanguage } from "../shared/settingsStore";
import { LANGUAGE_LABELS } from "../shared/i18n";

interface LanguageDropdownProps {
  label: string;
  value: AppLanguage;
  onChange: (language: AppLanguage) => void;
}

const LANGUAGE_OPTIONS: AppLanguage[] = ["zh-CN", "en-US"];

export function LanguageDropdown({ label, value, onChange }: LanguageDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="language-dropdown" ref={rootRef}>
      <button
        className="language-dropdown-trigger"
        type="button"
        aria-label={`${label} ${LANGUAGE_LABELS[value]}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => setOpen((next) => !next)}
      >
        <span>{LANGUAGE_LABELS[value]}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open ? (
        <div className="language-dropdown-menu" role="listbox" id={listboxId} aria-label={label}>
          {LANGUAGE_OPTIONS.map((language) => (
            <button
              className={language === value ? "is-selected" : ""}
              key={language}
              type="button"
              role="option"
              aria-selected={language === value}
              onClick={() => {
                onChange(language);
                setOpen(false);
              }}
            >
              <span aria-hidden="true">{language === value ? "✓" : ""}</span>
              <span>{LANGUAGE_LABELS[language]}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

**Step 4: Use LanguageDropdown in SettingsPanel**

In `src/ui/SettingsPanel.tsx`, replace the `<select>` with:

```tsx
<LanguageDropdown
  label={t.settings.languageField}
  value={settings.language}
  onChange={onLanguageChange}
/>
```

Remove unused `LANGUAGE_LABELS` import from `SettingsPanel.tsx`.

**Step 5: Add dropdown CSS**

In `src/styles.css`:

```css
.language-dropdown {
  position: relative;
  width: 156px;
}

.language-dropdown-trigger {
  display: flex;
  width: 100%;
  min-height: 32px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 10px;
  color: var(--pp-text);
  background: var(--pp-surface);
  border: 1px solid var(--pp-border-strong);
  border-radius: var(--pp-radius-md);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
}

.language-dropdown-trigger:hover {
  background: var(--pp-surface-subtle);
  border-color: #bac8d4;
}

.language-dropdown-trigger:focus {
  outline: 0;
}

.language-dropdown-trigger:focus-visible {
  border-color: #9aa9b7;
  box-shadow: 0 0 0 3px rgba(100, 116, 139, 0.16);
}

.language-dropdown-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 20;
  display: grid;
  width: 100%;
  overflow: hidden;
  padding: 4px;
  background: var(--pp-surface);
  border: 1px solid var(--pp-border);
  border-radius: var(--pp-radius-md);
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.1);
}

.language-dropdown-menu button {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  min-height: 30px;
  align-items: center;
  gap: 7px;
  padding: 0 8px;
  color: #475467;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  text-align: left;
}

.language-dropdown-menu button:hover,
.language-dropdown-menu button.is-selected {
  color: var(--pp-text);
  background: var(--pp-surface-subtle);
}
```

**Step 6: Neutralize bright blue field focus**

Change global and prompt-manager focus rules away from bright blue:

```css
.field:focus {
  border-color: #9aa9b7;
  box-shadow: 0 0 0 3px rgba(100, 116, 139, 0.16);
}

.prompt-manager .field:focus {
  border-color: #9aa9b7;
  box-shadow: 0 0 0 3px rgba(100, 116, 139, 0.14);
}
```

Do not use `#2563eb` or purple/blue focus rings for these fields.

**Step 7: Run focused tests**

Run:

```bash
npm test -- src/ui/SettingsPanel.test.tsx
```

Expected: PASS.

**Step 8: Commit**

```bash
git add src/ui/LanguageDropdown.tsx src/ui/SettingsPanel.tsx src/ui/SettingsPanel.test.tsx src/styles.css
git commit -m "feat: replace language select with custom dropdown"
```

---

### Task 7: Stop Calico Motion Changes When Opening Prompt Popover

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/app/App.test.tsx`
- Inspect: `public/overlay.html`

**Goal:** Clicking Calico to open the prompt panel must not switch Calico into a thinking/working/reaction motion state. The panel should open independently; Calico should continue whatever motion state it already had.

**Step 1: Replace the existing thinking-motion test**

In `src/app/App.test.tsx`, replace:

```tsx
it("emits thinking motion when a reused prompt popover opens", async () => {
  ...
  expectCalicoMotion("thinking");
});
```

with:

```tsx
it("does not emit Calico motion when a reused prompt popover opens", async () => {
  currentWindowLabel = "prompt-popover";
  window.history.pushState({}, "", "/?mode=popover");
  await renderPromptPopover();
  emitMock.mockClear();

  await act(async () => {
    await eventHandlers.get("prompt-popover-opened")?.({ payload: "popover" });
  });

  expect(emitMock).not.toHaveBeenCalledWith(
    "calico-motion",
    expect.objectContaining({ state: "thinking" })
  );
  expect(calicoMotionStates()).toEqual([]);
});
```

**Step 2: Run test to verify failure**

Run:

```bash
npm test -- src/app/App.test.tsx
```

Expected: FAIL because `App.tsx` currently emits `thinking` on `prompt-popover-opened`.

**Step 3: Remove popover-open motion emit**

In `src/App.tsx`, remove this line from the `prompt-popover-opened` listener:

```ts
emitCalicoMotion("thinking", "popover-open", 1200);
```

Keep:

```ts
resetPromptHoverPreview();
promptListRefreshingRef.current = true;
await reloadPrompts();
```

Do not remove autosend motion events such as `working-typing`, `working-conducting`, `happy`, `notification`, or `error`.

**Step 4: Inspect overlay click behavior**

Inspect `public/overlay.html` to confirm plain click-to-open does not call `applyCalicoMotion(...)` directly. The drag path may continue to use `react-drag`.

If prompt-popover close/dismiss handlers reset Calico motion solely because of a click toggle, add a focused static or runtime test before changing that behavior. Do not remove drag reset behavior.

**Step 5: Run focused tests**

Run:

```bash
npm test -- src/app/App.test.tsx src/overlay/overlayHtml.test.ts src/overlay/calicoMotionRuntime.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/App.tsx src/app/App.test.tsx public/overlay.html src/overlay/overlayHtml.test.ts
git commit -m "fix: keep Calico motion unchanged when opening prompts"
```

If `public/overlay.html` and `src/overlay/overlayHtml.test.ts` are not changed, do not include them in `git add`.

---

### Task 8: Responsive and Interaction Verification

**Files:**
- Verify: `src/styles.css`
- Verify: `src/ui/SettingsPanel.tsx`
- Verify: `src/ui/PromptManager.tsx`
- Verify: `src/ui/LanguageDropdown.tsx`
- Verify: `src/App.tsx`
- Verify: `public/overlay.html`

**Step 1: Run full frontend tests**

Run:

```bash
npm test
```

Expected: PASS.

**Step 2: Run build without writing to tracked `dist`**

Run:

```bash
npx tsc --noEmit && npx vite build --outDir /tmp/prompt-picker-control-refinement-build --emptyOutDir
```

Expected: PASS.

**Step 3: Start visual runtime**

Run:

```bash
npm run dev -- --host 127.0.0.1
```

Expected: Vite serves on `http://127.0.0.1:1420/`.

**Step 4: Check main window pages at fixed sizes**

Use browser or Playwright to inspect:

```text
http://127.0.0.1:1420/?mode=settings
http://127.0.0.1:1420/?mode=manager
```

Viewports:

```text
760 x 560
640 x 460
```

Expected settings page:

- No hidden apps section.
- Language dropdown is custom, not native select.
- Language dropdown opens downward and stays within the settings card area.
- No bright blue or purple focus outline after mouse click.
- Segmented control selected state has a clear active thumb.
- If opened from manager in the real app path, left-arrow back button appears.

Expected prompt manager:

- New container segmented control uses the same active-thumb style as settings.
- Group badges show `群组 · N 条`, no `ms`.
- Group badge color is neutral gray-blue, not purple or saturated blue.
- Group interval input displays seconds with `s`.
- No horizontal overflow.

Expected Calico behavior:

- Clicking Calico to open the prompt panel does not switch Calico into thinking/working/happy/error state.
- Prompt panel opens normally.
- Dragging Calico may still use drag-specific feedback.
- Autosend success/failure may still use existing motion feedback.

**Step 5: Stop dev server**

Use `Ctrl-C`.

**Step 6: Commit visual fixes if any**

If small CSS-only visual fixes are needed:

```bash
git add src/styles.css
git commit -m "style: tune refined control visuals"
```

Do not commit generated artifacts.

---

### Task 9: Final Verification and Handoff

**Files:**
- No new code expected.

**Step 1: Check worktree**

Run:

```bash
git status --short --branch
```

Expected: only unrelated generated artifacts may remain dirty. No source files should be unstaged unless intentionally left for review.

**Step 2: Run full frontend verification**

Run:

```bash
npm test
npx tsc --noEmit && npx vite build --outDir /tmp/prompt-picker-control-refinement-final-build --emptyOutDir
```

Expected: PASS.

**Step 3: Run Rust tests only if implementation touched `src-tauri`**

If `src-tauri` files were not changed, this is optional. If run, avoid writing to tracked target:

```bash
cd src-tauri
cargo test --target-dir /tmp/prompt-picker-control-refinement-cargo-target
```

Expected: PASS.

**Step 4: Final source-only commit if needed**

If earlier task commits were not made, make one scoped commit:

```bash
git add src/App.tsx src/app/App.test.tsx src/shared/i18n.ts src/ui/SettingsPanel.tsx src/ui/SettingsPanel.test.tsx src/ui/LanguageDropdown.tsx src/ui/PromptManager.tsx src/ui/PromptManager.test.tsx src/ui/PromptQuickList.tsx src/ui/PromptQuickList.test.tsx src/styles.css public/overlay.html src/overlay/overlayHtml.test.ts
git commit -m "style: refine prompt picker local controls"
```

Only include files that actually changed.

**Step 5: Report user-facing result**

Report:

- Settings and manager page overall visual style was preserved.
- Segmented controls now share one active-thumb style.
- Group badges no longer show time and use neutral UI.
- Group interval is shown in seconds.
- Settings opened from manager can return with a left-arrow button.
- Language selection uses a custom dropdown.
- Bright blue/purple focus outline is removed from the touched controls.
- Clicking Calico to open the prompt panel no longer changes Calico motion state.

Do not push unless the user explicitly asks for push in the execution request.

---

## Acceptance Criteria

- Hidden apps settings section is absent.
- Settings and prompt manager overall page/card visual system is not redesigned.
- Both segmented controls have a clear, consistent active thumb.
- Prompt manager create/edit segmented controls expose correct `aria-pressed`.
- Group badges show only `群组 · N 条` / `Group · N prompts`.
- Group badges do not use purple or high-saturation blue styling.
- Group interval create/edit UI displays seconds and `s`.
- Group interval still calls create/update handlers with `intervalMs`.
- Settings opened from manager shows a left-arrow return button.
- Settings opened directly from menu bar does not show manager back arrow.
- Language selector is a custom dropdown, not native `<select>`.
- Language dropdown supports open, choose option, outside click close, and Escape close.
- Mouse focus does not show bright blue/purple outlines on language selection.
- Keyboard focus remains visible with a neutral, low-saturation ring.
- Opening prompt popover does not emit `thinking` or other Calico motion.
- Existing autosend/drag motion behavior remains intact.
- `npm test` passes.
- `npx tsc --noEmit && npx vite build --outDir /tmp/... --emptyOutDir` passes.
- No generated artifacts are staged or committed.
