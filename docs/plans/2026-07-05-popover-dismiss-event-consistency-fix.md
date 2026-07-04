# Popover Dismiss Event Consistency Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every user-visible prompt popover dismissal path emit `prompt-popover-dismissed`, especially the drag-start path that currently hides the popover through `hide_prompt_popover` without emitting the dismissal event.

**Architecture:** Keep the existing native outside-click monitor and React reset listeners. Make `hide_prompt_popover` the consistent backend hide command by emitting dismissal only when the popover was visible before hiding, so drag-start dismissal resets hover/motion state the same way as outside-click and Calico toggle dismissal. Remove frontend duplicate dismissal emits after `hidePromptPopover()` so there is one clear dismissal event source. Avoid changing popover sizing, transparency, hover preview, prompt selection, autosend, manager, or settings behavior.

**Tech Stack:** Tauri 2, Rust, AppKit event monitor integration already in `windows.rs`, React/Vitest source-level regression tests.

---

### Task 1: Add Regression Coverage for Backend Hide Dismissal

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs`

**Step 1: Add a failing source-level Rust regression test**

In `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs`, inside the existing `#[cfg(test)] mod tests`, add this test near the other popover dismissal tests:

```rust
#[test]
fn hide_prompt_popover_emits_dismissal_after_hiding_visible_window() {
    let source = include_str!("windows.rs");
    let start = source
        .find("pub fn hide_prompt_popover")
        .expect("hide_prompt_popover command should exist");
    let end = source[start..]
        .find("#[tauri::command]\npub fn show_prompt_popover_from_button")
        .expect("show_prompt_popover_from_button should follow hide_prompt_popover");
    let command_source = &source[start..start + end];

    assert!(command_source.contains("let was_visible = window.is_visible().unwrap_or(false);"));
    assert!(command_source.contains("if was_visible {"));
    assert!(command_source.contains("emit_popover_dismissed(&app);"));
    assert!(
        command_source
            .find("window.hide().map_err")
            .expect("hide should happen")
            < command_source
                .find("emit_popover_dismissed(&app);")
                .expect("dismissal should be emitted")
    );
}
```

Rationale: the current project already uses source-level Rust tests for window behavior, and constructing real Tauri windows inside a unit test would be heavier than this narrowly scoped regression check.

**Step 2: Run the targeted test and verify it fails**

Run:

```bash
cargo test --manifest-path /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/Cargo.toml hide_prompt_popover_emits_dismissal_after_hiding_visible_window -- --nocapture
```

Expected: FAIL because current `hide_prompt_popover` hides the window and deactivates the outside-click monitor, but does not check prior visibility or emit `prompt-popover-dismissed`.

---

### Task 2: Emit Dismissal From `hide_prompt_popover`

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs`

**Step 1: Update `hide_prompt_popover` with visible-window guard**

In `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs`, change:

```rust
#[tauri::command]
pub fn hide_prompt_popover(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(POPOVER_WINDOW_LABEL) {
        window.hide().map_err(|e| e.to_string())?;
        set_outside_click_monitor_active(false);
    }
    Ok(())
}
```

to:

```rust
#[tauri::command]
pub fn hide_prompt_popover(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(POPOVER_WINDOW_LABEL) {
        let was_visible = window.is_visible().unwrap_or(false);
        window.hide().map_err(|e| e.to_string())?;
        set_outside_click_monitor_active(false);
        if was_visible {
            emit_popover_dismissed(&app);
        }
    }
    Ok(())
}
```

Rationale: this makes the backend hide command a consistent dismissal path without emitting redundant events when the popover is already hidden or missing.

**Step 2: Do not add frontend duplicate emits**

Do not add `emit("prompt-popover-dismissed")` inside `/Users/yang/Desktop/GitHub-pre/prompt-picker/public/overlay.html`.

The drag path currently calls:

```js
await invoke('hide_prompt_popover');
```

After the backend fix, this is enough. Adding a second frontend emit would risk duplicate reset side effects.

**Step 3: Run targeted Rust tests**

Run:

```bash
cargo test --manifest-path /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/Cargo.toml hide_prompt_popover_emits_dismissal_after_hiding_visible_window -- --nocapture
cargo test --manifest-path /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/Cargo.toml prompt_popover -- --nocapture
cargo test --manifest-path /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/Cargo.toml outside_click -- --nocapture
```

Expected: PASS.

---

### Task 3: Verify Drag Path Still Uses the Backend Hide Command

**Files:**
- Test only: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/overlay/overlayHtml.test.ts`

**Step 1: Run the existing overlay regression test**

Run:

```bash
npm test -- --run /Users/yang/Desktop/GitHub-pre/prompt-picker/src/overlay/overlayHtml.test.ts
```

Expected: PASS. Existing coverage should still assert:

- `hidePromptPopoverForDrag` exists.
- It calls `await invoke('hide_prompt_popover')`.
- It runs before `emit('prompt-button-drag-started')`.
- The overlay listens for `prompt-popover-dismissed` and calls `resetCalicoMotion`.

**Step 2: Do not change overlay drag behavior**

No code changes are expected in `overlay.html` for this fix unless the existing test unexpectedly fails.

---

### Task 4: Remove Frontend Duplicate Dismiss Emits After Backend Hide

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/App.tsx`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/app/App.test.tsx`

**Step 1: Add or update failing tests for button-controls dismissal ownership**

In `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/app/App.test.tsx`, update the existing button-controls tests that currently expect `emit("prompt-popover-dismissed")` after `hide_prompt_popover`.

The updated expectation should assert that these controls still invoke the backend hide command but no longer manually emit the dismissal event from React:

```ts
expect(vi.mocked(invoke)).toHaveBeenCalledWith("hide_prompt_popover");
expect(emitMock).not.toHaveBeenCalledWith("prompt-popover-dismissed");
```

Apply this to the button-controls paths that do:

- Manage Prompts
- Hide Calico
- Open Accessibility Settings

Do not change tests for prompt selection/autosend dismissal if those paths still need app-level behavior unrelated to `hide_prompt_popover`.

**Step 2: Run the targeted app tests and verify they fail**

Run:

```bash
npm test -- --run /Users/yang/Desktop/GitHub-pre/prompt-picker/src/app/App.test.tsx
```

Expected: FAIL because the button-controls handlers currently call `emitPromptPopoverDismissed()` manually after `hidePromptPopover()`.

**Step 3: Remove duplicate frontend emits from button-controls hide paths**

In `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/App.tsx`, find the `mode === "button-controls"` return block.

Change these handlers from:

```tsx
await openMainWindow();
await hidePromptPopover();
await emitPromptPopoverDismissed();
```

to:

```tsx
await openMainWindow();
await hidePromptPopover();
```

Change:

```tsx
await hidePromptButton();
await hidePromptPopover();
await emitPromptPopoverDismissed();
```

to:

```tsx
await hidePromptButton();
await hidePromptPopover();
```

Change:

```tsx
await openAccessibilitySettings();
await hidePromptPopover();
await emitPromptPopoverDismissed();
```

to:

```tsx
await openAccessibilitySettings();
await hidePromptPopover();
```

Rationale: after Task 2, `hide_prompt_popover` emits the dismissal event when it hides a visible popover. Keeping these frontend emits would create duplicate `prompt-popover-dismissed` events for the same user action.

**Step 4: Run targeted app tests**

Run:

```bash
npm test -- --run /Users/yang/Desktop/GitHub-pre/prompt-picker/src/app/App.test.tsx
```

Expected: PASS.

---

### Task 5: Full Verification and Commit

**Files:**
- Verify: full project tests
- Commit:
  - `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs`
  - `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/App.tsx`
  - `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/app/App.test.tsx`

**Step 1: Run full frontend tests**

Run:

```bash
npm test -- --run
```

Expected: PASS.

**Step 2: Run full Rust tests**

Run:

```bash
cargo test --manifest-path /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/Cargo.toml
```

Expected: PASS.

**Step 3: Check formatting**

Run:

```bash
cargo fmt --manifest-path /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/Cargo.toml --check
```

Expected: PASS.

**Step 4: Commit the fix**

Run:

```bash
git add /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs
git add /Users/yang/Desktop/GitHub-pre/prompt-picker/src/App.tsx
git add /Users/yang/Desktop/GitHub-pre/prompt-picker/src/app/App.test.tsx
git commit -m "fix: centralize prompt popover dismissal event"
```

Do not stage unrelated files, build artifacts, icon changes, `node_modules`, or other plan documents.

---

### Acceptance Criteria

- Dragging Calico while the prompt list is open hides the list and emits `prompt-popover-dismissed`.
- The prompt popover hover preview and Calico motion reset listeners receive the same dismissal event for drag-start close, outside-click close, and Calico toggle close.
- Missing or already hidden popover does not emit unnecessary dismissal events.
- Button-controls actions that call `hide_prompt_popover` do not manually emit a duplicate `prompt-popover-dismissed` event from React.
- No changes are made to sizing, 4px gap, transparent rounded panel, outside-click hit testing, prompt selection, autosend, prompt manager, or settings behavior.
- Full frontend and Rust test suites pass.
