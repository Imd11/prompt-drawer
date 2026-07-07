# Autosend Never-Key Review Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the review gaps in the autosend never-key recovery work by making the pointer fallback reliable outside the AppKit main thread and by completing the required diagnostic/manual QA gate.

**Architecture:** Keep the current L1-first design: prompt overlays should stay hidden, non-focusable, and non-activating before display, and autosend should use recovery only as a guarded fallback. This fix does not add app-specific send recipes or restore legacy activating paste. It makes pointer capture thread-safe via CoreGraphics, keeps coordinates in the same global screen coordinate space used by target windows, and records real diagnostic evidence before deciding whether the conditional Tao/Wry Task 5 is needed.

**Tech Stack:** Tauri 2, Rust, core-graphics, objc2/AppKit, macOS Accessibility/System Events, Cargo unit tests, Vitest, manual Codex/Claude/WeChat QA.

---

## Non-Negotiable Rules

- Do not restore `activate target + Cmd+V + Enter` as the main path.
- Do not add Codex-only, Claude-only, or WeChat-only production logic.
- Do not remove the Tao/Wry guard unless the diagnostic matrix proves overlays still become key/frontmost after the show-ordering fix.
- Do not log prompt body text in diagnostics.
- Do not claim manual verification passed unless the diagnostic matrix was actually run.
- Keep copy-only fallback when the target is unknown, unsafe, changed, or not restored.
- Keep pointer coordinates in the same coordinate space as `CandidateInput.window_frame`; do not add a main-display offset conversion unless diagnostics prove it is needed.
- Keep changes scoped to the two review findings:
  - pointer fallback currently depends on `MainThreadMarker`;
  - QA lacks the required diagnostic/manual gate evidence.

---

## Current Review Findings To Fix

1. `docs/qa/2026-07-07-autosend-never-key-recovery.md:48` says Codex, Claude, WeChat, and focus-break safety are still unverified, while `docs/plans/2026-07-07-autosend-never-key-recovery.md:40` says Phase 0 must not be skipped and `:523` says Task 5 can be skipped only with diagnostic evidence.
2. `src-tauri/src/lib.rs:116` records prompt-session targets inside `spawn_blocking`, but `src-tauri/src/platform/macos.rs:324` uses `MainThreadMarker::new()?`. In that path, pointer fallback may return `None`, leaving recovery to use only recent click points or bottom-window fallback.

---

### Task 1: Replace AppKit Pointer Capture With CoreGraphics

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/Cargo.toml`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/platform/macos.rs`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/platform/macos.rs`

**Step 1: Add a failing source-level regression test**

Add tests in `src-tauri/src/platform/macos.rs` that reject the old AppKit main-thread dependency, require CoreGraphics pointer capture, and lock the coordinate conversion to a no-shift global screen coordinate.

```rust
#[test]
fn pointer_location_does_not_depend_on_appkit_main_thread_marker() {
    let production_source = include_str!("macos.rs")
        .split("#[cfg(test)]")
        .next()
        .expect("production source should precede tests");

    assert!(!production_source.contains("MainThreadMarker::new()?"));
    assert!(production_source.contains("CGEvent::new"));
    assert!(!production_source.contains("NSEvent::mouseLocation"));
}

#[test]
fn quartz_pointer_location_uses_global_screen_coordinates_without_main_display_shift() {
    assert_eq!(
        pointer_location_from_quartz_point(120.0, 140.0),
        (120.0, 140.0)
    );
}
```

**Step 2: Run the focused test and verify it fails**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
cargo test --manifest-path src-tauri/Cargo.toml pointer_location_does_not_depend_on_appkit_main_thread_marker --lib
cargo test --manifest-path src-tauri/Cargo.toml quartz_pointer_location_uses_global_screen_coordinates_without_main_display_shift --lib
```

Expected: FAIL because `current_pointer_location()` still uses `MainThreadMarker::new()?` and `pointer_location_from_quartz_point` does not exist yet.

**Step 3: Add the explicit dependency**

In `src-tauri/Cargo.toml`, add a direct dependency using the version already present in `Cargo.lock`:

```toml
core-graphics = "0.25.0"
```

Do not remove `objc2` or `objc2-app-kit`; other macOS panel code still uses them.

**Step 4: Replace pointer capture implementation**

In `src-tauri/src/platform/macos.rs`, remove these imports if they become unused:

```rust
use objc2::MainThreadMarker;
use objc2_app_kit::{NSEvent, NSScreen};
```

Add:

```rust
use core_graphics::event::CGEvent;
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
```

Add a small pure helper above `current_pointer_location()`:

```rust
fn pointer_location_from_quartz_point(x: f64, y: f64) -> (f64, f64) {
    (x, y)
}
```

Replace `current_pointer_location()` with:

```rust
pub fn current_pointer_location() -> Option<(f64, f64)> {
    let source =
        CGEventSource::new(CGEventSourceStateID::CombinedSessionState).ok()?;
    let event = CGEvent::new(source).ok()?;
    let point = event.location();

    Some(pointer_location_from_quartz_point(point.x, point.y))
}
```

Rationale: `CandidateInput.window_frame`, click scripts, and CoreGraphics event locations are all consumed as global screen coordinates. The previous AppKit path converted from Cocoa's bottom-left mouse coordinates; the CoreGraphics path should not repeat that conversion. A display-origin adjustment can shift points away from the target window on multi-display setups, so do not add one without diagnostic evidence.

**Step 5: Run the focused test and compile-check**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
cargo test --manifest-path src-tauri/Cargo.toml pointer_location_does_not_depend_on_appkit_main_thread_marker --lib
cargo test --manifest-path src-tauri/Cargo.toml quartz_pointer_location_uses_global_screen_coordinates_without_main_display_shift --lib
cargo test --manifest-path src-tauri/Cargo.toml recovery_click_point --lib
cargo test --manifest-path src-tauri/Cargo.toml last_input_target --lib
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/platform/macos.rs
git commit -m "fix: capture pointer location without appkit main thread"
```

---

### Task 2: Strengthen Pointer Fallback Behavior Tests

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`

**Step 1: Add a focused unit test for pointer fallback when no recent input point exists**

In `src-tauri/src/lib.rs`, add a pure test near the existing `recovery_click_point_*` tests:

```rust
#[test]
fn recovery_click_point_uses_pointer_before_generic_fallback() {
    let pointer = Some(TargetClickPoint { x: 120.0, y: 140.0 });
    let fallback = Some(TargetClickPoint { x: 500.0, y: 735.0 });
    let window = CandidateInput {
        x: 100.0,
        y: 100.0,
        width: 600.0,
        height: 500.0,
    };

    assert_eq!(
        choose_recovery_click_point(None, pointer, Some(&window), fallback),
        pointer
    );
}
```

**Step 2: Add a regression test proving recorded points still win**

Use the existing test if present. If not present, add:

```rust
#[test]
fn recovery_click_point_keeps_recorded_point_above_pointer() {
    let recorded = Some(TargetClickPoint { x: 400.0, y: 700.0 });
    let pointer = Some(TargetClickPoint { x: 120.0, y: 140.0 });
    let fallback = Some(TargetClickPoint { x: 500.0, y: 735.0 });
    let window = CandidateInput {
        x: 100.0,
        y: 100.0,
        width: 600.0,
        height: 500.0,
    };

    assert_eq!(
        choose_recovery_click_point(recorded, pointer, Some(&window), fallback),
        recorded
    );
}
```

**Step 3: Run focused tests**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
cargo test --manifest-path src-tauri/Cargo.toml recovery_click_point --lib
```

Expected: PASS.

**Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "test: cover autosend pointer recovery priority"
```

---

### Task 3: Run Required Diagnostic Matrix

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/docs/qa/2026-07-07-autosend-never-key-recovery.md`

**Step 1: Start the app with diagnostics enabled**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
PROMPT_PICKER_FOCUS_DIAGNOSTICS=1 npm run tauri -- dev
```

Expected: the app starts and prints `prompt-picker-panel ...` and `prompt-picker-autosend ...` diagnostics when overlays/autosend run.

**Step 2: Exercise normal autosend in Codex**

Manual steps:

```text
1. Focus the Codex input.
2. Click the Calico pet.
3. Select one prompt.
4. Observe whether the prompt is pasted/submitted.
5. Copy diagnostic lines for prompt-button, prompt-popover, and autosend.
```

Record:

```text
App: Codex
prompt-button can_become_key:
prompt-popover can_become_key:
frontmost before paste:
classification:
recovery used:
outcome:
notes:
```

**Step 3: Exercise normal autosend in Claude**

Use the same steps and record the same fields:

```text
App: Claude
prompt-button can_become_key:
prompt-popover can_become_key:
frontmost before paste:
classification:
recovery used:
outcome:
notes:
```

**Step 4: Exercise normal autosend in WeChat**

Use the same steps and record:

```text
App: WeChat
prompt-button can_become_key:
prompt-popover can_become_key:
frontmost before paste:
classification:
recovery used:
outcome:
notes:
```

**Step 5: Exercise focus-break safety**

Manual steps:

```text
1. Focus a safe target app input.
2. Click the Calico pet.
3. Before selecting a prompt, switch to a different app.
4. Select a prompt.
5. Confirm Prompt Picker copies only and does not submit to the wrong app.
```

Record:

```text
Scenario: Focus break safety
frontmost before paste:
classification:
outcome:
wrong-app send occurred: yes/no
notes:
```

**Step 6: Update QA document with actual results**

In `docs/qa/2026-07-07-autosend-never-key-recovery.md`, replace the current “Manual Verification Still Needed” section with:

```markdown
## Manual Diagnostic Verification

Run command:

`PROMPT_PICKER_FOCUS_DIAGNOSTICS=1 npm run tauri -- dev`

| Scenario | prompt-button key? | prompt-popover key? | Classification | Recovery Used | Outcome | Notes |
|---|---:|---:|---|---:|---|---|
| Codex normal autosend | ... | ... | ... | ... | ... | ... |
| Claude normal autosend | ... | ... | ... | ... | ... | ... |
| WeChat normal autosend | ... | ... | ... | ... | ... | ... |
| Focus-break safety | n/a | n/a | ... | ... | ... | ... |
```

If any row was not run, mark it explicitly as `NOT RUN` and keep the overall verdict as not ready for acceptance.

**Step 7: Decide whether Task 4 is required**

Run Task 4 only if any normal autosend diagnostic shows:

- `can_become_key=true` for prompt overlays; or
- Prompt Picker becomes frontmost during normal prompt selection; or
- autosend enters recovery because the overlay stole focus.

Skip Task 4 only if Codex, Claude, and WeChat all show:

- overlay is not key/frontmost in normal use;
- classification is `Target`;
- recovery is not used;
- autosend succeeds.

**Step 8: Commit QA evidence**

```bash
git add docs/qa/2026-07-07-autosend-never-key-recovery.md
git commit -m "docs: add autosend diagnostic verification results"
```

---

### Task 4: Conditional Tao/Wry Guard Fix

**Run this task only if Task 3 diagnostic evidence proves it is needed.**

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/macos_panels.rs`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/macos_panels.rs`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/docs/qa/2026-07-07-autosend-never-key-recovery.md`

**Step 1: Record the trigger evidence**

Before editing code, paste the relevant diagnostic lines into QA under:

````markdown
## Conditional Task 4 Trigger Evidence

```
prompt-picker-panel ...
prompt-picker-autosend ...
```
````

**Step 2: Add a failing behavior expectation for the selected guard change**

If diagnostics show `ManagedTauriRuntime` windows still become key, add or adjust a pure test in `macos_panels.rs` to describe the new action. Example if the chosen fix is to allow never-key subclassing for runtime windows:

```rust
#[test]
fn panel_class_action_can_apply_never_key_to_runtime_window_when_enabled() {
    assert_eq!(
        panel_class_action_for_name_with_runtime_subclassing("TaoWindow", true),
        PanelClassAction::ApplyNeverKeySubclass
    );
}
```

Do not add this flag unless diagnostics require it.

**Step 3: Implement the smallest reversible fix**

Preferred order:

1. First try Tauri-native focus prevention only: verify every show path calls `set_focusable(false)` before and after show.
2. If that is insufficient, add a narrowly named internal switch/helper for applying the never-key subclass to runtime-managed overlay windows only.
3. Do not swizzle the main window.
4. Do not globally swizzle all Tao/Wry windows.

**Step 4: Run focused tests**

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
cargo test --manifest-path src-tauri/Cargo.toml macos_panels --lib
cargo test --manifest-path src-tauri/Cargo.toml windows --lib
```

Expected: PASS.

**Step 5: Repeat diagnostics**

Run:

```bash
PROMPT_PICKER_FOCUS_DIAGNOSTICS=1 npm run tauri -- dev
```

Repeat Codex, Claude, and WeChat normal autosend. Record the before/after result in QA.

**Step 6: Commit only if code changed**

```bash
git add src-tauri/src/macos_panels.rs docs/qa/2026-07-07-autosend-never-key-recovery.md
git commit -m "fix: enforce non-key behavior for prompt overlays"
```

---

### Task 5: Final Verification

**Files:**
- Modify if results changed: `/Users/yang/Desktop/GitHub-pre/prompt-picker/docs/qa/2026-07-07-autosend-never-key-recovery.md`

**Step 1: Run automated verification**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm test
npm run build
git diff --check -- src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/src/platform/macos.rs src-tauri/src/macos_panels.rs docs/qa/2026-07-07-autosend-never-key-recovery.md
```

Expected:

- Rust lib tests pass.
- Vitest tests pass.
- Frontend build passes.
- `git diff --check` has no output.

**Step 2: Run production-code scope checks**

Run:

```bash
rg -n "allows_fallback_click_point|paste_prompt_to_app|paste_prompt_to_last_target|pastePromptToApp|pastePromptToLastTarget|paste_to_app_script" src src-tauri/src
rg -n "bundle_id == \"com\\.openai\\.codex\"|name == \"Codex\"" src-tauri/src/lib.rs src-tauri/src/platform/macos.rs
```

Expected:

- First command: no matches.
- Second command: no production-logic matches. Test fixtures are acceptable.

**Step 3: Update QA final status**

In the QA document, add:

```markdown
## Final Acceptance Status

Automated verification: PASS/FAIL
Manual diagnostic matrix: PASS/FAIL
Task 4 required: yes/no
Task 4 executed: yes/no/n/a
Acceptance recommendation: PASS / NEEDS FIX / FAIL
```

**Step 4: Commit QA status if changed**

```bash
git add docs/qa/2026-07-07-autosend-never-key-recovery.md
git commit -m "docs: finalize autosend never-key QA status"
```

---

### Task 6: Final Review And Push

**Files:**
- No source changes expected.

**Step 1: Inspect commits and working tree**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
git log --oneline --decorate -8
git status --short
git diff --stat origin/main..HEAD
```

Expected:

- Only this repair plan's commits are ahead of `origin/main`.
- Any unrelated dirty build artifacts are not staged.
- No source or QA files from this task are left uncommitted.

**Step 2: Push only after verification passes**

Run:

```bash
git push origin main
```

Expected: push succeeds.

**Step 3: Report user-facing result**

Final response should state:

- pointer fallback no longer depends on AppKit main-thread availability;
- diagnostics were run for Codex, Claude, WeChat, and focus-break safety;
- whether Task 4 was needed;
- whether final acceptance status is PASS or still needs manual work.
