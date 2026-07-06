# Focus-Preserving Autosend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make prompt insertion reliable in apps that require an active text input by preserving the target app's keyboard focus through the floating Calico button and prompt popover, then safely pasting/submitting only when the original target app is still frontmost.

**Architecture:** The main path is focus preservation: `prompt-button` and `prompt-popover` must be non-activating, never-key macOS panels so the target input field keeps keyboard focus while the user clicks Calico and selects a prompt. Autosend becomes a guarded event-injection flow: capture the target app before opening the popover, write the prompt to the clipboard, verify the original target is still frontmost before paste, post native paste, verify again before submit, then either send the configured submit key or safely stop. AX focus repair and coordinate click fallback are not the main path; they are later fallback layers only after L1/L2 are proven.

**Tech Stack:** Tauri 2, Rust, objc2/AppKit, ApplicationServices CGEvent keyboard events, tauri clipboard plugin, React/TypeScript, Vitest, Rust unit tests.

---

## Non-Negotiable Product Rules

- No per-app branches such as `if app == WeChat` or `if app == Claude`.
- `prompt-button` and `prompt-popover` must not activate Prompt Picker or become the key window.
- Main window, prompt manager, and settings window may still activate normally because users edit text there.
- Never paste or submit unless the original target app captured before opening the prompt popover is still frontmost.
- Check frontmost before paste and before submit.
- If safety checks fail before paste, keep the selected prompt in the clipboard and report copied-not-sent.
- If safety checks fail after paste but before submit, do not press the submit key.
- Do not make AX the main path. AX repair is a later fallback layer.
- Do not implement app-specific recipes.
- Preserve existing global `promptInsertion.mode` behavior until per-prompt send behavior is added with backward-compatible migration.

## Current Code Facts

- `src-tauri/src/macos_panels.rs` already sets `NSWindowStyleMask::NonactivatingPanel` and `NSWindowStyleMask::UtilityWindow`, but it does not guarantee `canBecomeKeyWindow == false`.
- `src-tauri/src/windows.rs` creates and shows `prompt-button` and `prompt-popover` via `configure_non_activating_panel`.
- `src-tauri/src/lib.rs` uses `activate_main_window` for manager/settings. This is correct for the main window and must not be removed globally.
- Current autosend path in `src-tauri/src/platform/macos.rs` activates target apps and may click `click_point`. That should move out of the L1/L2 main path.
- `PromptPickSessionState` currently stores app target and optional click point. It needs stronger captured target identity, ideally pid plus bundle id.
- `src/shared/settingsStore.ts` currently has global `promptInsertion.mode = "paste_only" | "paste_and_submit"`.
- `src/shared/promptTypes.ts` currently has no per-prompt send behavior.

---

### Task 1: Add Tests That Document Never-Key Overlay Requirements

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/macos_panels.rs`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/macos_panels.rs`

**Step 1: Write failing Rust tests for overlay-only never-key configuration markers**

Add focused unit tests under the existing `#[cfg(test)]` module or create one if missing. The tests should validate the source-level contract before native behavior is implemented.

```rust
#[test]
fn non_activating_panel_configuration_mentions_never_key_window_guard() {
    let source = include_str!("macos_panels.rs");

    assert!(source.contains("NeverKeyPanel"));
    assert!(source.contains("canBecomeKeyWindow"));
    assert!(source.contains("canBecomeMainWindow"));
}

#[test]
fn main_window_activation_remains_separate_from_overlay_configuration() {
    let source = include_str!("macos_panels.rs");

    assert!(source.contains("pub fn activate_main_window"));
    assert!(source.contains("pub fn configure_non_activating_panel"));
}
```

**Step 2: Run test to verify it fails**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml macos_panels --lib
```

Expected: FAIL because `NeverKeyPanel` / `canBecomeKeyWindow` are not implemented yet.

**Step 3: Commit only if this task is executed in an implementation pass**

Do not commit during planning. During execution, commit after the implementation and passing tests in Task 2.

---

### Task 2: Make Prompt Overlay Windows Never-Key on macOS

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/macos_panels.rs`
- Modify if needed: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/Cargo.toml`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/macos_panels.rs`

**Step 1: Implement a macOS never-key guard for overlay windows**

Implement this in `configure_non_activating_panel`, not in `activate_main_window`.

Preferred implementation:

- Create an Objective-C runtime subclass of the concrete `NSWindow`/panel class for only these overlay windows.
- Override:
  - `canBecomeKeyWindow -> false`
  - `canBecomeMainWindow -> false`
- Apply this subclass in `configure_non_activating_panel`.
- Keep existing:
  - `NSWindowStyleMask::NonactivatingPanel`
  - `NSWindowStyleMask::UtilityWindow`
  - high window level
  - all-spaces collection behavior
  - `setIgnoresMouseEvents(false)`
  - `orderFrontRegardless()`

Implementation notes:

- Use `objc2` runtime APIs already available in the project. Avoid adding a new crate unless objc2 APIs are insufficient.
- The name can be `PromptPickerNeverKeyPanel`.
- Register the class once with `OnceLock`/`Once`.
- Only apply this to windows passed through `configure_non_activating_panel`; do not change the main window.

**Step 2: Run Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml macos_panels --lib
```

Expected: PASS.

**Step 3: Run window-related tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml windows --lib
```

Expected: PASS.

**Step 4: Manual L1 verification build**

Run the app locally:

```bash
npm run tauri -- dev
```

Manual check:

- Open WeChat.
- Click a text input field so the caret is visible.
- Click Calico.
- Open prompt popover.
- Click a prompt row.
- Observe whether WeChat remains the frontmost app and whether the WeChat caret remains active during the whole flow.

Expected: Prompt Picker overlay receives mouse clicks, but WeChat/Claude remains the key/frontmost target.

**Step 5: Commit**

```bash
git add src-tauri/src/macos_panels.rs src-tauri/Cargo.toml
git commit -m "fix: keep prompt overlays from taking key focus"
```

Only include `src-tauri/Cargo.toml` if it was actually modified.

---

### Task 3: Strengthen Prompt Pick Session Target Identity

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/platform/macos.rs`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/platform/unsupported.rs`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/platform/mod.rs`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`

**Step 1: Write failing tests for strict target matching**

Add tests near the existing `PromptPickSessionState`/autosend tests in `src-tauri/src/lib.rs`.

Test behavior:

- A captured target with bundle id `com.tencent.xinWeChat` and pid `123` should match only frontmost app with the same bundle id and pid.
- A different bundle id should fail.
- A same bundle id but different pid should fail if pid is available.
- If pid is unavailable on unsupported platforms, bundle id fallback may be used.

Example shape:

```rust
#[test]
fn captured_target_matches_only_same_bundle_and_pid() {
    let target = CapturedPromptTarget {
        app: FrontmostApp {
            name: "WeChat".to_string(),
            bundle_id: "com.tencent.xinWeChat".to_string(),
        },
        pid: Some(123),
    };
    let same = FrontmostAppWithPid {
        app: target.app.clone(),
        pid: Some(123),
    };
    let different_pid = FrontmostAppWithPid {
        app: target.app.clone(),
        pid: Some(456),
    };

    assert!(captured_target_matches_frontmost(&target, Some(&same)));
    assert!(!captured_target_matches_frontmost(&target, Some(&different_pid)));
}
```

Use names that match the actual implementation.

**Step 2: Run test to verify it fails**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml captured_target --lib
```

Expected: FAIL because strong captured target helpers do not exist yet.

**Step 3: Implement public frontmost app identity with pid**

In `src-tauri/src/platform/macos.rs`:

- Add a serializable struct such as:

```rust
#[derive(Clone, Debug, Serialize)]
pub struct FrontmostAppWithPid {
    pub app: FrontmostApp,
    pub pid: Option<u32>,
}
```

- Add function:

```rust
pub fn frontmost_app_with_pid() -> Option<FrontmostAppWithPid> {
    frontmost_app_info().map(|info| FrontmostAppWithPid {
        app: info.app,
        pid: Some(info.pid),
    })
}
```

In unsupported platform module, return bundle-only or `None` depending on existing style.

In `platform/mod.rs`, re-export the type/function as needed.

**Step 4: Replace session target capture with strict target identity**

In `src-tauri/src/lib.rs`:

- Add pid to `LastInputTarget` and `PromptPickSessionTarget`.
- Capture pid from `platform::macos::frontmost_app_with_pid()`.
- Preserve app fields for UI/status.
- Update `prompt_pick_session_target`.
- Update fallback from recent target.

**Step 5: Implement strict target matching helper**

Add helper:

```rust
fn captured_target_matches_frontmost(
    target: &PromptPickSessionTarget,
    frontmost: Option<&platform::FrontmostAppWithPid>,
) -> bool {
    let Some(frontmost) = frontmost else {
        return false;
    };
    if frontmost.app.bundle_id != target.app.bundle_id {
        return false;
    }
    match (target.pid, frontmost.pid) {
        (Some(target_pid), Some(front_pid)) => target_pid == front_pid,
        _ => true,
    }
}
```

Adjust names to the actual structs.

**Step 6: Run tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml captured_target --lib
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src-tauri/src/platform/macos.rs src-tauri/src/platform/unsupported.rs src-tauri/src/platform/mod.rs src-tauri/src/lib.rs
git commit -m "fix: capture strict autosend target identity"
```

---

### Task 4: Add Guarded Autosend Event Flow Without Target Activation or Clicks

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/platform/macos.rs`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/platform/macos.rs`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`

**Step 1: Write failing tests proving the main path does not activate or click target apps**

In `src-tauri/src/platform/macos.rs`, add source-level and helper tests:

```rust
#[test]
fn focus_preserving_autosend_main_path_does_not_activate_or_click() {
    let source = include_str!("macos.rs");

    let main_path_start = source
        .find("focus_preserving_paste_and_submit")
        .expect("focus-preserving autosend function should exist");
    let main_path = &source[main_path_start..];

    assert!(!main_path.contains("activate_app_by_bundle_id"));
    assert!(!main_path.contains("click_target_point"));
    assert!(!main_path.contains("cmd_tab_refocus"));
}
```

Use the final function name chosen in implementation.

In `src-tauri/src/lib.rs`, add tests for before-paste and before-submit guard behavior with injected closures:

- If frontmost does not match before paste, outcome is copied-not-sent, paste is not posted, submit is not posted.
- If frontmost matches before paste but not before submit, paste is posted, submit is not posted.
- If both checks match, paste and submit are posted.

**Step 2: Run tests to verify they fail**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml focus_preserving --lib
```

Expected: FAIL because guarded main path does not exist yet.

**Step 3: Implement a send key enum for native events**

In `src-tauri/src/platform/macos.rs`, add:

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeSubmitKey {
    None,
    Enter,
    CommandEnter,
}
```

Add CGEvent helpers:

- `post_paste_shortcut()`
- `post_return_key()`
- `post_command_return_key()`

`post_command_return_key()` should post command down, return down/up with command flags, command up. Reuse existing `post_key_event`.

**Step 4: Implement focus-preserving paste/submit primitive**

Implement a function that does not activate or click:

```rust
pub fn post_focus_preserving_paste_and_submit(submit_key: NativeSubmitKey) -> AutosendOutcome
```

It should:

- post `Cmd+V`;
- sleep 150-250 ms in the caller, not necessarily inside primitive if tests are easier;
- post requested submit key if not `None`.

The frontmost checks should live in `src-tauri/src/lib.rs`, because they need captured session target and current frontmost target.

**Step 5: Implement guarded autosend helper with injected dependencies**

In `src-tauri/src/lib.rs`, create a pure/helper function:

```rust
fn guarded_focus_preserving_autosend_with_senders<C, F, P, S>(
    body: &str,
    target: &PromptPickSessionTarget,
    submit_key: platform::macos::NativeSubmitKey,
    copy_sender: C,
    frontmost_reader: F,
    paste_sender: P,
    submit_sender: S,
) -> AutosendOutcome
where
    C: FnOnce(&str) -> Result<(), String>,
    F: FnMut() -> Option<platform::FrontmostAppWithPid>,
    P: FnOnce() -> Result<(), String>,
    S: FnOnce(platform::macos::NativeSubmitKey) -> Result<(), String>,
```

Behavior:

- Copy prompt to clipboard first.
- Check frontmost target before paste.
- If check fails: return `NoSafeTarget`/copied-not-sent and do not paste.
- Post paste.
- Wait 150-250 ms in production wrapper.
- Check frontmost target again before submit.
- If second check fails: return a new or existing outcome meaning pasted but not submitted. Prefer existing `ReturnEventFailed` or add `TargetFocusFailed` only if UI messages remain correct.
- Post submit only if `submit_key != None`.
- Return sent for submit modes; for paste-only return copied/sent equivalent that UI already interprets as inserted.

**Step 6: Wire single-prompt autosend to the guarded main path**

Replace the main path in `paste_prompt_and_submit_to_last_target_impl` so it:

- takes session target;
- does not call `activate_app_by_bundle_id`;
- does not pass `click_point` to the main path;
- uses strict `frontmost_app_with_pid` checks.

Do not implement L3 AX repair in this task. On guard failure, return copied-not-sent.

**Step 7: Run tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml focus_preserving --lib
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Expected: PASS.

**Step 8: Commit**

```bash
git add src-tauri/src/platform/macos.rs src-tauri/src/lib.rs
git commit -m "fix: guard autosend with focus-preserving target checks"
```

---

### Task 5: Apply Guarded Autosend to Group Prompt Sequences

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`

**Step 1: Write failing sequence tests**

Add tests for:

- Frontmost mismatch before first paste prevents all sequence sends.
- Frontmost mismatch before item 2 paste stops sequence with `sent_count == 1`.
- Frontmost mismatch before submit for an item does not press submit for that item and reports failure.
- Interval clamping remains unchanged.

**Step 2: Run tests to verify they fail**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml autosend_sequence --lib
```

Expected: FAIL for new guard behavior until implemented.

**Step 3: Reuse guarded helper per body**

In `paste_prompt_sequence_and_submit_to_session_target_with_senders`:

- Get one target for the sequence.
- For each body:
  - copy body;
  - check frontmost before paste;
  - paste;
  - wait existing clamped interval only between successfully sent items;
  - check frontmost before submit;
  - submit according to send behavior for the current prompt/group.
- Stop on first failure and return `AutosendSequenceOutcome::from_failure`.

For this task, continue using existing global `paste_and_submit` behavior. Per-prompt send behavior comes later.

**Step 4: Run tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml autosend_sequence --lib
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "fix: guard group autosend sequence focus"
```

---

### Task 6: Add L1 Manual Verification Instrumentation

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/platform/platformApi.ts`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/overlay/overlayHtml.test.ts`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/overlay/overlay.html` or the overlay HTML generator location if different
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/overlay/overlayHtml.test.ts`

**Step 1: Write failing test for debug event order**

Add a test that the overlay click path captures session target asynchronously and does not wait for focus-repair logic before opening.

If an existing test already covers this, add a focused assertion that no `activate` command is called from the overlay click path.

**Step 2: Add optional debug logging only under development**

Add a Tauri command or event emission that can report:

- captured target bundle id/pid;
- frontmost app before paste;
- frontmost app before submit;
- whether guarded path copied, pasted, submitted, or stopped.

Do not show this in user UI. Use `console.debug` or Rust `eprintln!` gated to debug builds.

**Step 3: Run frontend test**

Run:

```bash
npx vitest run src/overlay/overlayHtml.test.ts
```

Expected: PASS.

**Step 4: Manual L1 verification**

Run:

```bash
npm run tauri -- dev
```

Manual matrix:

- WeChat text input:
  - click input field;
  - click Calico;
  - open prompt popover;
  - select a prompt;
  - confirm WeChat stays frontmost before paste and before submit.
- Claude desktop text input:
  - same flow.
- Codex desktop:
  - same flow.
- Notes or a browser textarea:
  - same flow.

Expected:

- `prompt-button` and `prompt-popover` click interactions work.
- Target app remains frontmost in debug logs.
- Text inserts without the "Switch to an input field first" bubble in normal focused-input cases.

**Step 5: Commit**

```bash
git add src-tauri/src/lib.rs src/platform/platformApi.ts src/overlay/overlayHtml.test.ts src/overlay/overlay.html
git commit -m "test: add focus-preserving autosend diagnostics"
```

Only add files actually changed.

---

### Task 7: Introduce Backward-Compatible Send Behavior Model

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/shared/promptTypes.ts`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/shared/promptStore.ts`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/shared/promptTypes.test.ts`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/shared/promptStore.test.ts`
- Modify later UI files only in Task 8

**Step 1: Write failing tests for send behavior normalization**

Add tests:

```ts
it("defaults prompt send behavior to inherit", () => {
  const container = normalizePromptContainerInput({
    title: "Example",
    type: "single",
    prompts: [{ body: "hello" }],
  });

  expect(container.sendBehavior).toBe("inherit");
});

it("normalizes invalid send behavior to inherit", () => {
  // import/legacy JSON with bad value should not break.
});
```

Use actual helper names from `promptStore.ts`; if no exported helper exists, test through store create/import paths.

**Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run src/shared/promptTypes.test.ts src/shared/promptStore.test.ts
```

Expected: FAIL because `sendBehavior` does not exist yet.

**Step 3: Add send behavior types**

In `src/shared/promptTypes.ts`:

```ts
export type PromptSendBehavior = "inherit" | "paste_only" | "paste_enter" | "paste_command_enter";
```

Add optional/required field:

```ts
sendBehavior: PromptSendBehavior;
```

Use `"inherit"` for normalized storage.

Add helper:

```ts
export function normalizePromptSendBehavior(value: unknown): PromptSendBehavior {
  return value === "paste_only" ||
    value === "paste_enter" ||
    value === "paste_command_enter"
    ? value
    : "inherit";
}
```

**Step 4: Update prompt store normalization and import**

In `promptStore.ts`:

- Accept optional `sendBehavior` in `PromptContainerInput`.
- Set missing legacy containers to `"inherit"`.
- Preserve existing containers' valid send behavior.
- Do not rewrite global `promptInsertion.mode`.

**Step 5: Run tests**

Run:

```bash
npx vitest run src/shared/promptTypes.test.ts src/shared/promptStore.test.ts src/shared/promptImportExport.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/shared/promptTypes.ts src/shared/promptStore.ts src/shared/promptTypes.test.ts src/shared/promptStore.test.ts src/shared/promptImportExport.test.ts
git commit -m "feat: add prompt send behavior model"
```

Only add tests files actually modified.

---

### Task 8: Wire Send Behavior into Autosend Without UI Overreach

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/App.tsx`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/platform/platformApi.ts`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/platform/macos.rs`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/app/App.test.tsx`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`

**Step 1: Write failing tests for global fallback behavior**

Tests:

- Container `sendBehavior = "inherit"` with global `paste_only` calls paste-only path.
- Container `sendBehavior = "inherit"` with global `paste_and_submit` uses Enter submit.
- Container `sendBehavior = "paste_command_enter"` uses command-enter submit.
- Container `sendBehavior = "paste_only"` posts paste but not submit.

**Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run src/app/App.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml send_behavior --lib
```

Expected: FAIL.

**Step 3: Add platform API submit behavior parameter**

In `src/platform/platformApi.ts`, add parameter:

```ts
export type NativeSubmitKey = "none" | "enter" | "command_enter";
```

Update:

```ts
pastePromptAndSubmitToLastTarget(body, submitKey)
pastePromptSequenceAndSubmitToLastTarget(bodies, intervalMs, submitKey)
```

**Step 4: Resolve effective submit key in App**

In `src/App.tsx`, add helper:

```ts
function effectiveSubmitKey(
  prompt: PromptContainer,
  globalMode: PromptInsertionMode
): NativeSubmitKey {
  switch (prompt.sendBehavior) {
    case "paste_only":
      return "none";
    case "paste_enter":
      return "enter";
    case "paste_command_enter":
      return "command_enter";
    case "inherit":
    default:
      return globalMode === "paste_only" ? "none" : "enter";
  }
}
```

Use `"none"` to avoid submit while still using the focus-preserving paste path.

**Step 5: Update Tauri commands**

In `src-tauri/src/lib.rs`:

- Accept `submit_key: String` or enum-deserialized value.
- Parse to `platform::macos::NativeSubmitKey`.
- Reject invalid values with a clear error or normalize to Enter only for backward compatibility.

**Step 6: Run tests**

Run:

```bash
npx vitest run src/app/App.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml send_behavior --lib
npm test
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src/App.tsx src/platform/platformApi.ts src-tauri/src/lib.rs src-tauri/src/platform/macos.rs src/app/App.test.tsx
git commit -m "feat: honor prompt send behavior during autosend"
```

---

### Task 9: Add Minimal UI for Send Behavior

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/ui/PromptManager.tsx`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/ui/PromptManager.test.tsx`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/shared/i18n.ts`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/styles.css`

**Step 1: Write failing UI tests**

Tests:

- New prompt editor shows a send behavior segmented/select control.
- Default option is inherit/global behavior.
- Editing a prompt preserves existing send behavior.
- Choosing "paste + Cmd+Enter" passes `sendBehavior: "paste_command_enter"` to update/create.

**Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run src/ui/PromptManager.test.tsx
```

Expected: FAIL.

**Step 3: Implement minimal control**

Add a compact control near existing prompt type / interval controls.

Options:

- Inherit global setting
- Paste only
- Paste + Enter
- Paste + Cmd+Enter

Keep styling consistent with existing segmented controls. Do not redesign manager UI.

**Step 4: Add i18n labels**

In `src/shared/i18n.ts`, add Chinese and English labels:

- `sendBehavior`
- `sendBehaviorInherit`
- `sendBehaviorPasteOnly`
- `sendBehaviorPasteEnter`
- `sendBehaviorPasteCommandEnter`

**Step 5: Run tests**

Run:

```bash
npx vitest run src/ui/PromptManager.test.tsx src/shared/promptStore.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/ui/PromptManager.tsx src/ui/PromptManager.test.tsx src/shared/i18n.ts src/styles.css
git commit -m "feat: configure prompt send behavior"
```

---

### Task 10: Implement L4 Copy-Only Floor Messaging

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/App.tsx`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/shared/i18n.ts`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/platform/macos.rs`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/app/App.test.tsx`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/platform/macos.rs`

**Step 1: Write failing tests for copy-only floor outcomes**

Tests:

- Guard failure before paste returns copied-not-sent.
- UI displays a clear message equivalent to "已复制，请手动粘贴".
- No "Switch to an input field first" English truncated bubble remains for this path.

**Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run src/app/App.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml copied_not_sent --lib
```

Expected: FAIL until messaging is wired.

**Step 3: Normalize outcome reasons**

Use existing `AutosendFailureReason::NoSafeTarget` if sufficient. If not sufficient, add a more precise reason such as:

```rust
TargetChangedBeforePaste
TargetChangedBeforeSubmit
```

Only add new enum values if the UI needs distinct messages.

**Step 4: Update UI messages**

Chinese:

```text
已复制，请手动粘贴
```

English:

```text
Copied. Paste manually.
```

Keep message short so the Calico bubble does not truncate badly.

**Step 5: Run tests**

Run:

```bash
npx vitest run src/app/App.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml copied_not_sent --lib
npm test
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/App.tsx src/shared/i18n.ts src-tauri/src/platform/macos.rs src/app/App.test.tsx
git commit -m "fix: report safe copy-only autosend fallback"
```

---

### Task 11: Add L3 AX Repair as a Fallback Only

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/platform/macos.rs`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/platform/macos.rs`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`

**Step 1: Write tests for AX repair isolation**

Tests:

- Main guarded path does not call AX resolver when both frontmost checks pass.
- AX resolver is called only after a frontmost mismatch/focus failure path.
- If AX resolver reports success, frontmost is checked again before paste/submit.
- If AX resolver fails, outcome is copied-not-sent.

**Step 2: Run tests to verify they fail**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml ax_repair --lib
```

Expected: FAIL.

**Step 3: Implement minimal generic AX resolver**

In `src-tauri/src/platform/macos.rs`, implement:

```rust
pub fn repair_focus_to_editable_element(pid: u32) -> Result<(), String>
```

Algorithm:

- `AXUIElementCreateApplication(pid)`.
- Get focused/main/front window.
- Check current `AXFocusedUIElement`.
- If editable, set `AXFocused=true`.
- Else recursively scan children for editable roles:
  - `AXTextArea`
  - `AXTextField`
  - `AXSearchField`
  - `AXComboBox`
- Score candidates generically:
  - currently focused editable highest;
  - visible/enabled/focusable;
  - reasonable size;
  - multiline/bottom area positive score;
  - search/address-like roles lower score.
- Set `AXFocused=true` on the best candidate.

Do not add app-specific recipes.

**Step 4: Wire AX repair only after L2 failure**

In `src-tauri/src/lib.rs`:

- If first frontmost check fails because Prompt Picker became frontmost or target is not active, attempt repair only for captured target pid.
- After repair, verify frontmost target again.
- Then use normal guarded paste/submit.
- If repair fails, copy-only floor.

**Step 5: Run tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml ax_repair --lib
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src-tauri/src/platform/macos.rs src-tauri/src/lib.rs
git commit -m "feat: add AX fallback focus repair"
```

---

### Task 12: Full Verification Before Completion

**Files:**
- No code changes expected.

**Step 1: Run focused Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Expected: PASS.

**Step 2: Run frontend tests**

Run:

```bash
npm test
```

Expected: PASS.

**Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

**Step 4: Run Tauri dev manual acceptance**

Run:

```bash
npm run tauri -- dev
```

Manual acceptance matrix:

| App | Setup | Expected |
|---|---|---|
| WeChat | Click input field, then Calico, then prompt | Prompt inserts quickly; Enter behavior follows prompt setting; no focus warning in normal path |
| Claude desktop | Click input field, then Calico, then prompt | Prompt inserts quickly; no app freeze/spinning cursor |
| Codex desktop | Normal prompt flow | Existing easy path still works |
| Notes or browser textarea | Click text field, then Calico, then prompt | Paste-only and paste+Enter behavior both match selected setting |

**Step 5: Verify no per-app branches**

Run:

```bash
rg -n "WeChat|Claude|com.tencent|anthropic|com\\.openai\\.codex|if .*bundle|match .*bundle" src-tauri/src src
```

Expected:

- No new app-specific branches for autosend.
- Existing labels/tests may mention apps only in comments/tests if unavoidable.

**Step 6: Check git diff**

Run:

```bash
git diff --stat
git status --short
```

Expected:

- Only files from this plan are changed.
- Existing unrelated dirty build artifacts remain untouched and are not staged.

**Step 7: Final commit if needed**

If verification-only changes were made:

```bash
git add <changed files>
git commit -m "test: verify focus-preserving autosend"
```

Otherwise no commit.

---

## Implementation Order and Stop Points

Implement in this order:

1. Task 1-2: L1 never-key overlays.
2. Stop and manually verify L1 in WeChat and Claude.
3. Task 3-5: strict target capture and guarded autosend.
4. Stop and manually verify single and group prompt insertion.
5. Task 6: diagnostics if needed for acceptance.
6. Task 7-10: send behavior and safe copy-only messaging.
7. Task 11: AX fallback only after main path is stable.
8. Task 12: full verification.

If L1 fails in Tauri/WKWebView after Task 2, stop before implementing deeper layers. Diagnose whether WKWebView mouse interaction requires key window. Do not proceed to AX-main-path or app-specific workarounds without a new plan.

## Out of Scope

- No app-specific recipe database.
- No Hammerspoon/BetterTouchTool integration.
- No pixel-level hit testing.
- No user-facing advanced automation settings in this pass.
- No full clipboard type preservation unless simple text restoration proves insufficient and gets a separate plan.
- No Windows implementation in this plan; Windows requires a separate focus/input model plan.

