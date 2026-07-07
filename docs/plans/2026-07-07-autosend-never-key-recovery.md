# Autosend Never-Key Recovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make autosend reliable in Codex, Claude, WeChat, and similar apps by ensuring the Calico button and prompt popover never steal keyboard focus, then falling back to a generic target-recovery path only when focus preservation fails.

**Architecture:** The main path is L1 focus preservation: create and show `prompt-button` and `prompt-popover` as hidden, non-focusable, non-activating macOS overlay windows before they are visible. Phase 0 diagnostics must first prove whether the failure is caused by show/build ordering, ineffective Tao/Wry never-key behavior, or the recovery path. Recovery remains generic and guarded: prefer a known input click point, fall back to safe target-window heuristics, and copy-only when the target cannot be proven safe.

**Tech Stack:** Tauri 2, Rust, objc2/AppKit, Tao/Wry window runtime, macOS Accessibility/System Events, React/TypeScript overlay HTML, Vitest, Cargo unit tests.

---

## Non-Negotiable Rules

- Do not restore a global legacy `activate target + Cmd+V + Enter` path.
- Do not add Codex-only, Claude-only, or WeChat-only send recipes.
- Do not paste or submit if the captured target app is not frontmost after any recovery attempt.
- Keep copy-only fallback when the target is unknown, unsafe, or changed by the user.
- Do not remove the Tao/Wry guard blindly. Commit `b27823e` added it to avoid isa-swizzling Tauri-managed windows, so any change there must be diagnostic-driven and reversible.
- Prefer Tauri's `focusable(false)` builder/runtime API before any Objective-C class replacement.
- Treat mouse position as a fallback only. A real AX input frame or already-recorded click point is more reliable than the pointer position on the Calico button.
- Keep Tauri's `is_visible()` state synchronized with the native overlay visibility. Outside-click dismissal, toggle-close, button controls, and the prompt-button watchdog all depend on `is_visible()`.
- Do not log prompt body text in diagnostics. Focus diagnostics may log app ids, window labels, click-point presence, and branch names only.

## Current Code Facts

- `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs:416` currently calls `window.show()` before `configure_non_activating_panel(&window)` in the reused popover path.
- `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs:426` builds the popover without `.visible(false)` or `.focusable(false)`, then configures the panel after `build()`.
- `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs:457` builds the prompt button without `.visible(false)` or `.focusable(false)`, then configures it after `build()`.
- `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs:508` calls `window.show()` before `configure_non_activating_panel(&window)` in the prompt button re-show path.
- `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/macos_panels.rs:86` skips never-key class replacement when the concrete class name contains `Tao` or `Wry`.
- `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/macos_panels.rs:67` already calls `orderFrontRegardless()` inside `configure_non_activating_panel`.
- `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs:539` classifies the frontmost app before paste and enters recovery when Prompt Picker is frontmost.
- `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs:303` recovers by activating the target and clicking `click_point`; when `click_point` is missing, it falls back to AX repair.
- Tauri 2 exposes `.focusable(false)` on `WebviewWindowBuilder` and `window.set_focusable(false)` on `WebviewWindow`.
- `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs:230`, `:582`, and `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs:1511` rely on `is_visible()` for popover geometry, toggle-close, outside-click behavior, and watchdog behavior.

## Execution Strategy

Execute tasks in order. Do not skip Phase 0. Task 5 is conditional: run it only if diagnostics still show the overlay can become key or still steals frontmost after Task 3 and Task 4.

---

### Task 1: Add Focus and Autosend Diagnostics

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/macos_panels.rs`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/macos_panels.rs`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`

**Step 1: Add failing tests for diagnostic helper shape**

In `src-tauri/src/macos_panels.rs`, add pure helper tests for a class-action decision function and diagnostic formatter. These tests should not require a real `NSWindow`.

```rust
#[test]
fn panel_class_action_keeps_existing_never_key_panel() {
    assert_eq!(
        panel_class_action_for_name("PromptPickerNeverKeyPanel_TaoWindow"),
        PanelClassAction::AlreadyNeverKey
    );
}

#[test]
fn panel_class_action_marks_tao_wry_as_managed_runtime() {
    assert_eq!(
        panel_class_action_for_name("TaoWindow"),
        PanelClassAction::ManagedTauriRuntime
    );
    assert_eq!(
        panel_class_action_for_name("WryWindow"),
        PanelClassAction::ManagedTauriRuntime
    );
}

#[test]
fn panel_diagnostic_format_includes_key_behavior() {
    let report = PanelKeyBehaviorReport {
        label: "prompt-popover".to_string(),
        class_name: "TaoWindow".to_string(),
        action: PanelClassAction::ManagedTauriRuntime,
        can_become_key: Some(true),
        can_become_main: Some(true),
    };

    let formatted = format_panel_key_behavior_report(&report);

    assert!(formatted.contains("prompt-popover"));
    assert!(formatted.contains("TaoWindow"));
    assert!(formatted.contains("can_become_key=true"));
    assert!(formatted.contains("can_become_main=true"));
}
```

In `src-tauri/src/lib.rs`, add source-level or pure helper tests that require autosend diagnostics to include:

- target bundle id;
- whether `click_point` exists;
- frontmost bundle id before paste;
- classification result;
- final branch.

Use a helper such as:

```rust
#[test]
fn autosend_diagnostic_line_includes_classification_and_click_point_state() {
    let line = autosend_diagnostic_line(
        "before-paste",
        Some("com.openai.codex"),
        true,
        Some("local.promptpicker.dev"),
        Some(TargetFrontmostStatus::PromptPicker),
    );

    assert!(line.contains("before-paste"));
    assert!(line.contains("target=com.openai.codex"));
    assert!(line.contains("has_click_point=true"));
    assert!(line.contains("frontmost=local.promptpicker.dev"));
    assert!(line.contains("classification=PromptPicker"));
}
```

**Step 2: Run focused tests and verify failure**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
cargo test --manifest-path src-tauri/Cargo.toml panel_class_action --lib
cargo test --manifest-path src-tauri/Cargo.toml autosend_diagnostic --lib
```

Expected: FAIL because the diagnostic helpers do not exist yet.

**Step 3: Implement minimal diagnostic helpers**

In `src-tauri/src/macos_panels.rs`, add:

```rust
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PanelClassAction {
    AlreadyNeverKey,
    ManagedTauriRuntime,
    ApplyNeverKeySubclass,
}

fn panel_class_action_for_name(class_name: &str) -> PanelClassAction {
    if class_name.contains("PromptPickerNeverKeyPanel") {
        PanelClassAction::AlreadyNeverKey
    } else if class_name.contains("Tao") || class_name.contains("Wry") {
        PanelClassAction::ManagedTauriRuntime
    } else {
        PanelClassAction::ApplyNeverKeySubclass
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct PanelKeyBehaviorReport {
    label: String,
    class_name: String,
    action: PanelClassAction,
    can_become_key: Option<bool>,
    can_become_main: Option<bool>,
}
```

Add `format_panel_key_behavior_report(&PanelKeyBehaviorReport) -> String`.

Add a macOS-only native behavior reporter inside `configure_non_activating_panel`. It should query the real `NSWindow` with Objective-C messages:

```rust
let can_become_key: Bool = objc2::msg_send![ns_window, canBecomeKeyWindow];
let can_become_main: Bool = objc2::msg_send![ns_window, canBecomeMainWindow];
```

Log the formatted line only when diagnostics are enabled:

```rust
fn focus_diagnostics_enabled() -> bool {
    std::env::var("PROMPT_PICKER_FOCUS_DIAGNOSTICS").is_ok()
}
```

Use `eprintln!` for now; do not add a logging dependency.

In `src-tauri/src/lib.rs`, add a small diagnostic formatter and call it inside `guarded_focus_preserving_autosend_with_senders` at:

- entry before classification;
- PromptPicker recovery branch;
- recovery failed;
- post-recovery mismatch;
- OtherOrUnknown;
- sent.

Gate it behind the same environment variable.

Diagnostic lines must not include `body` or any prompt text. Tests should assert the formatter has no body argument and only reports metadata such as target bundle id, frontmost bundle id, click-point presence, classification, and outcome branch.

**Step 4: Run focused tests and verify pass**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
cargo test --manifest-path src-tauri/Cargo.toml panel_class_action --lib
cargo test --manifest-path src-tauri/Cargo.toml autosend_diagnostic --lib
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src-tauri/src/macos_panels.rs src-tauri/src/lib.rs
git commit -m "chore: add autosend focus diagnostics"
```

---

### Task 2: Capture Phase 0 Diagnostic Evidence

**Files:**
- No source files expected after Task 1.
- Create if useful: `/Users/yang/Desktop/GitHub-pre/prompt-picker/docs/qa/2026-07-07-autosend-never-key-recovery-diagnostics.md`

**Step 1: Build and run with focus diagnostics enabled**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
PROMPT_PICKER_FOCUS_DIAGNOSTICS=1 npm run tauri -- dev
```

Expected: app starts and prints diagnostic lines when the button/popover are shown and when autosend runs.

**Step 2: Exercise the three target apps**

Manual matrix:

```text
Codex: click input -> click Calico -> open prompt list -> select prompt
Claude: click input -> click Calico -> open prompt list -> select prompt
WeChat: click input -> click Calico -> open prompt list -> select prompt
```

Record for each app:

- `can_become_key` for `prompt-button`;
- `can_become_key` for `prompt-popover`;
- frontmost before paste;
- classification result;
- whether recovery was used;
- final outcome.

**Step 3: Interpret the evidence**

Use this decision table:

| Evidence | Meaning | Next action |
|---|---|---|
| `can_become_key=false` and classification is mostly `Target` | L1 likely works; failures are recovery edge cases | Continue to Task 6 only |
| `can_become_key=false` but classification is often `PromptPicker` | show/build ordering or runtime focusability still leaks | Continue to Task 3 and Task 4 |
| `can_become_key=true` for Tao/Wry overlays | never-key behavior is not effective | Continue to Task 3, Task 4, then likely Task 5 |
| `OtherOrUnknown` after user switches apps | safety guard is working | Keep copy-only fallback |

**Step 4: Save a QA note if the evidence is non-obvious**

If diagnostics show conflicting behavior, create:

```bash
docs/qa/2026-07-07-autosend-never-key-recovery-diagnostics.md
```

Include the diagnostic snippets and the decision from Step 3.

**Step 5: Commit the QA note only if created**

```bash
git add docs/qa/2026-07-07-autosend-never-key-recovery-diagnostics.md
git commit -m "docs: record autosend focus diagnostics"
```

---

### Task 3: Fix Overlay Show and Build Ordering

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs`

**Step 1: Add failing source-level ordering tests**

In `src-tauri/src/windows.rs`, add tests that verify:

- popover builders use `.visible(false)` and `.focusable(false)`;
- prompt button builder uses `.visible(false)` and `.focusable(false)`;
- reused popover path does not call `window.show()` before `configure_non_activating_panel(&window)`;
- prompt button re-show path configures before any runtime `show()`.
- all overlay display paths go through one helper such as `show_non_activating_overlay_window`;
- the helper enforces the postcondition that Tauri `window.is_visible()` is true after showing, because other code depends on it.

Example:

```rust
#[test]
fn popover_builder_creates_hidden_non_focusable_window_before_panel_configuration() {
    let source = include_str!("windows.rs");
    let start = source
        .find("let window = WebviewWindowBuilder::new(app, POPOVER_WINDOW_LABEL")
        .expect("popover builder should exist");
    let end = source[start..]
        .find("set_popover_mode(Some(mode));")
        .expect("popover builder block should set mode");
    let block = &source[start..start + end];

    assert!(block.contains(".visible(false)"));
    assert!(block.contains(".focusable(false)"));
    assert!(block.contains("configure_non_activating_panel(&window)?"));
}

#[test]
fn reused_popover_configures_panel_before_any_show_call() {
    let source = include_str!("windows.rs");
    let start = source
        .find("if should_reuse_popover")
        .expect("reused popover branch should exist");
    let end = source[start..]
        .find("return Ok(());")
        .expect("reused popover branch should return");
    let block = &source[start..start + end];

    let configure_index = block
        .find("configure_non_activating_panel(&window)?")
        .expect("reused popover should configure panel");
    if let Some(show_index) = block.find("window.show()") {
        assert!(configure_index < show_index);
    }
}

#[test]
fn overlay_visibility_uses_single_non_activating_show_helper() {
    let source = include_str!("windows.rs");

    assert!(source.contains("fn show_non_activating_overlay_window"));
    assert!(source.contains("window.set_focusable(false)"));
    assert!(source.contains("configure_non_activating_panel"));
    assert!(source.contains("window.is_visible().unwrap_or(false)"));
}
```

**Step 2: Run focused tests and verify failure**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
cargo test --manifest-path src-tauri/Cargo.toml windows --lib
```

Expected: FAIL because the builders are visible/focusable by default and reuse paths call `show()` too early.

**Step 3: Implement hidden, non-focusable overlay construction**

Update the popover builder:

```rust
let window = WebviewWindowBuilder::new(app, POPOVER_WINDOW_LABEL, WebviewUrl::App(url.into()))
    .title("Prompt Picker")
    .inner_size(popover_size.width, popover_size.height)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .accept_first_mouse(true)
    .skip_taskbar(true)
    .focusable(false)
    .visible(false)
    .position(window_x, window_y)
    .build()
    .map_err(|e| e.to_string())?;
```

Update the prompt button builder similarly:

```rust
.focusable(false)
.visible(false)
```

After build, call transparency setup first if needed, then route the display through a single helper. Because `configure_non_activating_panel` calls `orderFrontRegardless`, the helper must configure the native panel before any Tauri `show()` call.

Add a helper in `src-tauri/src/windows.rs`:

```rust
fn show_non_activating_overlay_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    window.set_focusable(false).map_err(|e| e.to_string())?;
    crate::macos_panels::configure_non_activating_panel(window)?;

    if !window.is_visible().unwrap_or(false) {
        window.show().map_err(|e| e.to_string())?;
        window.set_focusable(false).map_err(|e| e.to_string())?;
        crate::macos_panels::configure_non_activating_panel(window)?;
    }

    if !window.is_visible().unwrap_or(false) {
        return Err("Overlay window did not become visible.".to_string());
    }

    Ok(())
}
```

This helper is intentionally conservative: if native `orderFrontRegardless()` updates Tauri visibility, it does not call `window.show()`. If Tauri still reports hidden, it calls `show()` only after the non-activating/focusable configuration is already applied, then re-applies the configuration.

**Step 4: Fix reused popover and button re-show order**

Replace this ordering:

```rust
window.show().map_err(|e| e.to_string())?;
crate::macos_panels::configure_non_activating_panel(&window)?;
```

with:

```rust
show_non_activating_overlay_window(&window)?;
```

Do this for:

- reused popover path;
- prompt button re-show path.

Do not call `window.show()` directly from reused popover or button re-show branches. Let `show_non_activating_overlay_window` own that decision so the ordering and `is_visible()` postcondition stay consistent.

**Step 5: Add visibility regression tests**

Add source-level tests that protect current behaviors depending on `is_visible()`:

```rust
#[test]
fn popover_toggle_still_uses_visible_state_to_close_open_prompt_list() {
    let source = include_str!("windows.rs");
    let start = source
        .find("pub fn toggle_prompt_popover_from_button")
        .expect("toggle command should exist");
    let end = source[start..]
        .find("pub fn show_prompt_button_controls_from_button")
        .expect("button controls command should follow toggle command");
    let block = &source[start..start + end];

    assert!(block.contains("window.is_visible().unwrap_or(false)"));
    assert!(block.contains("should_close_prompt_popover_on_toggle"));
    assert!(block.contains("window.hide().map_err"));
}

#[test]
fn outside_click_and_watchdog_paths_keep_using_visible_state() {
    let source = include_str!("windows.rs");

    assert!(source.contains("fn handle_prompt_popover_outside_click"));
    assert!(source.contains("popover_window.is_visible().unwrap_or(false)"));
    assert!(source.contains("window_rect(&app, POPOVER_WINDOW_LABEL)"));
}
```

Also ensure existing tests around `hide_prompt_popover`, `reuses_popover_only_for_the_same_mode`, and `prompt_button_watchdog_does_not_rebuild_while_popover_is_visible` still pass.

**Step 6: Run tests**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
cargo test --manifest-path src-tauri/Cargo.toml windows --lib
cargo test --manifest-path src-tauri/Cargo.toml macos_panels --lib
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src-tauri/src/windows.rs
git commit -m "fix: show prompt overlays without taking focus"
```

---

### Task 4: Re-Run Diagnostics After Show Ordering Fix

**Files:**
- No source files expected.
- Modify if already created: `/Users/yang/Desktop/GitHub-pre/prompt-picker/docs/qa/2026-07-07-autosend-never-key-recovery-diagnostics.md`

**Step 1: Run the diagnostic app again**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
PROMPT_PICKER_FOCUS_DIAGNOSTICS=1 npm run tauri -- dev
```

**Step 2: Repeat the target app matrix**

Use the same matrix from Task 2.

Expected best case:

```text
can_become_key=false or runtime focusable=false
classification=Target
recovery_used=false
sent=true
```

**Step 3: Decide whether Task 5 is needed**

Skip Task 5 if:

- Codex, Claude, and WeChat classify as `Target` in normal use;
- no overlay becomes frontmost in diagnostics;
- autosend succeeds.

Run Task 5 if:

- `can_become_key=true` remains for prompt overlays;
- Prompt Picker still becomes frontmost during normal prompt selection;
- autosend still enters recovery because the overlay stole focus.

**Step 4: Commit updated QA evidence if changed**

```bash
git add docs/qa/2026-07-07-autosend-never-key-recovery-diagnostics.md
git commit -m "docs: update autosend focus diagnostics"
```

Skip this commit if no QA file was created or modified.

---

### Task 5: Conditionally Tighten Tao/Wry Never-Key Behavior

**Run this task only if Task 4 proves overlays still steal focus or can become key.**

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/macos_panels.rs`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/macos_panels.rs`

**Step 1: Add failing tests for controlled guard behavior**

Add tests that require Tao/Wry behavior to be explicit and not silently skipped:

```rust
#[test]
fn managed_tauri_runtime_requires_explicit_fallback_or_subclass_strategy() {
    let source = include_str!("macos_panels.rs");

    assert!(source.contains("PanelClassAction::ManagedTauriRuntime"));
    assert!(source.contains("set_focusable(false)") || source.contains("apply_never_key_panel_class"));
    assert!(source.contains("canBecomeKeyWindow"));
}
```

If implementing a controlled subclass attempt, add tests for source markers:

```rust
#[test]
fn controlled_tao_wry_subclass_path_is_labeled_and_reversible() {
    let source = include_str!("macos_panels.rs");

    assert!(source.contains("PROMPT_PICKER_ALLOW_TAO_NEVER_KEY_SUBCLASS"));
    assert!(source.contains("ManagedTauriRuntime"));
    assert!(source.contains("Unexpected window class changed"));
}
```

**Step 2: Run focused tests and verify failure**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
cargo test --manifest-path src-tauri/Cargo.toml macos_panels --lib
```

Expected: FAIL until the managed-runtime branch is explicit.

**Step 3: Prefer runtime focusability before class replacement**

Keep `window.set_focusable(false)` in `src-tauri/src/windows.rs` from Task 3. In `macos_panels.rs`, keep the managed-runtime action visible in the diagnostic report.

If diagnostics show `set_focusable(false)` plus `NonactivatingPanel` still fails, add a narrowly gated controlled subclass path:

```rust
fn allow_tao_never_key_subclass() -> bool {
    std::env::var("PROMPT_PICKER_ALLOW_TAO_NEVER_KEY_SUBCLASS").is_ok()
}
```

Then only attempt class replacement for `PanelClassAction::ManagedTauriRuntime` when this env flag is set during diagnosis. Do not ship this as the default unless manual diagnostics show it is stable.

**Step 4: If the gated subclass path is stable, make it the default for overlay-only configuration**

Only after a successful diagnostic run:

- remove the need for `PROMPT_PICKER_ALLOW_TAO_NEVER_KEY_SUBCLASS`;
- keep the action explicit in code;
- keep the post-config behavior report;
- do not call this code from `activate_main_window`.

If it crashes or destabilizes window operations, do not proceed with class replacement. Use the fallback in Step 5.

**Step 5: Fallback if Tao/Wry class replacement is unsafe**

If controlled subclassing is unsafe, implement this narrower fallback:

- after `configure_non_activating_panel`, call `set_focusable(false)` and `orderFrontRegardless`;
- never call `makeKeyAndOrderFront`;
- if diagnostics show Prompt Picker became frontmost before paste, immediately recover the captured target using the generic recovery path from Task 6.

Document in the QA note that this is a fallback and that native `NSPanel` replacement would be the next architectural step if it remains flaky.

**Step 6: Run focused verification**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
cargo test --manifest-path src-tauri/Cargo.toml macos_panels --lib
cargo test --manifest-path src-tauri/Cargo.toml windows --lib
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src-tauri/src/macos_panels.rs src-tauri/src/windows.rs
git commit -m "fix: prevent prompt overlays from becoming key windows"
```

Only include `src-tauri/src/windows.rs` if it changed during this task.

---

### Task 6: Generalize Recovery Click Point Selection

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/platform/macos.rs`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/platform/unsupported.rs`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/platform/macos.rs`

**Step 1: Add failing tests for recovery click point priority**

In `src-tauri/src/lib.rs`, add pure tests for a helper such as `choose_recovery_click_point`:

```rust
#[test]
fn recovery_click_point_prefers_recorded_input_point_over_pointer_fallback() {
    let target = PromptPickSessionTarget {
        app: FrontmostApp {
            name: "Claude".to_string(),
            bundle_id: "com.anthropic.claudefordesktop".to_string(),
        },
        pid: Some(42),
        observed_at_ms: now_ms(),
        click_point: Some(TargetClickPoint { x: 400.0, y: 700.0 }),
    };
    let pointer = Some(TargetClickPoint { x: 100.0, y: 100.0 });

    assert_eq!(
        choose_recovery_click_point(&target, pointer, None),
        Some(TargetClickPoint { x: 400.0, y: 700.0 })
    );
}

#[test]
fn recovery_click_point_uses_pointer_only_when_inside_target_window() {
    let target = prompt_target_without_click_point("WeChat", "com.tencent.xinWeChat");
    let window = CandidateInput {
        x: 100.0,
        y: 100.0,
        width: 800.0,
        height: 600.0,
    };

    assert_eq!(
        choose_recovery_click_point(
            &target,
            Some(TargetClickPoint { x: 200.0, y: 300.0 }),
            Some(window)
        ),
        Some(TargetClickPoint { x: 200.0, y: 300.0 })
    );

    assert_ne!(
        choose_recovery_click_point(
            &target,
            Some(TargetClickPoint { x: 10.0, y: 10.0 }),
            Some(window)
        ),
        Some(TargetClickPoint { x: 10.0, y: 10.0 })
    );
}
```

Adapt helper names to existing test utilities. If `CandidateInput` is not convenient in `lib.rs`, introduce a small local `TargetWindowFrame` struct for recovery decisions.

**Step 2: Add failing tests for generic bottom-input fallback**

In `src-tauri/src/platform/macos.rs`, add or update tests:

```rust
#[test]
fn generic_fallback_click_point_uses_bottom_center_for_non_codex_apps() {
    let point = fallback_click_point_for_app(
        &FrontmostApp {
            name: "WeChat".to_string(),
            bundle_id: "com.tencent.xinWeChat".to_string(),
        },
        &CandidateInput {
            x: 100.0,
            y: 200.0,
            width: 800.0,
            height: 600.0,
        },
    );

    assert_eq!(point.x, 500.0);
    assert_eq!(point.y, 735.0);
}
```

Expected `y` should match the chosen bottom-input offset formula. Use the same formula for all apps; do not keep a Codex-only branch.

**Step 3: Run focused tests and verify failure**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
cargo test --manifest-path src-tauri/Cargo.toml recovery_click_point --lib
cargo test --manifest-path src-tauri/Cargo.toml fallback_click_point --lib
```

Expected: FAIL because non-Codex fallback currently uses window center and there is no pointer fallback selection helper.

**Step 4: Implement generic fallback click point**

In `src-tauri/src/platform/macos.rs`, change `fallback_click_point_for_app` so all apps use the same bottom-input heuristic:

```rust
TargetClickPoint {
    x: window_frame.x + (window_frame.width / 2.0),
    y: window_frame.y + window_frame.height - 65.0,
}
```

Clamp the result inside the window frame if needed.

Remove Codex-specific branching from this function.

**Step 5: Add current pointer capture as a fallback source**

Add a macOS helper that returns the current pointer in the same coordinate system used by `TargetClickPoint`.

Use existing AppKit primitives already imported in `windows.rs` as a reference:

- `NSEvent::mouseLocation()`;
- screen bounds conversion from bottom-left to top-left coordinates.

Expose it through `platform::macos` as something like:

```rust
pub fn current_pointer_location() -> Option<TargetClickPoint>
```

Add an unsupported-platform stub returning `None`.

**Step 6: Store pointer fallback during prompt target capture**

Extend `PromptPickSessionTarget` only if needed. Preferred minimal approach:

- keep `click_point` as the single recovery point;
- when `record_last_input_target_if_valid` has a real input click point, keep it;
- when no real click point exists, use pointer fallback only if it is inside the captured target window frame;
- otherwise use generic bottom-input fallback from `fallback_click_point_for_app`.

Do not let pointer fallback override an AX-derived input frame.

Final priority:

```text
AX input frame click point
  -> existing recorded input click_point
  -> pointer position if inside target window
  -> generic bottom-input fallback
  -> None, then AX repair as last resort
```

**Step 7: Keep AX repair as last resort**

Do not delete `repair_focus_to_editable_element`. Keep `recover_target_for_autosend` semantics:

- if `target.click_point` exists, activate and click;
- if `target.click_point` is missing, try AX repair;
- if AX repair fails, copy-only.

The goal is to make `click_point` available more often, not to remove AX completely.

**Step 8: Run focused tests**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
cargo test --manifest-path src-tauri/Cargo.toml recovery_click_point --lib
cargo test --manifest-path src-tauri/Cargo.toml fallback_click_point --lib
cargo test --manifest-path src-tauri/Cargo.toml last_input_target --lib
```

Expected: PASS.

**Step 9: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/platform/macos.rs src-tauri/src/platform/unsupported.rs
git commit -m "fix: generalize autosend recovery click points"
```

---

### Task 7: Preserve Safety Guards and Add Regression Tests

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`

**Step 1: Add or strengthen tests for unsafe target changes**

Add tests proving:

- if a third-party app is frontmost before paste, autosend does not recover and does not paste;
- if Prompt Picker is frontmost and recovery restores the target, autosend proceeds;
- if Prompt Picker is frontmost and recovery does not restore the target, autosend copy-onlys;
- if the target changes after paste and before submit, submit is skipped.

Example:

```rust
#[test]
fn autosend_keeps_copy_only_when_user_switched_to_another_app() {
    let target = PromptPickSessionTarget {
        app: FrontmostApp {
            name: "Codex".to_string(),
            bundle_id: "com.openai.codex".to_string(),
        },
        pid: Some(42),
        observed_at_ms: now_ms(),
        click_point: Some(TargetClickPoint { x: 640.0, y: 720.0 }),
    };

    let outcome = guarded_focus_preserving_autosend_with_senders(
        "hello",
        &target,
        platform::macos::NativeSubmitKey::Enter,
        |_| Ok(()),
        || Some(frontmost_target("Notes", "com.apple.Notes", Some(9))),
        |_| panic!("must not recover when a different user app is frontmost"),
        || panic!("must not paste into the wrong app"),
        |_| panic!("must not submit into the wrong app"),
        |_| {},
    );

    assert_eq!(outcome.reason, Some(AutosendFailureReason::NoSafeTarget));
    assert!(outcome.copied);
    assert!(!outcome.sent);
}
```

**Step 2: Run focused tests**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
cargo test --manifest-path src-tauri/Cargo.toml autosend --lib
```

Expected: PASS after any needed test updates.

**Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "test: guard autosend recovery safety"
```

---

### Task 8: Replace Weak Panel Tests With Behavior-Oriented Guards

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/macos_panels.rs`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/macos_panels.rs`

**Step 1: Replace source-string-only tests where possible**

Current tests that only assert the source contains `canBecomeKeyWindow` are too weak. Keep source-level checks only for compile-time markers and add behavior-oriented helper tests around:

- `panel_class_action_for_name`;
- diagnostic formatting;
- presence of `focusable(false)` at the window construction layer, covered in `windows.rs`;
- `PanelKeyBehaviorReport` requiring real `can_become_key` and `can_become_main` values when diagnostics run.

**Step 2: Add an ignored macOS runtime diagnostic test if practical**

If the test harness can create a Tauri test window safely, add:

```rust
#[test]
#[ignore = "requires a live macOS window"]
fn configured_prompt_panel_reports_never_key_behavior() {
    // Create or receive a live prompt overlay window, configure it,
    // then assert canBecomeKeyWindow == false and canBecomeMainWindow == false.
}
```

If a live window test is not practical, do not fake it. Keep this as a QA requirement in Task 9.

**Step 3: Run focused tests**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
cargo test --manifest-path src-tauri/Cargo.toml macos_panels --lib
```

Expected: PASS.

**Step 4: Commit**

```bash
git add src-tauri/src/macos_panels.rs
git commit -m "test: document prompt panel key behavior"
```

---

### Task 9: Full Verification

**Files:**
- Create or modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/docs/qa/2026-07-07-autosend-never-key-recovery.md`

**Step 1: Run Rust tests**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Expected: PASS.

**Step 2: Run frontend tests**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
npm test
```

Expected: PASS.

**Step 3: Run production build**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
npm run build
```

Expected: PASS.

**Step 4: Run diagnostic manual matrix**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
PROMPT_PICKER_FOCUS_DIAGNOSTICS=1 npm run tauri -- dev
```

Manual expected results:

| App | Expected normal path |
|---|---|
| Codex | Select prompt -> paste and submit; classification should be `Target`; recovery should not run |
| Claude | Select prompt -> paste and submit; classification should be `Target`; recovery should not run |
| WeChat | Select prompt -> paste and submit; classification should be `Target`; recovery should not run |
| Notes or browser textarea | Select prompt -> paste and submit when focused; no app-specific branch |
| User switches app after opening popover | No paste/submit into wrong app; copy-only fallback |

**Step 5: Run overlay visibility and dismissal regression matrix**

Verify the UI behaviors that rely on Tauri `is_visible()`:

| Scenario | Expected result |
|---|---|
| Click Calico once | Prompt list opens and is visible |
| Click Calico again while prompt list is open | Prompt list closes and emits dismissal |
| Click outside the transparent rounded prompt list | Prompt list closes |
| Right-click / ctrl-click Calico | `Close pet` button-controls popover opens without stealing target focus |
| Click `Close pet` | Floating button hides and saved visibility updates |
| Leave the app running for at least one watchdog interval with prompt list hidden | Button is not rebuilt unnecessarily |
| Leave the prompt list open for one watchdog interval | Button is not rebuilt while popover is visible |

If any scenario fails, fix the visibility synchronization before continuing. Do not accept a version where autosend works but popover close, right-click controls, or watchdog behavior regresses.

**Step 6: Record QA status honestly**

Create:

```bash
docs/qa/2026-07-07-autosend-never-key-recovery.md
```

Include:

- automated command results;
- diagnostic summary;
- manual matrix result for each app;
- overlay visibility and dismissal matrix result;
- any remaining pending user/device confirmation.

Do not mark a manual app scenario as passed unless it was actually tested.

**Step 7: Check for accidental app-specific recipes**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
rg -n "com\\.openai\\.codex|Codex|Claude|WeChat|xinWeChat" src-tauri/src src
```

Expected:

- No new app-specific send/recovery branch.
- Existing historical tests or safe app identity fixtures are acceptable if they are not dispatch recipes.
- `fallback_click_point_for_app` should no longer contain a Codex-specific branch.

**Step 8: Check git diff**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
git diff --check
git status --short
```

Expected:

- `git diff --check` has no output.
- Status includes only intended source, test, and QA plan changes. Ignore pre-existing build artifacts only if they were already dirty before this work.

**Step 9: Commit QA record**

```bash
git add docs/qa/2026-07-07-autosend-never-key-recovery.md
git commit -m "docs: record autosend never-key recovery QA"
```

---

### Task 10: Final Source Review Before Push

**Files:**
- No source changes expected.

**Step 1: Review commits**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
git log --oneline --decorate -10
git diff --stat origin/main..HEAD
```

Expected:

- Commits are scoped to diagnostics, overlay focus ordering, conditional never-key behavior, recovery click points, tests, and QA docs.
- No unrelated build artifacts are included.

**Step 2: Verify no legacy global activation route was reintroduced**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
rg -n "paste_prompt_to_app|paste_prompt_to_last_target|pastePromptToApp|pastePromptToLastTarget|paste_to_app_script" src src-tauri/src
```

Expected: no live source matches for removed legacy routes.

**Step 3: Push only after user approval or execution instruction**

When this plan is executed under a user request that includes pushing:

```bash
git push origin main
```

Expected: push succeeds.

Do not push during planning.
