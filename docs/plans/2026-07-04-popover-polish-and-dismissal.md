# Popover Polish and Dismissal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Calico prompt list feel like a native floating popover: taller, closer to Calico, visually rounded without an outer square frame, and dismissible by dragging Calico or clicking outside.

**Architecture:** Keep the prompt list as the existing `prompt-popover` Tauri window, but adjust its sizing/position constants and make only this floating window transparent. Add native-side dismissal behavior because clicks outside the WebView are not visible to React. Use narrowly scoped tests around positioning, transparency invocation, drag dismissal, and outside-click handling.

**Tech Stack:** Tauri 2, Rust macOS window APIs, React, TypeScript, CSS, Vitest, Cargo tests.

---

### Task 1: Increase Prompt Popover Height and Reduce Calico Gap

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/styles.css`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs`

**Step 1: Update or add failing Rust tests for popover dimensions**

In `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs`, update the existing dimension-related tests so they assert the requested values:

```rust
#[test]
fn prompt_popover_height_supports_taller_prompt_list() {
    assert_eq!(POPOVER_HEIGHT, 388.0);
}

#[test]
fn prompt_popover_gap_keeps_list_close_to_calico() {
    assert_eq!(POPOVER_GAP, 4.0);
}
```

Keep existing positioning tests, but update their expected values to use `POPOVER_HEIGHT` and `POPOVER_GAP` rather than duplicated numbers.

**Step 2: Run the targeted Rust tests and verify they fail**

Run:

```bash
cargo test --manifest-path /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/Cargo.toml prompt_popover_height_supports_taller_prompt_list prompt_popover_gap_keeps_list_close_to_calico
```

Expected: FAIL because current constants are `POPOVER_HEIGHT = 340.0` and `POPOVER_GAP = 8.0`.

**Step 3: Update native popover constants**

In `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs`, change:

```rust
pub const POPOVER_HEIGHT: f64 = 340.0;
pub const POPOVER_GAP: f64 = 8.0;
```

to:

```rust
pub const POPOVER_HEIGHT: f64 = 388.0;
pub const POPOVER_GAP: f64 = 4.0;
```

Rationale: CSS list max-height becomes `360px`; current popover has `8px` top padding and `16px` bottom padding, plus a small safety allowance. `388px` leaves enough room for the `360px` scroll area, padding, border, and bottom arrow.

**Step 4: Update CSS list height**

In `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/styles.css`, change:

```css
.prompt-quick-list {
  max-height: 312px;
}
```

to:

```css
.prompt-quick-list {
  max-height: 360px;
}
```

Do not change item heights in this task.

**Step 5: Run tests**

Run:

```bash
cargo test --manifest-path /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/Cargo.toml prompt_popover
npm test -- --run /Users/yang/Desktop/GitHub-pre/prompt-picker/src/ui/PromptQuickList.test.tsx
```

Expected: PASS.

**Step 6: Commit**

```bash
git add /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs /Users/yang/Desktop/GitHub-pre/prompt-picker/src/styles.css
git commit -m "ui: tune prompt popover size and gap"
```

---

### Task 2: Hide Prompt List When Calico Drag Starts

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/public/overlay.html`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/overlay/overlayHtml.test.ts`

**Step 1: Add failing test for drag-start dismissal**

In `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/overlay/overlayHtml.test.ts`, add a test that asserts the drag-start branch invokes `hide_prompt_popover` before or when emitting `prompt-button-drag-started`.

Example assertion shape:

```ts
it("hides the prompt popover when Calico dragging starts", () => {
  expect(html).toContain("hidePromptPopoverForDrag");
  expect(html).toContain("await invoke('hide_prompt_popover')");
});
```

If the existing tests parse snippets rather than executing DOM events, keep this as a source-level regression test consistent with the file's current style.

**Step 2: Run the test and verify it fails**

Run:

```bash
npm test -- --run /Users/yang/Desktop/GitHub-pre/prompt-picker/src/overlay/overlayHtml.test.ts
```

Expected: FAIL because drag currently only moves Calico and emits drag events.

**Step 3: Add a small drag-dismiss helper in `overlay.html`**

In `/Users/yang/Desktop/GitHub-pre/prompt-picker/public/overlay.html`, add:

```js
let dragPopoverHidden = false;

async function hidePromptPopoverForDrag() {
  if (dragPopoverHidden) return;
  dragPopoverHidden = true;
  await invoke('hide_prompt_popover');
}
```

Reset `dragPopoverHidden = false` at the beginning of each `pointerdown`.

Inside the first transition into dragging, before or immediately after `emit('prompt-button-drag-started')`, call:

```js
hidePromptPopoverForDrag().catch(() => {});
```

Do not block pointer movement on the hide command.

**Step 4: Run the overlay test**

Run:

```bash
npm test -- --run /Users/yang/Desktop/GitHub-pre/prompt-picker/src/overlay/overlayHtml.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add /Users/yang/Desktop/GitHub-pre/prompt-picker/public/overlay.html /Users/yang/Desktop/GitHub-pre/prompt-picker/src/overlay/overlayHtml.test.ts
git commit -m "fix: hide prompt list when dragging calico"
```

---

### Task 3: Remove Outer Square Frame From Prompt Popover

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/App.tsx`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/styles.css`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/app/App.test.tsx`

**Step 1: Add failing Rust source-level test for transparent popover configuration**

In `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs`, add or update a test that inspects `show_popover_mode` and asserts the new window creation path calls:

```rust
crate::macos_panels::configure_transparent_webview_window(&window)?;
```

The test should also assert the existing non-activating panel call remains.

**Step 2: Add failing React/CSS test for popover-mode class**

In `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/app/App.test.tsx`, add a test that renders popover mode and asserts the root wrapper has a class dedicated to popover transparency, for example:

```ts
expect(document.querySelector(".popover-root")).toBeTruthy();
```

Do not require visual screenshot testing.

**Step 3: Run targeted tests and verify they fail**

Run:

```bash
cargo test --manifest-path /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/Cargo.toml transparent
npm test -- --run /Users/yang/Desktop/GitHub-pre/prompt-picker/src/app/App.test.tsx
```

Expected: FAIL because the prompt popover is not transparent yet and no popover root class exists.

**Step 4: Configure only real prompt-list popovers as transparent**

In `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs`, after creating `POPOVER_WINDOW_LABEL` in `show_popover_mode`, call transparent configuration only when `mode == "popover"`:

```rust
if mode == "popover" {
    crate::macos_panels::configure_transparent_webview_window(&window)?;
}
crate::macos_panels::configure_non_activating_panel(&window)?;
```

Also apply the same condition in the reuse branch:

```rust
if mode == "popover" {
    crate::macos_panels::configure_transparent_webview_window(&window)?;
}
crate::macos_panels::configure_non_activating_panel(&window)?;
```

Do not configure `button-controls` as transparent in this task. `show_popover_mode` serves both the prompt list and the right-click Calico controls; applying transparency to both would create avoidable visual risk for the controls panel. Do not change main manager or settings windows.

**Step 5: Add popover-only transparent page wrapper and page mode class**

In `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/App.tsx`, wrap the popover return with:

```tsx
<div className="popover-root">
  {pollingController}
  <div className="popover-window">
    ...
  </div>
</div>
```

Do not apply this wrapper to manager or settings modes.

Also add a small effect in `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/App.tsx` that toggles a class on `document.documentElement` and `document.body` only for the real prompt-list mode:

```tsx
useEffect(() => {
  const className = "popover-transparent-page";
  const enabled = windowLabel === "prompt-popover" && mode === "popover";
  document.documentElement.classList.toggle(className, enabled);
  document.body.classList.toggle(className, enabled);
  return () => {
    document.documentElement.classList.remove(className);
    document.body.classList.remove(className);
  };
}, [mode, windowLabel]);
```

This is required because native window transparency alone is not enough if `html` or `body` still paints a rectangular background.

**Step 6: Add popover-only transparent CSS**

In `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/styles.css`, add:

```css
html.popover-transparent-page,
body.popover-transparent-page {
  background: transparent;
}

body.popover-transparent-page #root {
  min-height: 100vh;
  background: transparent;
}

.popover-root {
  min-height: 100vh;
  background: transparent;
}
```

Update `.popover-window` if needed so it fills the transparent root without introducing a rectangular background outside the rounded panel:

```css
.popover-window {
  min-height: 100vh;
}
```

Do not globally remove `body { background: var(--pp-bg); }`. The transparency must be activated only by `popover-transparent-page`, so manager/settings pages and `button-controls` keep their existing backgrounds.

Add/adjust tests so they verify:

- Popover mode adds `.popover-root`.
- Popover mode toggles `popover-transparent-page`.
- Manager/settings/button-controls modes do not rely on `.popover-root` for their layout.

**Step 7: Run targeted tests**

Run:

```bash
cargo test --manifest-path /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/Cargo.toml transparent
npm test -- --run /Users/yang/Desktop/GitHub-pre/prompt-picker/src/app/App.test.tsx
```

Expected: PASS.

**Step 8: Commit**

```bash
git add /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs /Users/yang/Desktop/GitHub-pre/prompt-picker/src/App.tsx /Users/yang/Desktop/GitHub-pre/prompt-picker/src/styles.css /Users/yang/Desktop/GitHub-pre/prompt-picker/src/app/App.test.tsx
git commit -m "fix: make prompt popover background transparent"
```

---

### Task 4: Dismiss Prompt List on Outside Click

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/app/App.test.tsx`

**Step 1: Add pure Rust hit-test helpers and failing tests**

In `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs`, add pure helper tests first:

```rust
#[test]
fn outside_click_dismisses_when_point_is_outside_button_and_popover() {
    let button = WindowRect { x: 100.0, y: 500.0, width: BUTTON_WIDTH, height: BUTTON_HEIGHT };
    let popover = WindowRect { x: 20.0, y: 108.0, width: POPOVER_WIDTH, height: POPOVER_HEIGHT };
    assert!(should_dismiss_popover_for_click((900.0, 900.0), Some(button), Some(popover)));
}

#[test]
fn outside_click_keeps_popover_when_point_is_inside_popover_or_button() {
    let button = WindowRect { x: 100.0, y: 500.0, width: BUTTON_WIDTH, height: BUTTON_HEIGHT };
    let popover = WindowRect { x: 20.0, y: 108.0, width: POPOVER_WIDTH, height: POPOVER_HEIGHT };
    assert!(!should_dismiss_popover_for_click((40.0, 120.0), Some(button), Some(popover)));
    assert!(!should_dismiss_popover_for_click((120.0, 520.0), Some(button), Some(popover)));
}
```

Define the exact helper names during implementation if an equivalent local style already exists.

**Step 2: Run tests and verify they fail**

Run:

```bash
cargo test --manifest-path /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/Cargo.toml outside_click
```

Expected: FAIL because the helpers do not exist.

**Step 3: Implement pure hit-test helpers**

Add a private struct and helpers:

```rust
#[derive(Clone, Copy)]
struct WindowRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn point_inside_rect(point: (f64, f64), rect: WindowRect) -> bool {
    point.0 >= rect.x
        && point.0 <= rect.x + rect.width
        && point.1 >= rect.y
        && point.1 <= rect.y + rect.height
}

fn should_dismiss_popover_for_click(
    point: (f64, f64),
    button: Option<WindowRect>,
    popover: Option<WindowRect>,
) -> bool {
    if popover.is_none() {
        return false;
    }
    if button.is_some_and(|rect| point_inside_rect(point, rect)) {
        return false;
    }
    if popover.is_some_and(|rect| point_inside_rect(point, rect)) {
        return false;
    }
    true
}
```

**Step 4: Add native outside-click monitor**

Implement a macOS-only click monitor in the native layer. Preferred approach:

- Install a local/global mouse-down monitor when the prompt popover is shown.
- On mouse down, read current button and popover window rects in logical coordinates.
- Convert the native mouse point into the same top-left-origin logical coordinate space used by Tauri window positions before hit-testing.
- If the click is outside both, hide the popover and emit `prompt-popover-dismissed`.
- Remove or no-op the monitor when popover is hidden/closed.

Keep all native event monitor state private to `windows.rs` or a small helper module. Do not add React-level document click listeners for this requirement; they cannot catch clicks in other apps.

The monitor must guard these cases explicitly:

- Click inside the prompt list window: do not close, so prompt selection and hover behavior continue to work.
- Click inside Calico's button window: do not close from the outside-click monitor; Calico's existing toggle logic owns that click.
- Click outside both windows: close once and emit one dismissal event.
- Hidden or missing popover window: do nothing.
- Reopening an already existing popover: do not install duplicate monitors.
- Closing/hiding the popover: remove the monitor or mark it inactive so stale monitors cannot keep closing future windows.

Add pure tests for coordinate conversion and hit-testing. Use screen bounds fixtures to cover the top-left vs bottom-left origin difference:

```rust
#[test]
fn converts_bottom_left_screen_point_to_top_left_logical_point() {
    let bounds = MonitorBounds { x: 0.0, y: 0.0, width: 1440.0, height: 900.0 };
    assert_eq!(
        bottom_left_to_top_left_point((100.0, 200.0), bounds),
        (100.0, 700.0)
    );
}
```

If the AppKit event monitor is too invasive for the current objc2 setup, use the simplest reliable alternative available in Tauri/macOS for detecting outside focus/click without activating Prompt Picker. Do not introduce polling timers unless the event monitor proves unavailable.

**Step 5: Ensure existing close paths emit dismissal consistently**

Confirm these paths emit `prompt-popover-dismissed`:

- Toggle close from Calico.
- Outside click close.
- Drag-start close from Task 2.
- Prompt selection close path if already handled at app level.

If `hide_prompt_popover` is used for user-visible dismissal, update it to emit dismissal after hiding the window. Avoid duplicate user-facing side effects if the window is already hidden.

**Step 6: Run Rust tests**

Run:

```bash
cargo test --manifest-path /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/Cargo.toml outside_click prompt_popover
```

Expected: PASS.

**Step 7: Run app tests that cover dismissal events**

Run:

```bash
npm test -- --run /Users/yang/Desktop/GitHub-pre/prompt-picker/src/app/App.test.tsx /Users/yang/Desktop/GitHub-pre/prompt-picker/src/overlay/overlayHtml.test.ts
```

Expected: PASS.

**Step 8: Commit**

```bash
git add /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs /Users/yang/Desktop/GitHub-pre/prompt-picker/src/app/App.test.tsx
git commit -m "fix: dismiss prompt list on outside click"
```

---

### Task 5: Full Verification and Packaging

**Files:**
- Verify only; no source changes expected.

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

**Step 3: Build production frontend**

Run:

```bash
npm run build
```

Expected: PASS.

**Step 4: Build signed Tauri app**

Run:

```bash
npm run tauri:build:signed
```

Expected: PASS and output:

```text
/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/target/release/bundle/macos/Prompt Picker.app
/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/target/release/bundle/dmg/Prompt Picker_1.0.0_aarch64.dmg
```

**Step 5: Git status review**

Run:

```bash
git status --short
```

Expected: only intended source/test changes and generated bundle artifacts are present. Do not stage unrelated dirty files such as `node_modules/.package-lock.json` or old untracked plan docs unless the user explicitly asks.

**Step 6: Push to GitHub main if requested by the user during execution**

Run:

```bash
git push origin main
```

Expected: push succeeds.
