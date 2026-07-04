# Prompt Picker Settings I18n And Click Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make prompt management feel reliable and polished: one-click prompt creation, user-facing status text, Chinese/English language settings, an obvious Settings shortcut, and container-anchored hover previews.

**Architecture:** Add a lightweight local i18n layer driven by persisted settings, then pass translated labels into React surfaces and macOS menu setup. Keep behavior changes scoped: prompt creation/save becomes form/ref based, autosend status messages become result-oriented, and quick-list hover previews anchor to prompt containers instead of mouse coordinates.

**Tech Stack:** React 19, TypeScript, Vitest + Testing Library, Tauri 2, Rust menu/tray APIs, local JSON settings storage.

---

### Task 1: Add Language Setting And I18n Catalog

**Files:**
- Create: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/shared/i18n.ts`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/shared/settingsStore.ts`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/shared/settingsStore.test.ts`

**Step 1: Write failing settings tests**

Add tests proving:
- default language is `"zh-CN"` or `"en-US"` per product decision; use `"zh-CN"` because the user primarily uses Chinese and requested Chinese copy.
- old settings without `language` normalize safely.
- invalid language normalizes to default.
- `setLanguage("en-US")` persists.

Example assertions:

```ts
expect(settings.language).toBe("zh-CN");
await store.setLanguage("en-US");
expect((await store.get()).language).toBe("en-US");
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- --run src/shared/settingsStore.test.ts
```

Expected: FAIL because `language` and `setLanguage` do not exist.

**Step 3: Implement settings language model**

Add:

```ts
export type AppLanguage = "zh-CN" | "en-US";
```

Extend `Settings`:

```ts
language: AppLanguage;
```

Default:

```ts
language: "zh-CN";
```

Normalize:

```ts
language: candidate.language === "en-US" ? "en-US" : "zh-CN";
```

Store method:

```ts
async setLanguage(language: AppLanguage): Promise<void> {
  const settings = await load();
  settings.language = language;
  await save(settings);
}
```

**Step 4: Create lightweight i18n catalog**

Create `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/shared/i18n.ts`:

```ts
import type { AppLanguage } from "./settingsStore";

export const DEFAULT_LANGUAGE: AppLanguage = "zh-CN";

export const LANGUAGE_LABELS: Record<AppLanguage, string> = {
  "zh-CN": "中文",
  "en-US": "English",
};

export const messages = {
  "zh-CN": {
    common: {
      settings: "设置",
      import: "导入",
      export: "导出",
      remove: "移除",
      back: "返回",
    },
    autosend: {
      sent: "已发送",
      insertedIntoInput: "已填入输入框",
      clickToAuthorize: "点击授权",
      copiedNotSent: "已复制，未发送",
      copyFailed: "未能复制",
      pasteFailed: "未能粘贴",
      pastedNotSent: "已填入输入框，未发送",
      targetFocusFailed: "请先切到输入页",
      genericFailed: "未能发送，请重试",
      automaticFailed: "未能自动发送",
      sequenceFailed: (index: number) => `第 ${index} 条失败`,
    },
    settings: {
      title: "设置",
      subtitle: "控制 Calico 如何填入提示词。",
      languageTitle: "语言",
      languageDescription: "选择应用界面使用的语言。",
      languageField: "界面语言",
      clickBehaviorTitle: "提示词点击行为",
      clickBehaviorDescription: "选择点击提示词后，只填入输入框，还是填入并发送。",
      pasteOnly: "只填入输入框",
      pasteAndSubmit: "填入并发送",
      blacklistedAppsTitle: "隐藏应用",
      blacklistedAppsDescription: "在这些应用中隐藏小猫。",
      noBlacklistedApps: "暂无隐藏应用",
    },
    manager: {
      title: "管理提示词",
      count: (count: number) => `本地库中有 ${count} 个提示词容器。`,
      newContainerTitle: "新建提示词容器",
      newContainerDescription: "为快速选择器添加一个提示词或一个有顺序的提示词组。",
      single: "单个",
      group: "群组",
      titlePlaceholder: "标题",
      bodyPlaceholder: "提示词内容...",
      addPrompt: "添加提示词",
      addGroup: "添加群组",
      promptListTitle: "提示词列表",
      promptListDescription: "选择小猫列表中的显示顺序。",
      noPrompts: "暂无提示词",
      edit: "编辑",
      delete: "删除",
      save: "保存",
      cancel: "取消",
      deleteConfirm: "删除这个提示词？",
      confirm: "确认",
    },
    quickList: {
      ariaLabel: "提示词",
      noPromptsTitle: "暂无提示词",
      noPromptsDescription: "打开 Prompt Picker 创建第一个提示词。",
    },
    buttonControls: {
      managePrompts: "管理提示词...",
      hideCalico: "隐藏 Calico",
      openAccessibilitySettings: "打开辅助功能设置",
      quit: "退出 Prompt Picker",
    },
  },
  "en-US": {
    common: {
      settings: "Settings",
      import: "Import",
      export: "Export",
      remove: "Remove",
      back: "Back",
    },
    autosend: {
      sent: "Sent",
      insertedIntoInput: "Inserted into input",
      clickToAuthorize: "Click to authorize",
      copiedNotSent: "Copied, not sent",
      copyFailed: "Could not copy",
      pasteFailed: "Could not paste",
      pastedNotSent: "Inserted, not sent",
      targetFocusFailed: "Switch to an input first",
      genericFailed: "Could not send. Try again",
      automaticFailed: "Could not send automatically",
      sequenceFailed: (index: number) => `Prompt ${index} failed`,
    },
    settings: {
      title: "Settings",
      subtitle: "Control how Calico inserts prompts.",
      languageTitle: "Language",
      languageDescription: "Choose the language used by Prompt Picker.",
      languageField: "Interface language",
      clickBehaviorTitle: "Prompt Click Behavior",
      clickBehaviorDescription: "Choose whether selecting a prompt only inserts it or also sends it.",
      pasteOnly: "Insert only",
      pasteAndSubmit: "Insert + Send",
      blacklistedAppsTitle: "Hidden Apps",
      blacklistedAppsDescription: "Calico stays hidden in these apps.",
      noBlacklistedApps: "No hidden apps",
    },
    manager: {
      title: "Manage Prompts",
      count: (count: number) => `${count} prompt containers in your local library.`,
      newContainerTitle: "New Prompt Container",
      newContainerDescription: "Add one prompt or an ordered group for the quick picker.",
      single: "Single",
      group: "Group",
      titlePlaceholder: "Title",
      bodyPlaceholder: "Prompt body...",
      addPrompt: "Add Prompt",
      addGroup: "Add Group",
      promptListTitle: "Prompt List",
      promptListDescription: "Choose the order used by the floating picker.",
      noPrompts: "No prompts yet",
      edit: "Edit",
      delete: "Delete",
      save: "Save",
      cancel: "Cancel",
      deleteConfirm: "Delete this prompt?",
      confirm: "Confirm",
    },
    quickList: {
      ariaLabel: "Prompts",
      noPromptsTitle: "No prompts yet",
      noPromptsDescription: "Open Prompt Picker to create your first prompt.",
    },
    buttonControls: {
      managePrompts: "Manage Prompts...",
      hideCalico: "Hide Calico",
      openAccessibilitySettings: "Open Accessibility Settings",
      quit: "Quit Prompt Picker",
    },
  },
} as const;

export type Messages = typeof messages[AppLanguage];

export function getMessages(language: AppLanguage) {
  return messages[language] ?? messages[DEFAULT_LANGUAGE];
}
```

**Step 5: Run tests**

Run:

```bash
npm test -- --run src/shared/settingsStore.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/shared/i18n.ts src/shared/settingsStore.ts src/shared/settingsStore.test.ts
git commit -m "feat: add language setting and i18n catalog"
```

---

### Task 2: Add Language Picker To Settings Page

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/ui/SettingsPanel.tsx`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/ui/SettingsPanel.test.tsx`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/styles.css`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/App.tsx`

**Step 1: Write failing SettingsPanel tests**

Add tests for:
- language section renders.
- language is a `<select>` not segmented buttons.
- changing language calls `onLanguageChange("en-US")`.
- Chinese labels render when language is `"zh-CN"`.
- prompt click behavior labels use translated text.

Example:

```ts
expect(screen.getByLabelText("界面语言")).toBeTruthy();
fireEvent.change(screen.getByLabelText("界面语言"), { target: { value: "en-US" } });
expect(selectedLanguage).toBe("en-US");
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- --run src/ui/SettingsPanel.test.tsx
```

Expected: FAIL because SettingsPanel does not accept language props or render select.

**Step 3: Update SettingsPanel props**

Add:

```ts
import type { AppLanguage, PromptInsertionMode, Settings } from "../shared/settingsStore";
import { LANGUAGE_LABELS, getMessages } from "../shared/i18n";
```

Props:

```ts
onLanguageChange: (language: AppLanguage) => void;
```

Inside component:

```ts
const t = getMessages(settings.language);
```

Render first settings section:

```tsx
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
```

Update all hardcoded SettingsPanel copy with `t`.

**Step 4: Wire App language update**

In `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/App.tsx`, add:

```ts
const updateLanguage = async (language: AppLanguage) => {
  await settingsStoreRef.current.setLanguage(language);
  const nextSettings = await settingsStoreRef.current.get();
  setActiveSettings(nextSettings);
};
```

Pass `onLanguageChange={updateLanguage}` to `SettingsPanel`.

**Step 5: Add select styling**

In `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/styles.css`:

```css
.settings-field {
  display: grid;
  max-width: 360px;
  gap: 6px;
}

.settings-field span {
  color: var(--pp-text);
  font-size: 12px;
  font-weight: 650;
}

.settings-select {
  min-height: 36px;
  padding: 0 12px;
}
```

**Step 6: Run tests**

Run:

```bash
npm test -- --run src/ui/SettingsPanel.test.tsx src/app/App.test.tsx
```

Expected: PASS after updating existing English label expectations to the selected default language where needed.

**Step 7: Commit**

```bash
git add src/ui/SettingsPanel.tsx src/ui/SettingsPanel.test.tsx src/styles.css src/App.tsx src/app/App.test.tsx
git commit -m "feat: add language picker to settings"
```

---

### Task 3: Translate App Status Text And React Surfaces

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/App.tsx`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/ui/PromptManager.tsx`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/ui/PromptManager.test.tsx`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/ui/PromptQuickList.tsx`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/ui/PromptQuickList.test.tsx`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/app/App.test.tsx`

**Step 1: Write failing status tests**

Update/add App tests so:
- paste + return success emits `message: "已发送"` in Chinese.
- paste-only success emits `message: "已填入输入框"` in Chinese.
- English setting emits `message: "Sent"` and `message: "Inserted into input"`.

**Step 2: Run tests to verify failure**

Run:

```bash
npm test -- --run src/app/App.test.tsx
```

Expected: FAIL because messages are still `"已粘贴并回车"` / `"已粘贴"`.

**Step 3: Update autosend status mapping**

Change:

```ts
function statusForAutosendOutcome(outcome: AutosendOutcome)
```

to accept messages:

```ts
function statusForAutosendOutcome(outcome: AutosendOutcome, t: ReturnType<typeof getMessages>)
```

Use:

```ts
if (outcome.sent) {
  return { kind: "sent", message: t.autosend.sent };
}
```

For paste-only path:

```ts
await emitAutosendStatus("sent", t.autosend.insertedIntoInput);
```

For sequence success:

```ts
return { kind: "sent", message: t.autosend.sent };
```

**Step 4: Pass translations into PromptManager**

Add props:

```ts
messages: ReturnType<typeof getMessages>;
onOpenSettings: () => void;
```

Replace hardcoded text in `PromptManager` with `messages.manager` and `messages.common`.

**Step 5: Pass translations into PromptQuickList**

Add prop:

```ts
messages: ReturnType<typeof getMessages>["quickList"];
```

Use:

```tsx
aria-label={messages.ariaLabel}
<strong>{messages.noPromptsTitle}</strong>
<span>{messages.noPromptsDescription}</span>
```

**Step 6: Update App render wiring**

At top of component body:

```ts
const t = getMessages(activeSettings.language);
```

Pass `t` into SettingsPanel, PromptManager, PromptQuickList, and button controls copy.

**Step 7: Run targeted tests**

Run:

```bash
npm test -- --run src/app/App.test.tsx src/ui/PromptManager.test.tsx src/ui/PromptQuickList.test.tsx
```

Expected: PASS.

**Step 8: Commit**

```bash
git add src/App.tsx src/app/App.test.tsx src/ui/PromptManager.tsx src/ui/PromptManager.test.tsx src/ui/PromptQuickList.tsx src/ui/PromptQuickList.test.tsx
git commit -m "feat: translate app copy and autosend statuses"
```

---

### Task 4: Add Settings Shortcut To Manage Prompts Header

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/ui/PromptManager.tsx`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/ui/PromptManager.test.tsx`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/App.tsx`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/app/App.test.tsx`

**Step 1: Write failing tests**

PromptManager test:

```ts
it("opens settings from the manager header", () => {
  let opened = false;
  renderManager({ onOpenSettings: () => { opened = true; } });
  fireEvent.click(screen.getByRole("button", { name: "设置" }));
  expect(opened).toBe(true);
});
```

App test:

```ts
fireEvent.click(screen.getByRole("button", { name: "设置" }));
expect(screen.getByRole("heading", { name: "设置" })).toBeTruthy();
```

**Step 2: Run tests to verify failure**

Run:

```bash
npm test -- --run src/ui/PromptManager.test.tsx src/app/App.test.tsx
```

Expected: FAIL because no Settings button exists in manager header.

**Step 3: Implement manager header shortcut**

PromptManager props:

```ts
onOpenSettings: () => void;
```

Header toolbar order:

```tsx
<button className="button button-secondary" onClick={onOpenSettings}>
  {messages.common.settings}
</button>
<button className="button button-secondary" onClick={onImport}>
  {messages.common.import}
</button>
<button className="button button-secondary" onClick={onExport}>
  {messages.common.export}
</button>
```

In App:

```tsx
onOpenSettings={() => setMode("settings")}
```

**Step 4: Run tests**

Run:

```bash
npm test -- --run src/ui/PromptManager.test.tsx src/app/App.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/ui/PromptManager.tsx src/ui/PromptManager.test.tsx src/App.tsx src/app/App.test.tsx
git commit -m "feat: add settings shortcut to prompt manager"
```

---

### Task 5: Make Prompt Create And Save Work On First Click

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/ui/PromptManager.tsx`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/ui/PromptManager.test.tsx`

**Step 1: Write failing tests for blur/composition-safe submit**

Add tests for:
- submit reads current DOM values even if React state is stale.
- clicking Add Prompt while textarea is focused still creates immediately.
- Save behaves the same in edit mode.
- duplicate events do not create two prompts.

Use refs or test-only event ordering to simulate stale state:

```ts
const title = screen.getByPlaceholderText("标题") as HTMLInputElement;
const body = screen.getByPlaceholderText("提示词内容...") as HTMLTextAreaElement;
fireEvent.change(title, { target: { value: "审阅修复计划" } });
fireEvent.change(body, { target: { value: "你深入分析一下..." } });
body.focus();
fireEvent.pointerDown(screen.getByRole("button", { name: "添加提示词" }));
fireEvent.click(screen.getByRole("button", { name: "添加提示词" }));
expect(created).toEqual({ title: "审阅修复计划", body: "你深入分析一下..." });
```

**Step 2: Run tests to verify failure**

Run:

```bash
npm test -- --run src/ui/PromptManager.test.tsx
```

Expected: FAIL because PromptManager has no pointerdown/ref submit path.

**Step 3: Implement stable submit helpers**

Add refs:

```ts
const titleInputRef = useRef<HTMLInputElement | null>(null);
const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
const groupPromptRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
const editTitleInputRef = useRef<HTMLInputElement | null>(null);
const editBodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
const editGroupPromptRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
const submitGuardRef = useRef(false);
```

Build current drafts from DOM:

```ts
function draftFromCreateDom(): Draft {
  return {
    ...draft,
    title: titleInputRef.current?.value ?? draft.title,
    body: bodyTextareaRef.current?.value ?? draft.body,
    prompts: draft.prompts.map((value, index) => groupPromptRefs.current[index]?.value ?? value),
  };
}
```

Submit guard:

```ts
function runOncePerGesture(callback: () => void) {
  if (submitGuardRef.current) return;
  submitGuardRef.current = true;
  window.setTimeout(() => {
    submitGuardRef.current = false;
  }, 0);
  callback();
}
```

Use a form:

```tsx
<form
  className="editor-panel editor-panel-stacked"
  onSubmit={(event) => {
    event.preventDefault();
    runOncePerGesture(() => handleCreate(draftFromCreateDom()));
  }}
>
```

Button:

```tsx
<button
  className="button button-primary editor-submit"
  type="submit"
  onPointerDown={() => {
    window.setTimeout(() => runOncePerGesture(() => handleCreate(draftFromCreateDom())), 0);
  }}
>
```

Do the same pattern for edit Save, but keep scope local to save buttons and avoid changing row reorder/delete behavior.

**Step 4: Verify no duplicate creation**

Run:

```bash
npm test -- --run src/ui/PromptManager.test.tsx
```

Expected: PASS, including a test that one pointerdown+click creates exactly one prompt.

**Step 5: Commit**

```bash
git add src/ui/PromptManager.tsx src/ui/PromptManager.test.tsx
git commit -m "fix: make prompt submit work on first click"
```

---

### Task 6: Anchor Hover Preview To Prompt Container

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/ui/PromptQuickList.tsx`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/ui/PromptQuickList.test.tsx`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/styles.css`

**Step 1: Write failing hover tests**

Replace mouse-position expectation with container-anchored expectation:
- `onMouseMove` should not change tooltip position once anchored.
- tooltip left aligns with hovered container left inside `.prompt-quick-shell`.
- tooltip width follows container width.
- tooltip uses above placement if enough room, below otherwise.
- 1.5s delay remains.

**Step 2: Run tests to verify failure**

Run:

```bash
npm test -- --run src/ui/PromptQuickList.test.tsx
```

Expected: FAIL because current hover preview tracks mouse `clientX/clientY`.

**Step 3: Remove mouse coordinate dependency**

Change `HoverPreviewAnchor`:

```ts
type HoverPreviewAnchor = {
  prompt: PromptContainer;
  target: HTMLElement;
};
```

Change `createHoverPreviewState(prompt, target)` to use:

```ts
const shellRect = shell?.getBoundingClientRect();
const targetRect = target.getBoundingClientRect();
const localLeft = shellRect ? targetRect.left - shellRect.left : target.offsetLeft;
const localTop = shellRect ? targetRect.top - shellRect.top : target.offsetTop;
const width = Math.min(targetRect.width, shellWidth - HOVER_PREVIEW_MARGIN * 2);
const left = clamp(localLeft, HOVER_PREVIEW_MARGIN, shellWidth - width - HOVER_PREVIEW_MARGIN);
const availableAbove = localTop - HOVER_PREVIEW_GAP - HOVER_PREVIEW_MARGIN;
const targetBottom = localTop + targetRect.height;
const availableBelow = shellHeight - targetBottom - HOVER_PREVIEW_GAP - HOVER_PREVIEW_MARGIN;
const placement = availableAbove >= HOVER_PREVIEW_MIN_USEFUL_SPACE || availableAbove >= availableBelow
  ? "above"
  : "below";
const top = placement === "above" ? localTop - HOVER_PREVIEW_GAP : targetBottom + HOVER_PREVIEW_GAP;
```

Remove `onMouseMove` from quick-list items. Keep:

```tsx
onMouseEnter={(event) => scheduleHoverPreview(prompt, event.currentTarget)}
onMouseLeave={hideHoverPreview}
```

**Step 4: Keep tooltip content body-only**

Confirm `PromptHoverPreview` still only renders prompt body content and no title.

**Step 5: Update CSS**

Ensure:

```css
.prompt-hover-preview {
  max-height: 220px;
  overflow: auto;
}

.prompt-hover-preview.is-above {
  transform: translateY(-100%);
}

.prompt-hover-preview.is-below {
  transform: none;
}
```

**Step 6: Run tests**

Run:

```bash
npm test -- --run src/ui/PromptQuickList.test.tsx
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src/ui/PromptQuickList.tsx src/ui/PromptQuickList.test.tsx src/styles.css
git commit -m "fix: anchor hover preview to prompt container"
```

---

### Task 7: Sync macOS Menu Bar Labels With Language

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/platform/platformApi.ts`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/App.tsx`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/app/App.test.tsx`

**Step 1: Write failing Rust tests**

Add tests that a menu label resolver returns Chinese and English labels:

```rust
assert_eq!(menu_labels_for_language("zh-CN").open_main, "管理提示词...");
assert_eq!(menu_labels_for_language("en-US").open_main, "Manage Prompts...");
```

**Step 2: Run Rust tests to verify failure**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml menu_bar_app_tests
```

Expected: FAIL because no language-aware labels exist.

**Step 3: Implement menu label resolver**

Add:

```rust
struct MenuLabels {
    open_main: &'static str,
    open_settings: &'static str,
    show_button: &'static str,
    hide_button: &'static str,
    open_accessibility: &'static str,
    quit: &'static str,
}

fn menu_labels_for_language(language: &str) -> MenuLabels {
    match language {
        "zh-CN" => MenuLabels {
            open_main: "管理提示词...",
            open_settings: "设置...",
            show_button: "显示 Calico",
            hide_button: "隐藏 Calico",
            open_accessibility: "打开辅助功能设置",
            quit: "退出 Prompt Picker",
        },
        _ => MenuLabels {
            open_main: "Manage Prompts...",
            open_settings: "Settings...",
            show_button: "Show Calico",
            hide_button: "Hide Calico",
            open_accessibility: "Open Accessibility Settings",
            quit: "Quit Prompt Picker",
        },
    }
}
```

Update `setup_menu_bar_app` to call a helper:

```rust
fn build_menu_bar_menu(app_handle: &tauri::AppHandle, language: &str) -> Result<Menu<tauri::Wry>, String>
```

**Step 4: Add command to refresh menu language**

Add command:

```rust
#[tauri::command]
fn set_menu_language(app: tauri::AppHandle, language: String) -> Result<(), String> {
    let menu = build_menu_bar_menu(&app, &language)?;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

If `tray_by_id` is unavailable in this Tauri version, use the equivalent Tauri 2 tray lookup API available from `Manager`; do not create a second tray icon.

Register command in `invoke_handler`.

**Step 5: Add platform wrapper**

In `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/platform/platformApi.ts`:

```ts
import type { AppLanguage } from "../shared/settingsStore";

export async function setMenuLanguage(language: AppLanguage): Promise<void> {
  return invoke("set_menu_language", { language });
}
```

**Step 6: Wire startup and language change**

In App:
- after settings load, call `setMenuLanguage(loadedSettings.language)` best-effort.
- after `updateLanguage`, call `setMenuLanguage(language)` best-effort.

Do not block UI if the backend menu update fails; log warning.

**Step 7: Run tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml menu_bar_app_tests
npm test -- --run src/app/App.test.tsx
```

Expected: PASS.

**Step 8: Commit**

```bash
git add src-tauri/src/lib.rs src/platform/platformApi.ts src/App.tsx src/app/App.test.tsx
git commit -m "feat: localize menu bar labels"
```

---

### Task 8: Final Verification

**Files:**
- No source changes expected unless verification exposes a real issue.

**Step 1: Run full frontend tests**

Run:

```bash
npm test -- --run
```

Expected: PASS.

**Step 2: Run frontend build**

Run:

```bash
npm run build
```

Expected: PASS.

**Step 3: Run Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

**Step 4: Manual product checks**

Run the app and verify:

```bash
npm run tauri dev
```

Check:
- Settings page shows Language select.
- Switching to English updates Settings, Manage Prompts, quick list empty states, button controls, and menu bar labels.
- Switching back to Chinese updates all the same areas.
- Add Prompt creates on the first click after typing Chinese title/body.
- Edit Save saves on the first click after typing Chinese.
- Autosend success in paste + return mode shows `已发送`.
- Autosend success in paste-only mode shows `已填入输入框`.
- Quick-list hover preview appears after 1.5 seconds above the hovered prompt container and does not follow the mouse.

**Step 5: Commit verification-only fixes if needed**

If tests or manual checks expose a bug, make the smallest scoped fix and commit:

```bash
git add <files>
git commit -m "fix: address prompt picker verification issue"
```

Do not bundle unrelated refactors.

---

## User-Facing End State

When this plan is implemented:

- The user writes a prompt title and body, clicks `Add Prompt` once, and the prompt is added immediately.
- The small Calico status bubble says `已发送` after send mode succeeds.
- In paste-only mode, the bubble says `已填入输入框`.
- Settings has a language dropdown:

```text
语言
选择应用界面使用的语言。
[ 中文 v ]
```

- Manage Prompts has an obvious shortcut:

```text
管理提示词                                  [ 设置 ] [ 导入 ] [ 导出 ]
本地库中有 11 个提示词容器。
```

- The quick-list hover detail belongs visually to the prompt container:

```text
┌──────────────────────────────┐
│ 完整提示词正文内容             │
│ 最多固定高度，超出内部滚动      │
└──────────────────────────────┘
          8px gap
┌──────────────────────────────┐
│ 讨论方案                       │
│ 使用 brainstorming skill...    │
└──────────────────────────────┘
```

---

## Execution Notes

- Do not change the prompt data model unless a task explicitly says to.
- Do not change Calico artwork or floating-window behavior in this plan.
- Keep all UI copy behind the i18n catalog after Task 3.
- Prefer exact targeted tests before each implementation.
- Keep commits small and aligned with task boundaries.
