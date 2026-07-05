# Popover Permission Menubar Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the prompt popover visually appear as one transparent-corner rounded panel, move macOS Accessibility authorization to the first Calico click, prevent unauthorized clipboard mutation, and sharpen the menu bar `P` icon.

**Architecture:** Keep this as a focused polish pass across the existing Tauri/Rust window layer, vanilla overlay button page, React prompt selection flow, shared settings normalization, and icon assets. The popover fix removes the extra native/webview padding and external shadow; the permission fix adds a small platform-aware permission gate before opening the popover and keeps backend command defenses; the icon fix replaces the current low-resolution menubar mask with a reproducibly generated, pixel-aligned template icon.

**Tech Stack:** Tauri 2, Rust, React, TypeScript, vanilla `public/overlay.html`, CSS, Vitest, Cargo tests, Python/Pillow for icon generation if available.

---

## Scope And Non-Goals

This plan includes:

1. Prompt popover visual boundary fix.
2. Calico click Accessibility permission UX.
3. Backend clipboard safety for unauthorized autosend/paste paths.
4. Multilingual status text for the overlay permission flow.
5. Menu bar `P` icon clarity improvement.

This plan does not include:

1. Changing prompt category behavior.
2. Redesigning the prompt cards beyond the outer popover boundary.
3. Replacing the app icon, dock icon, installer icon, or Calico assets.
4. Repackaging/releasing the app. That is a separate follow-up after implementation is verified.

## Risk Corrections Required Before Execution

The implementation must account for these edge cases. They are not optional follow-ups:

1. macOS may not show the native Accessibility prompt again for an app/signature that has already requested it. The first-click flow must still be understandable if `request_accessibility_permission_cmd` returns without a visible system prompt. Use fallback-capable copy and open System Settings on the next unauthorized click.
2. TypeScript and Rust both read/write `settings.json`. Any new `permissions` field must be added to both `src/shared/settingsStore.ts` and `src-tauri/src/lib.rs` defaults/normalization so one side does not erase or ignore the other side's state.
3. `paste_only` currently throws into the generic React catch path when `pastePromptToLastTarget()` fails. Permission failures in that mode must also show the Accessibility-specific message, not the generic "try again" message.
4. Backend clipboard protection must cover every macOS function that uses System Events or target-app paste automation, not just the main autosend function.
5. Removing popover padding changes native window geometry. Positioning, edge clamping, button-controls mode, and outside-click hit testing must all be tested together.
6. Menu bar icon sharpness cannot be proven by a unit test alone. Keep structural mask tests, but final acceptance depends on manual menu bar screenshot QA.

## Desired User Experience

### Prompt Popover

```text
╭──────────────────────────────╮
│ Tabs                         │
│ Prompt cards                 │
│ Prompt cards                 │
╰──────────────────────────────╯

Only one visible rounded panel.
The four rounded-corner crescent areas are transparent.
No outer rectangular shell.
No gray gutter.
No clipped rectangular shadow.
```

### First Unauthorized Calico Click

```text
[User clicks Calico]
        ↓
[Check Accessibility permission]
        ↓
[Not trusted + native prompt not requested]
        ↓
[Show macOS native Accessibility prompt]
        ↓
[Do not open prompt popover]
```

### Later Unauthorized Calico Click

```text
[User clicks Calico]
        ↓
[Check Accessibility permission]
        ↓
[Not trusted + native prompt already requested]
        ↓
[Open System Settings > Privacy & Security > Accessibility]
        ↓
[Do not open prompt popover]
```

### Authorized Calico Click

```text
[User clicks Calico]
        ↓
[Check Accessibility permission]
        ↓
[Trusted, or platform does not require this permission]
        ↓
[Open prompt popover]
```

---

## Task 1: Add Shared Settings State For Permission Prompt History

**Files:**
- Modify: `src/shared/settingsStore.ts`
- Test: `src/shared/settingsStore.test.ts`

**Step 1: Write failing settings tests**

Add tests covering:

```ts
it("defaults permission prompt history to not requested", async () => {
  const store = createTestSettingsStore(null);

  await expect(store.get()).resolves.toMatchObject({
    permissions: { accessibilityPromptRequested: false },
  });
});

it("normalizes old settings without permissions", async () => {
  const store = createTestSettingsStore(
    JSON.stringify({
      version: 1,
      language: "zh-CN",
      blacklistedApps: [],
      overlayPlacement: { buttonOffset: null, buttonPosition: null },
      floatingButton: { visible: true },
      promptInsertion: { mode: "paste_and_submit" },
    })
  );

  await expect(store.get()).resolves.toMatchObject({
    permissions: { accessibilityPromptRequested: false },
  });
});

it("saves accessibility prompt requested state", async () => {
  const store = createTestSettingsStore(null);

  await store.setAccessibilityPromptRequested(true);

  await expect(store.get()).resolves.toMatchObject({
    permissions: { accessibilityPromptRequested: true },
  });
});
```

**Step 2: Run the failing tests**

Run:

```bash
npm test -- src/shared/settingsStore.test.ts
```

Expected: FAIL because `permissions` and `setAccessibilityPromptRequested` do not exist.

**Step 3: Implement settings shape**

In `src/shared/settingsStore.ts`, extend `Settings`:

```ts
permissions: {
  accessibilityPromptRequested: boolean;
};
```

Update `defaultSettings()`:

```ts
permissions: {
  accessibilityPromptRequested: false
}
```

Update `normalizeSettings()`:

```ts
permissions: {
  accessibilityPromptRequested:
    candidate.permissions?.accessibilityPromptRequested === true
}
```

Add store method:

```ts
async setAccessibilityPromptRequested(requested: boolean): Promise<void> {
  const settings = await load();
  settings.permissions.accessibilityPromptRequested = requested;
  await save(settings);
}
```

**Step 4: Run tests**

Run:

```bash
npm test -- src/shared/settingsStore.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/shared/settingsStore.ts src/shared/settingsStore.test.ts
git commit -m "feat: track accessibility prompt history"
```

---

## Task 2: Add Rust Permission Status Commands

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Step 1: Write failing Rust tests**

Add tests near existing settings/menu tests:

```rust
#[test]
fn default_settings_tracks_accessibility_prompt_history() {
    let settings = default_settings_value();

    assert_eq!(
        settings.pointer("/permissions/accessibilityPromptRequested"),
        Some(&serde_json::Value::Bool(false))
    );
}

#[test]
fn permission_status_does_not_require_accessibility_on_non_macos() {
    let status = prompt_interaction_permission_status_from_parts(
        false,
        false,
        false,
        "zh-CN".to_string(),
    );

    assert!(!status.required);
    assert!(status.trusted);
    assert!(!status.native_prompt_requested);
    assert_eq!(status.language, "zh-CN");
}

#[test]
fn permission_status_reports_untrusted_macos_prompt_state() {
    let status = prompt_interaction_permission_status_from_parts(
        true,
        false,
        true,
        "en-US".to_string(),
    );

    assert!(status.required);
    assert!(!status.trusted);
    assert!(status.native_prompt_requested);
    assert_eq!(status.language, "en-US");
}
```

**Step 2: Run the failing tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml permission_status --lib
cargo test --manifest-path src-tauri/Cargo.toml default_settings_tracks_accessibility_prompt_history --lib
```

Expected: FAIL because the helper and settings field do not exist.

**Step 3: Implement status type and helpers**

In `src-tauri/src/lib.rs`, add:

```rust
#[derive(Clone, Debug, serde::Serialize)]
struct PromptInteractionPermissionStatus {
    required: bool,
    trusted: bool,
    native_prompt_requested: bool,
    language: String,
}

fn prompt_interaction_permission_status_from_parts(
    required: bool,
    trusted: bool,
    native_prompt_requested: bool,
    language: String,
) -> PromptInteractionPermissionStatus {
    PromptInteractionPermissionStatus {
        required,
        trusted: if required { trusted } else { true },
        native_prompt_requested,
        language,
    }
}
```

Update `default_settings_value()` to include:

```rust
"permissions": {
    "accessibilityPromptRequested": false
}
```

Add helpers:

```rust
fn accessibility_prompt_requested(settings: &serde_json::Value) -> bool {
    settings
        .pointer("/permissions/accessibilityPromptRequested")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
}

fn set_accessibility_prompt_requested(
    app: &tauri::AppHandle,
    requested: bool,
) -> Result<(), String> {
    let mut settings = read_settings_value(app);
    if !settings.is_object() {
        settings = default_settings_value();
    }
    if settings.get("permissions").is_none() || !settings["permissions"].is_object() {
        settings["permissions"] = serde_json::json!({});
    }
    settings["permissions"]["accessibilityPromptRequested"] = serde_json::Value::Bool(requested);
    write_settings_value(app, &settings)
}
```

Add commands:

```rust
#[tauri::command]
fn prompt_interaction_permission_status(
    app: tauri::AppHandle,
) -> PromptInteractionPermissionStatus {
    let settings = read_settings_value(&app);
    let required = cfg!(target_os = "macos");
    let trusted = if required {
        accessibility_status().trusted
    } else {
        true
    };
    prompt_interaction_permission_status_from_parts(
        required,
        trusted,
        accessibility_prompt_requested(&settings),
        settings_language(&settings).to_string(),
    )
}

#[tauri::command]
fn request_prompt_interaction_permission(app: tauri::AppHandle) -> Result<AccessibilityStatus, String> {
    set_accessibility_prompt_requested(&app, true)?;
    Ok(request_accessibility_permission())
}
```

Register both commands in `tauri::generate_handler!`.

**Step 4: Run tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml permission_status --lib
cargo test --manifest-path src-tauri/Cargo.toml default_settings_tracks_accessibility_prompt_history --lib
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add prompt interaction permission status"
```

---

## Task 3: Gate Calico Click Before Opening The Prompt Popover

**Files:**
- Modify: `public/overlay.html`
- Test: `src/overlay/overlayHtml.test.ts`

**Step 1: Write failing overlay HTML tests**

Add tests:

```ts
it("checks prompt interaction permission before opening the prompt list", () => {
  const html = readOverlayHtml();

  const clickBlock = html.slice(
    html.indexOf("const sessionId = ++promptPickSessionId;"),
    html.indexOf("start = null;", html.indexOf("const sessionId = ++promptPickSessionId;"))
  );

  expect(clickBlock).toContain("prompt_interaction_permission_status");
  expect(clickBlock.indexOf("prompt_interaction_permission_status")).toBeLessThan(
    clickBlock.indexOf("toggle_prompt_popover_from_button")
  );
});

it("does not open the prompt list when accessibility permission is required and missing", () => {
  const html = readOverlayHtml();

  expect(html).toContain("handleMissingPromptInteractionPermission");
  expect(html).toContain("request_prompt_interaction_permission");
  expect(html).toContain("open_accessibility_settings");
  expect(html).toContain("if (permission?.required && !permission.trusted)");
});
```

**Step 2: Run failing tests**

Run:

```bash
npm test -- src/overlay/overlayHtml.test.ts
```

Expected: FAIL because the permission gate is not present.

**Step 3: Add overlay permission text and debounce**

In `public/overlay.html`, add near existing state:

```js
const permissionMessages = {
  'zh-CN': {
    nativePrompt: '请在系统弹窗中授权',
    nativePromptFallback: '未看到弹窗？再点小猫',
    settingsOpened: '请启用 Prompt Picker',
    settingsOpenFailed: '请手动打开系统设置中的辅助功能权限'
  },
  'en-US': {
    nativePrompt: 'Use the system prompt',
    nativePromptFallback: 'No prompt? Click Calico again',
    settingsOpened: 'Enable Prompt Picker in Accessibility',
    settingsOpenFailed: 'Open Accessibility manually in System Settings'
  }
};

let lastAccessibilitySettingsOpenAt = 0;

function permissionText(language, key) {
  const messages = permissionMessages[language] || permissionMessages['zh-CN'];
  return messages[key] || permissionMessages['zh-CN'][key];
}
```

Add handler:

```js
async function handleMissingPromptInteractionPermission(permission) {
  const language = permission?.language || 'zh-CN';
  if (!permission?.native_prompt_requested) {
    await invoke('request_prompt_interaction_permission');
    showStatusBubble({
      kind: 'failed',
      message: permissionText(language, 'nativePrompt')
    });
    window.setTimeout(() => {
      showStatusBubble({
        kind: 'failed',
        message: permissionText(language, 'nativePromptFallback')
      });
    }, 1900);
    return;
  }

  const now = Date.now();
  if (now - lastAccessibilitySettingsOpenAt < 4000) {
    showStatusBubble({
      kind: 'failed',
      message: permissionText(language, 'settingsOpened')
    });
    return;
  }

  lastAccessibilitySettingsOpenAt = now;
  try {
    await invoke('open_accessibility_settings');
    showStatusBubble({
      kind: 'failed',
      message: permissionText(language, 'settingsOpened')
    });
  } catch {
    showStatusBubble({
      kind: 'failed',
      message: permissionText(language, 'settingsOpenFailed')
    });
  }
}
```

Update click path before `toggle_prompt_popover_from_button`:

```js
const permission = await invoke('prompt_interaction_permission_status');
if (permission?.required && !permission.trusted) {
  await handleMissingPromptInteractionPermission(permission);
  resetCalicoMotion();
  return;
}
```

Then continue with the existing popover toggle.

**Step 4: Remove status bubble click-as-authorization path**

Remove the specific permission action behavior:

```js
statusBubble?.addEventListener('click', async () => {
  ...
});
```

or leave only non-permission generic behavior if future actions need it. The prompt permission path should no longer depend on clicking the bubble.

**Step 5: Add explicit first-click/second-click expectations**

Update `src/overlay/overlayHtml.test.ts` so the HTML text assertions prove:

```ts
expect(html).toContain("native_prompt_requested");
expect(html).toContain("request_prompt_interaction_permission");
expect(html).toContain("nativePromptFallback");
expect(html).toContain("open_accessibility_settings");
expect(html.indexOf("request_prompt_interaction_permission")).toBeLessThan(
  html.indexOf("open_accessibility_settings")
);
expect(html).not.toContain("Click to authorize");
expect(html).not.toContain("点击授权");
```

The first unauthorized click must request the native prompt and return. It must not immediately open System Settings. The second unauthorized click may open settings because `native_prompt_requested` is then true.

Keep these overlay messages short. The status bubble has limited width and long strings will truncate. If the native macOS prompt does not appear because the app/signature already requested permission in the past, the delayed fallback bubble tells the user to click Calico again so the second-click System Settings path can run.

**Step 6: Run tests**

Run:

```bash
npm test -- src/overlay/overlayHtml.test.ts
```

Expected: PASS.

**Step 7: Commit**

```bash
git add public/overlay.html src/overlay/overlayHtml.test.ts
git commit -m "feat: gate calico click on accessibility permission"
```

---

## Task 4: Remove Click-To-Authorize Status From React Autosend Fallback

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/shared/i18n.ts`
- Test: `src/app/App.test.tsx`

**Step 1: Write failing React tests**

Update the existing missing permission autosend tests to expect an explanatory message with no action.

Example expectation:

```ts
expect(emitMock).toHaveBeenCalledWith("prompt-autosend-status", {
  kind: "failed",
  message: "请在辅助功能中启用 Prompt Picker",
  action: undefined,
});
```

Also add:

```ts
expect(screen.queryByText("点击授权")).toBeNull();
```

or assert emitted messages do not equal `点击授权`.

Add a `paste_only` permission failure test. Mock settings so `promptInsertion.mode` is `"paste_only"` and make `paste_prompt_to_last_target` reject with the backend permission string:

```ts
it("shows accessibility guidance when paste-only insertion lacks permission", async () => {
  const { invoke } = await import("@tauri-apps/api/core");
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    if (command === "paste_prompt_to_last_target") {
      throw new Error("Accessibility permission required for prompt insertion.");
    }
    return undefined;
  });

  // Arrange settings with promptInsertion.mode = "paste_only", render App, click a prompt.

  await waitFor(() => {
    expect(emitMock).toHaveBeenCalledWith("prompt-autosend-status", {
      kind: "failed",
      message: "请在辅助功能中启用 Prompt Picker",
      action: undefined,
    });
  });
});
```

**Step 2: Run failing tests**

Run:

```bash
npm test -- src/app/App.test.tsx
```

Expected: FAIL because `statusForAutosendOutcome()` still returns `clickToAuthorize` and `action`.

**Step 3: Update i18n**

In `src/shared/i18n.ts`, replace or deprecate:

```ts
clickToAuthorize
```

with:

```ts
enableAccessibility: "请在辅助功能中启用 Prompt Picker"
```

and English:

```ts
enableAccessibility: "Enable Prompt Picker in Accessibility"
```

Keep `clickToAuthorize` only if removing it causes large unrelated churn, but do not use it for autosend statuses.

**Step 4: Update autosend status mapping**

In `src/App.tsx`, update both missing-permission branches:

```ts
case "missing_accessibility_permission":
  return {
    kind: "failed",
    message: t.autosend.enableAccessibility,
  };
```

and sequence equivalent:

```ts
if (outcome.reason === "missing_accessibility_permission") {
  return {
    kind: "failed",
    message: t.autosend.enableAccessibility,
  };
}
```

**Step 5: Add an accessibility error detector for thrown paste-only errors**

In `src/App.tsx`, add a small helper near the status helpers:

```ts
function isAccessibilityPermissionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.toLowerCase().includes("accessibility permission");
}
```

Update the `catch` block in `handleSelect`:

```ts
if (isAccessibilityPermissionError(e)) {
  emitCalicoMotion("notification", "accessibility-permission-required", 5200);
  await emitAutosendStatus("failed", t.autosend.enableAccessibility);
  return;
}
```

Keep the existing generic catch behavior for non-permission exceptions.

**Step 6: Run tests**

Run:

```bash
npm test -- src/app/App.test.tsx
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src/App.tsx src/shared/i18n.ts src/app/App.test.tsx
git commit -m "fix: replace click to authorize autosend status"
```

---

## Task 5: Prevent Unauthorized Clipboard Mutation In Backend Autosend Paths

**Files:**
- Modify: `src-tauri/src/platform/macos.rs`

**Step 1: Write failing Rust tests**

Add tests in `src-tauri/src/platform/macos.rs` test module using existing test patterns:

```rust
#[test]
fn clipboard_autosend_checks_accessibility_before_copying() {
    let mut copied = false;
    let outcome = paste_prompt_and_submit_to_app_clipboard_with_copier(
        "hello",
        "com.example.App",
        None,
        |_| {
            copied = true;
            Ok(())
        },
    );

    if !is_accessibility_trusted() {
        assert!(!copied);
        assert_eq!(
            outcome.reason,
            Some(AutosendFailureReason::MissingAccessibilityPermission)
        );
    }
}
```

For deterministic unit coverage, prefer extracting an internal helper:

```rust
fn paste_prompt_and_submit_to_app_clipboard_with_accessibility<C, A>(
    body: &str,
    bundle_id: &str,
    click_point: Option<(f64, f64)>,
    copy_sender: C,
    is_trusted: A,
) -> AutosendOutcome
where
    C: FnOnce(&str) -> Result<(), String>,
    A: FnOnce() -> bool,
```

Then test with `|| false`:

```rust
#[test]
fn clipboard_autosend_does_not_copy_without_accessibility() {
    let mut copied = false;
    let outcome = paste_prompt_and_submit_to_app_clipboard_with_accessibility(
        "hello",
        "com.example.App",
        None,
        |_| {
            copied = true;
            Ok(())
        },
        || false,
    );

    assert!(!copied);
    assert_eq!(
        outcome.reason,
        Some(AutosendFailureReason::MissingAccessibilityPermission)
    );
}
```

Add equivalent tests for foreground paste/submit helper if helper extraction is needed there.

Add at least one deterministic test for each permission-sensitive family:

Create private helper functions if needed so tests can inject `|| false` instead of depending on the real machine permission state. The helper names below are illustrative; use the closest local naming style and keep them private to `macos.rs`.

```rust
#[test]
fn foreground_autosend_does_not_copy_without_accessibility() {
    let mut copied = false;
    let outcome = paste_prompt_and_submit_to_foreground_with_accessibility(
        "hello",
        |_| {
            copied = true;
            Ok(())
        },
        || false,
    )
    .expect("helper should return an outcome");

    assert!(!copied);
    assert_eq!(
        outcome.reason,
        Some(AutosendFailureReason::MissingAccessibilityPermission)
    );
}

#[test]
fn paste_to_app_does_not_copy_without_accessibility() {
    let mut copied = false;
    let result = paste_prompt_to_app_with_accessibility(
        "hello",
        "com.example.App",
        |_| {
            copied = true;
            Ok(())
        },
        || false,
    );

    assert!(!copied);
    assert!(result.unwrap_err().contains("Accessibility permission"));
}
```

**Step 2: Run failing tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml does_not_copy_without_accessibility --lib
```

Expected: FAIL because copy currently happens before the permission check.

**Step 3: Move permission checks before copy**

For `paste_prompt_and_submit_to_app_clipboard_with_copier`, change order from:

```rust
if let Err(error) = copy_sender(body) {
    return AutosendOutcome::copy_failed(error);
}
if !is_accessibility_trusted() {
    return AutosendOutcome::missing_accessibility_permission();
}
```

to:

```rust
if !is_accessibility_trusted() {
    return AutosendOutcome::missing_accessibility_permission();
}
if let Err(error) = copy_sender(body) {
    return AutosendOutcome::copy_failed(error);
}
```

Apply the same principle to:

- `paste_prompt_to_app_with_copier`
- `paste_prompt_and_submit_to_app_with_copier`
- `paste_prompt_and_submit_to_foreground_with_copier`
- `type_or_paste_prompt_and_submit_to_foreground_with_copier`
- `paste_prompt_and_submit_to_app_clipboard_with_copier`
- `type_or_paste_prompt_and_submit_to_app_with_copier`
- `paste_prompt_and_submit_to_app_at_point_with_copier`

Important: `type_or_paste_prompt_and_submit_to_app_with_copier` and `type_or_paste_prompt_and_submit_to_foreground_with_copier` can attempt direct System Events typing before copying. The permission check must happen before both direct typing and clipboard fallback.

For `Result<(), String>` functions, return a clear error string before copy:

```rust
if !is_accessibility_trusted() {
    return Err("Accessibility permission required for prompt insertion.".to_string());
}
```

For `AutosendOutcome` functions, preserve:

```rust
AutosendOutcome::missing_accessibility_permission()
```

Do not change plain clipboard-only `paste_prompt_with_copier`; it does not use System Events and should remain available without Accessibility permission.

**Step 4: Run backend tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src-tauri/src/platform/macos.rs
git commit -m "fix: check accessibility before clipboard writes"
```

---

## Task 6: Update App Tests That Expected No Frontend Permission Preflight

**Files:**
- Modify: `src/app/App.test.tsx`
- Modify: `src/overlay/overlayHtml.test.ts`

**Step 1: Identify obsolete expectations**

Find:

```bash
rg -n "does not run a frontend accessibility preflight|accessibility_status_cmd|open_accessibility_settings|Click to authorize|点击授权" src/app src/overlay
```

**Step 2: Replace obsolete App expectation**

The test named like:

```ts
it("does not run a frontend accessibility preflight before autosend", ...)
```

should no longer assert that permission preflight never happens globally. Since preflight now happens in `public/overlay.html` before opening the popover, this React test should either:

1. Be removed if it only covered the old product decision.
2. Be renamed to assert React selection still trusts backend outcomes and does not open settings itself.

Preferred replacement:

```ts
it("keeps prompt selection permission handling nonblocking when backend reports missing accessibility", async () => {
  ...
  expect(emitMock).toHaveBeenCalledWith("prompt-autosend-status", {
    kind: "failed",
    message: "请在辅助功能中启用 Prompt Picker",
    action: undefined,
  });
});
```

**Step 3: Run targeted tests**

Run:

```bash
npm test -- src/app/App.test.tsx src/overlay/overlayHtml.test.ts
```

Expected: PASS.

**Step 4: Commit**

```bash
git add src/app/App.test.tsx src/overlay/overlayHtml.test.ts
git commit -m "test: update permission preflight expectations"
```

---

## Task 7: Remove Prompt Popover Outer Padding And Shadow

**Files:**
- Modify: `src/styles.css`
- Modify: `src-tauri/src/windows.rs`
- Test: `src-tauri/src/windows.rs`
- Test: create `src/app/popoverStyles.test.ts` or extend an existing CSS text test if one exists.

**Step 1: Write failing Rust window tests**

Update/add tests in `src-tauri/src/windows.rs`:

```rust
#[test]
fn popover_window_size_matches_visible_panel_size() {
    let size = popover_window_size_for_mode("popover");

    assert_eq!(size.width, POPOVER_WIDTH);
    assert_eq!(size.height, POPOVER_HEIGHT);
}

#[test]
fn popover_visual_rect_matches_native_rect_without_outer_padding() {
    let rect = tauri::PhysicalPosition { x: 100.0, y: 200.0 };
    let visual = popover_window_position_from_visual_position(100.0, 200.0, "popover");

    assert_eq!(visual.x, rect.x);
    assert_eq!(visual.y, rect.y);
}
```

Adapt exact types to existing helper signatures.

Also update existing tests that currently encode the old 16px gutter:

```rust
#[test]
fn prompt_popover_native_window_matches_visible_panel() {
    let visual_size = popover_size_for_mode("popover");
    let window_size = popover_window_size_for_mode("popover");

    assert_eq!(POPOVER_WINDOW_PADDING, 0.0);
    assert_eq!(visual_size.width, POPOVER_WIDTH);
    assert_eq!(visual_size.height, POPOVER_HEIGHT);
    assert_eq!(window_size.width, POPOVER_WIDTH);
    assert_eq!(window_size.height, POPOVER_HEIGHT);
}

#[test]
fn clamps_popover_horizontally_inside_monitor_without_shadow_padding() {
    let bounds = MonitorBounds {
        x: 0.0,
        y: 0.0,
        width: 1440.0,
        height: 900.0,
    };
    let left = clamp_popover_position_in_bounds(
        4.0,
        400.0,
        BUTTON_VISUAL_WIDTH,
        BUTTON_VISUAL_HEIGHT,
        Some(bounds),
    );
    let right = clamp_popover_position_in_bounds(
        1390.0,
        400.0,
        BUTTON_VISUAL_WIDTH,
        BUTTON_VISUAL_HEIGHT,
        Some(bounds),
    );

    assert_eq!(left.0, 8.0);
    assert_eq!(right.0, 1440.0 - POPOVER_WIDTH - 8.0);
}

#[test]
fn visual_popover_rect_matches_native_window_rect() {
    let native = WindowRect {
        x: 800.0,
        y: 20.0,
        width: POPOVER_WIDTH,
        height: POPOVER_HEIGHT,
    };

    let visual = visual_popover_rect_from_window_rect(native, "popover");

    assert_eq!(visual.x, native.x);
    assert_eq!(visual.y, native.y);
    assert_eq!(visual.width, native.width);
    assert_eq!(visual.height, native.height);
}
```

Keep and update the button-controls tests to prove `button-controls` still uses `BUTTON_CONTROLS_WIDTH`/`BUTTON_CONTROLS_HEIGHT` and no popover-specific padding.

**Step 2: Write failing CSS test**

Create `src/app/popoverStyles.test.ts`:

```ts
import { readFileSync } from "node:fs";

describe("popover styles", () => {
  const css = readFileSync("src/styles.css", "utf8");

  it("does not reserve an outer popover window gutter", () => {
    expect(css).toContain("--pp-popover-window-padding: 0px");
    expect(css).toContain(".popover-root");
  });

  it("does not paint an external popover shadow into transparent corners", () => {
    const popoverWindowBlock = css.slice(
      css.indexOf(".popover-window"),
      css.indexOf(".popover-window-header") > -1
        ? css.indexOf(".popover-window-header")
        : css.indexOf(".quick-list", css.indexOf(".popover-window"))
    );

    expect(popoverWindowBlock).not.toContain("box-shadow: var(--pp-shadow-popover)");
  });
});
```

**Step 3: Run failing tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml popover_window --lib
npm test -- src/app/popoverStyles.test.ts
```

Expected: FAIL because the code still uses `16px` padding and external shadow.

**Step 4: Update Rust popover sizing**

In `src-tauri/src/windows.rs`, remove the popover-specific outer padding from native sizing and positioning:

```rust
const POPOVER_WINDOW_PADDING: f64 = 0.0;
const POPOVER_WINDOW_WIDTH: f64 = POPOVER_WIDTH;
const POPOVER_WINDOW_HEIGHT: f64 = POPOVER_HEIGHT;
```

Or remove the derived padded constants entirely if that is cleaner.

Ensure these helpers become no-ops for popover padding:

- `popover_window_padding_for_mode`
- `popover_window_size_for_mode`
- `popover_window_position_from_visual_position`
- `visual_popover_rect_from_window_rect`

The visible popover rect and native window rect should align.

**Step 5: Update CSS popover shell**

In `src/styles.css`, set:

```css
:root {
  --pp-popover-window-padding: 0px;
}
```

Update:

```css
.popover-root {
  width: 100vw;
  height: 100vh;
  min-height: 0;
  overflow: hidden;
  padding: 0;
  background: transparent;
}

.popover-window {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  padding: 8px;
  overflow: hidden;
  background: var(--pp-surface-subtle);
  border: 1px solid rgba(148, 163, 184, 0.26);
  border-radius: var(--pp-radius-lg);
  box-shadow: none;
}
```

Keep the existing transparent page class:

```css
html.popover-transparent-page,
body.popover-transparent-page {
  overflow: hidden;
  background: transparent;
}
```

**Step 6: Run tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml popover --lib
npm test -- src/app/popoverStyles.test.ts
```

Expected: PASS.

Before committing, run the full windows test module because many geometry tests share these helpers:

```bash
cargo test --manifest-path src-tauri/Cargo.toml windows::tests --lib
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src/styles.css src-tauri/src/windows.rs src/app/popoverStyles.test.ts
git commit -m "fix: align popover window with rounded panel"
```

---

## Task 8: Verify Prompt Popover Transparency Manually

**Files:**
- No source changes expected.
- Optional QA note: `docs/qa/popover-permission-menubar-polish.md`

**Step 1: Build and run dev app**

Run:

```bash
npm run build
npm run tauri dev
```

Expected: app opens locally.

**Step 2: Inspect popover**

Manual steps:

1. Make sure Accessibility is already authorized so the popover can open.
2. Click Calico.
3. Inspect the popover against a high-contrast background.
4. Confirm there is no visible outer rectangle.
5. Confirm four rounded-corner crescent areas are transparent.
6. Confirm no clipped rectangular shadow appears.
7. Confirm prompt category tabs remain inside the rounded panel.
8. Confirm outside click still closes the popover.

**Step 3: Record QA note if this repo convention is useful**

Create or append:

```markdown
## Popover Transparency QA

- Date:
- Build:
- Result:
- Notes:
```

**Step 4: Commit only if a QA doc is added**

```bash
git add docs/qa/popover-permission-menubar-polish.md
git commit -m "docs: record popover transparency QA"
```

---

## Task 9: Generate A Sharper Menu Bar Template Icon

**Files:**
- Create: `scripts/generate-menubar-icon.py`
- Modify: `src-tauri/icons/menubar-template.png`
- Modify: `src-tauri/icons/menubar-template.rgba`
- Modify: `src-tauri/src/lib.rs` only if icon size changes
- Test: `src-tauri/src/lib.rs`

**Step 1: Write or update icon tests**

In `src-tauri/src/lib.rs`, strengthen `menubar_template_icon_is_transparent_mask()`:

```rust
#[test]
fn menubar_template_icon_is_crisp_transparent_mask() {
    let icon = menubar_template_icon();

    assert_eq!(icon.width(), MENUBAR_TEMPLATE_ICON_SIZE);
    assert_eq!(icon.height(), MENUBAR_TEMPLATE_ICON_SIZE);
    assert_eq!(
        icon.rgba().len(),
        (MENUBAR_TEMPLATE_ICON_SIZE * MENUBAR_TEMPLATE_ICON_SIZE * 4) as usize
    );

    let alpha_values: std::collections::BTreeSet<u8> = icon
        .rgba()
        .chunks_exact(4)
        .map(|pixel| pixel[3])
        .collect();
    let opaque_pixels = icon
        .rgba()
        .chunks_exact(4)
        .filter(|pixel| pixel[3] == 255)
        .count();

    assert!(alpha_values.contains(&0));
    assert!(alpha_values.contains(&255));
    assert!(
        opaque_pixels >= 60 && opaque_pixels <= 220,
        "template icon should have a balanced visible mask, got {} opaque pixels",
        opaque_pixels
    );
}
```

This is a structural guard only. Do not treat unit tests as proof of visual sharpness. The final decision must come from the manual menu bar QA task.

**Step 2: Run structural icon test before changing the asset**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml menubar_template_icon_is_crisp_transparent_mask --lib
```

Expected: May FAIL if the current mask is too sparse/dense, or PASS if it already satisfies the structural guard. Do not block the icon work only because this structural test passes; the current user-visible issue is visual blur in the menu bar.

**Step 3: Create generator script**

Create `scripts/generate-menubar-icon.py`:

```python
#!/usr/bin/env python3
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
PNG_PATH = ROOT / "src-tauri" / "icons" / "menubar-template.png"
RGBA_PATH = ROOT / "src-tauri" / "icons" / "menubar-template.rgba"

SIZE = 22

def draw_block_p(draw: ImageDraw.ImageDraw) -> None:
    # Pixel-aligned block P designed for a 22x22 macOS template icon.
    # The visible shape fits inside x=5..16 and y=3..18 for menu bar balance.
    color = (255, 255, 255, 255)
    draw.rectangle((5, 3, 8, 18), fill=color)
    draw.rectangle((8, 3, 15, 6), fill=color)
    draw.rectangle((8, 9, 15, 12), fill=color)
    draw.rectangle((14, 6, 17, 9), fill=color)

def main() -> None:
    image = Image.new("RGBA", (SIZE, SIZE), (255, 255, 255, 0))
    draw = ImageDraw.Draw(image)
    draw_block_p(draw)
    PNG_PATH.parent.mkdir(parents=True, exist_ok=True)
    image.save(PNG_PATH)
    RGBA_PATH.write_bytes(image.tobytes())

if __name__ == "__main__":
    main()
```

If the 22px block icon looks too pixelated in actual menu bar QA, adjust the script to render at 44px and change `MENUBAR_TEMPLATE_ICON_SIZE` to `44`. Test actual menu bar size before committing a 44px switch, because the tray API may treat image pixels as the icon's natural size.

**Step 4: Generate icon**

Run:

```bash
python3 scripts/generate-menubar-icon.py
```

Expected:

- `src-tauri/icons/menubar-template.png` regenerated.
- `src-tauri/icons/menubar-template.rgba` regenerated.

**Step 5: Run icon tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml menubar_template_icon_is_crisp_transparent_mask --lib
```

Expected: PASS.

If the test passes but the menu bar screenshot still looks blurry or too blocky, revise the generator and keep iterating. Visual QA is the source of truth for this task.

**Step 6: Visual check source image**

Run:

```bash
sips -g pixelWidth -g pixelHeight src-tauri/icons/menubar-template.png
```

Expected:

```text
pixelWidth: 22
pixelHeight: 22
```

**Step 7: Commit**

```bash
git add scripts/generate-menubar-icon.py src-tauri/icons/menubar-template.png src-tauri/icons/menubar-template.rgba src-tauri/src/lib.rs
git commit -m "fix: sharpen menu bar template icon"
```

---

## Task 10: Manual QA Menu Bar Icon

**Files:**
- No source changes expected.
- Optional QA note: `docs/qa/popover-permission-menubar-polish.md`

**Step 1: Build and run**

Run:

```bash
npm run build
npm run tauri dev
```

Expected: app appears in the macOS menu bar.

**Step 2: Compare icon in menu bar**

Manual checks:

1. The `P` edge should look sharper than the previous screenshot.
2. The icon should not look larger than neighboring menu bar icons.
3. The icon should not look too small or too heavy.
4. The icon should remain visible in light and dark menu bar states.
5. It should still open the tray menu on click.

**Step 3: Iterate only if needed**

If the shape is too heavy or too small, adjust `scripts/generate-menubar-icon.py`, regenerate, rerun the test, and re-check.

**Step 4: Commit only if QA doc changes**

```bash
git add docs/qa/popover-permission-menubar-polish.md
git commit -m "docs: record menu bar icon QA"
```

---

## Task 11: Full Verification Before Completion

**Files:**
- No source changes expected unless verification reveals issues.

**Step 1: Run frontend tests**

Run:

```bash
npm test
```

Expected: PASS.

**Step 2: Run Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Expected: PASS.

**Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

**Step 4: Run Tauri build check if time permits**

Run:

```bash
npm run tauri build
```

Expected: PASS locally. If signing/notarization requirements make this inappropriate in the current pass, run the closest available non-release compile command and document the limitation.

**Step 5: Manual UX checks**

Check:

1. Fresh unauthorized click path shows macOS native Accessibility prompt and does not open the prompt popover.
2. Second unauthorized click opens System Settings and does not open the prompt popover.
3. Authorized click opens prompt popover.
4. Prompt popover has no outer rectangle or clipped shadow.
5. Prompt popover rounded corners are visually transparent.
6. Unauthorized backend paths do not write to clipboard before returning permission failure.
7. Menu bar `P` is clearer and still template-tinted by macOS.

**Step 6: Final commit if any verification fixes were made**

```bash
git status --short
git add <changed-files>
git commit -m "fix: address verification findings"
```

---

## Implementation Order

Use this order to reduce risk:

1. Settings prompt history.
2. Rust permission status commands.
3. Overlay click permission gate.
4. React fallback message cleanup.
5. Backend clipboard safety.
6. Test cleanup for permission flow.
7. Popover visual boundary fix.
8. Popover manual QA.
9. Menu bar icon generation.
10. Menu bar manual QA.
11. Full verification.

This order makes the authorization behavior testable before the popover visual work and keeps the icon asset work isolated.

## Notes For The Implementer

1. The worktree is currently dirty with generated build artifacts in `dist`, `node_modules`, `src-tauri/target`, `release`, and `src-tauri/gen`. Do not revert unrelated generated files unless the user explicitly asks.
2. Use `rg` for code search.
3. Use `apply_patch` for manual source edits.
4. Do not change prompt category data model or Calico motion behavior unless a test forces a tiny compatibility adjustment.
5. Do not add an app-level custom permission modal. The first unauthorized click should rely on the macOS native Accessibility prompt.
6. Use @superpowers:verification-before-completion before reporting the implementation complete.
