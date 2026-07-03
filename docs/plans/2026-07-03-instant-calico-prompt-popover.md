# Instant Calico Prompt Popover Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Calico prompt list appear immediately and reliably on click, without requiring a second click and without weakening drag, right-click controls, prompt sending, or prompt freshness.

**Architecture:** Treat Calico as a button first and a draggable object second. The overlay should tolerate small pointer movement, open the prompt popover without waiting for macOS target scanning, and let backend target capture run in parallel. The popover window should be reused when possible for speed, while the React popover refreshes prompt data whenever the reused window is shown.
Prompt selection must remain reliable even if the user clicks a prompt immediately after the list opens, so autosend falls back to the recent input target when the async prompt-pick session is not ready yet.

**Tech Stack:** Tauri v2, vanilla HTML/CSS/JS overlay, React/Vitest, Rust/Tauri window management, macOS non-activating panel behavior.

---

## Product Contract

From the user's point of view:

```text
Click Calico:
  prompt list appears immediately
  slight hand movement still counts as a click

Drag Calico:
  only a deliberate drag moves Calico

Right-click / Ctrl-click Calico:
  button controls still open

After editing prompts:
  next Calico list open shows the latest local prompt data

Prompt selection:
  existing paste/send behavior is unchanged

Fast prompt selection:
  if the user clicks a prompt immediately after the list appears, autosend still uses the recent target app
```

## Non-Negotiable Constraints

- Do not modify prompt storage schema.
- Do not modify clipboard, accessibility, key-event mechanics, or group-send timing.
- Autosend may only be changed to add a recent-target fallback when the prompt-pick session has not finished yet.
- Do not modify Calico image assets or throw animations.
- Do not introduce user-visible loading states before showing the prompt list.
- Do not commit generated `dist/` or `src-tauri/target/` build artifacts.
- Keep right-click / Ctrl-click button controls behavior intact.

## Files To Touch

- Modify: `public/overlay.html`
- Modify: `src/overlay/overlayHtml.test.ts`
- Modify: `src-tauri/src/windows.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/App.tsx`
- Modify: `src/app/App.test.tsx`

## Files To Avoid

- Avoid: `src-tauri/src/platform/macos.rs`
- Avoid: `src/shared/promptStore.ts`
- Avoid: `src/shared/promptTypes.ts`
- Avoid: `src/ui/PromptManager.tsx`
- Avoid: `src/ui/PromptQuickList.tsx`

---

### Task 1: Lock The Overlay Click Contract In Tests

**Files:**
- Modify: `src/overlay/overlayHtml.test.ts`
- Test: `src/overlay/overlayHtml.test.ts`

**Step 1: Replace the old blocking-order test**

Find the current test:

```ts
it("records the prompt pick session target before opening the prompt list", () => {
  const html = readFileSync("public/overlay.html", "utf8");

  expect(html).toContain("begin_prompt_pick_session");
  expect(html.indexOf("begin_prompt_pick_session")).toBeLessThan(
    html.indexOf("show_prompt_popover_from_button")
  );
});
```

Replace it with:

```ts
it("opens the prompt list without awaiting target session capture", () => {
  const html = readFileSync("public/overlay.html", "utf8");

  expect(html).toContain("const sessionPromise = invoke('begin_prompt_pick_session');");
  expect(html).toContain("await invoke('show_prompt_popover_from_button');");
  expect(html).toContain("void sessionPromise.catch(() => null);");
  expect(html).not.toContain("await invoke('begin_prompt_pick_session')");
  expect(html).not.toContain("await sessionPromise.catch");
});
```

**Step 2: Add a test for tolerant drag threshold**

Add this test near the existing drag/click command test:

```ts
it("requires deliberate pointer movement before treating a click as drag", () => {
  const html = readFileSync("public/overlay.html", "utf8");

  expect(html).toContain("const DRAG_START_DISTANCE_PX = 10;");
  expect(html).toContain("distance(start, current) < DRAG_START_DISTANCE_PX");
  expect(html).not.toContain("distance(start, current) < 4");
});
```

**Step 3: Run the focused overlay test and verify failure**

Run:

```bash
npm test -- --run src/overlay/overlayHtml.test.ts
```

Expected: FAIL because `public/overlay.html` still uses a hard-coded `4px` threshold and still awaits `begin_prompt_pick_session` before showing the popover.

**Step 4: Commit**

```bash
git add src/overlay/overlayHtml.test.ts
git commit -m "test: require instant calico prompt popover click"
```

---

### Task 2: Make Overlay Click Open The List Immediately

**Files:**
- Modify: `public/overlay.html`
- Test: `src/overlay/overlayHtml.test.ts`

**Step 1: Add an explicit drag threshold constant**

Near the existing constants:

```js
const THROW_RELEASE_MS = 170;
const THROW_RECOVER_MS = 760;
const READY_TIMEOUT_MS = 30000;
```

Add:

```js
const DRAG_START_DISTANCE_PX = 10;
```

**Step 2: Replace the hard-coded drag threshold**

Replace:

```js
if (!dragging && distance(start, current) < 4) return;
```

With:

```js
if (!dragging && distance(start, current) < DRAG_START_DISTANCE_PX) return;
```

**Step 3: Make session capture non-blocking for visual opening**

In the non-drag `pointerup` branch, replace:

```js
setMotionState('ready', READY_TIMEOUT_MS);
await invoke('begin_prompt_pick_session');
await invoke('show_prompt_popover_from_button');
```

With:

```js
setMotionState('ready', READY_TIMEOUT_MS);
const sessionPromise = invoke('begin_prompt_pick_session');
await invoke('show_prompt_popover_from_button');
void sessionPromise.catch(() => null);
```

This preserves target capture but prevents the macOS Accessibility scan from blocking both the first visible prompt list response and the overlay pointer-state cleanup.

**Step 4: Run the focused overlay test**

Run:

```bash
npm test -- --run src/overlay/overlayHtml.test.ts
```

Expected: PASS for the newly changed overlay expectations. Existing tests may still fail if unrelated current animation tests are already expecting the old Calico action assets; do not change those in this task.

**Step 5: Commit**

```bash
git add public/overlay.html
git commit -m "fix: open calico prompt list without blocking on target scan"
```

---

### Task 3: Add Recent Target Fallback For Fast Prompt Selection

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/lib.rs`

**Step 1: Add a failing single-prompt fallback test**

Inside the existing `#[cfg(test)]` module in `src-tauri/src/lib.rs`, add this test near `autosend_without_last_target_copies_without_sending`:

```rust
#[test]
fn autosend_falls_back_to_recent_target_when_prompt_session_is_not_ready() {
    let session_state = PromptPickSessionState::default();
    let recent_state = LastInputTargetState::default();
    recent_state.set(LastInputTarget {
        app: FrontmostApp {
            name: "Codex".to_string(),
            bundle_id: "com.openai.codex".to_string(),
        },
        observed_at_ms: now_ms(),
        click_point: Some(TargetClickPoint { x: 640.0, y: 720.0 }),
    });

    let result = paste_prompt_and_submit_to_session_target_with_senders(
        "hello",
        &session_state,
        Some(&recent_state),
        |body, bundle_id, click_point| {
            assert_eq!(body, "hello");
            assert_eq!(bundle_id, "com.openai.codex");
            assert_eq!(click_point.unwrap().x, 640.0);
            AutosendOutcome::sent()
        },
        |_| panic!("copy sender must not run when recent target is usable"),
    );

    let outcome = result.unwrap();
    assert!(outcome.sent);
    assert!(session_state.get().is_none());
}
```

**Step 2: Add a failing group fallback test**

Add:

```rust
#[test]
fn autosend_sequence_falls_back_to_recent_target_when_prompt_session_is_not_ready() {
    let session_state = PromptPickSessionState::default();
    let recent_state = LastInputTargetState::default();
    recent_state.set(LastInputTarget {
        app: FrontmostApp {
            name: "WeChat".to_string(),
            bundle_id: "com.tencent.xinWeChat".to_string(),
        },
        observed_at_ms: now_ms(),
        click_point: None,
    });
    let bodies = vec!["one".to_string(), "two".to_string()];
    let mut sent = Vec::new();

    let result = paste_prompt_sequence_and_submit_to_session_target_with_senders(
        &bodies,
        700,
        &session_state,
        Some(&recent_state),
        |body, bundle_id, click_point| {
            sent.push((body.to_string(), bundle_id.to_string(), click_point));
            AutosendOutcome::sent()
        },
        |_| panic!("copy sender must not run when recent target is usable"),
        |_| {},
    )
    .unwrap();

    assert!(result.sent);
    assert_eq!(result.sent_count, 2);
    assert_eq!(sent.len(), 2);
    assert_eq!(sent[0].1, "com.tencent.xinWeChat");
    assert!(sent[0].2.is_none());
}
```

**Step 3: Run focused Rust tests and verify failure**

Run:

```bash
cd src-tauri && cargo test prompt_session_is_not_ready
```

Expected: FAIL because the sender helpers do not accept a recent-target fallback yet.

**Step 4: Add a target selection helper**

In `src-tauri/src/lib.rs`, near `paste_prompt_and_submit_to_session_target_with_senders`, add:

```rust
fn prompt_pick_target_or_recent(
    session_state: &PromptPickSessionState,
    recent_state: Option<&LastInputTargetState>,
) -> Option<PromptPickSessionTarget> {
    if let Some(target) = session_state.take() {
        return Some(target);
    }

    recent_state
        .and_then(LastInputTargetState::get)
        .filter(is_recent_prompt_target)
        .filter(|target| is_usable_autosend_app(&target.app))
        .map(|target| PromptPickSessionTarget {
            app: target.app,
            observed_at_ms: now_ms(),
            click_point: target.click_point,
        })
}
```

**Step 5: Update single-prompt helper signature**

Change:

```rust
fn paste_prompt_and_submit_to_session_target_with_senders<A, C>(
    body: &str,
    state: &PromptPickSessionState,
    app_sender: A,
    copy_sender: C,
) -> Result<AutosendOutcome, String>
```

To:

```rust
fn paste_prompt_and_submit_to_session_target_with_senders<A, C>(
    body: &str,
    state: &PromptPickSessionState,
    recent_state: Option<&LastInputTargetState>,
    app_sender: A,
    copy_sender: C,
) -> Result<AutosendOutcome, String>
```

Inside the function, replace:

```rust
let Some(target) = state.take() else {
```

With:

```rust
let Some(target) = prompt_pick_target_or_recent(state, recent_state) else {
```

Update existing tests that intentionally expect no target to pass `None`. Update command-level calls to pass `Some(recent_state.inner())`.

**Step 6: Update command-level single-prompt function**

Change the command signature:

```rust
fn paste_prompt_and_submit_to_last_target(
    body: String,
    session_state: tauri::State<PromptPickSessionState>,
    app: tauri::AppHandle,
) -> Result<AutosendOutcome, String>
```

To:

```rust
fn paste_prompt_and_submit_to_last_target(
    body: String,
    session_state: tauri::State<PromptPickSessionState>,
    recent_state: tauri::State<LastInputTargetState>,
    app: tauri::AppHandle,
) -> Result<AutosendOutcome, String>
```

Update `paste_prompt_and_submit_to_last_target_impl` to accept `recent_state: &LastInputTargetState`, and pass `Some(recent_state)` into `paste_prompt_and_submit_to_session_target_with_senders`.

**Step 7: Update group helper signature**

Change:

```rust
fn paste_prompt_sequence_and_submit_to_session_target_with_senders<A, C, S>(
    bodies: &[String],
    interval_ms: u64,
    state: &PromptPickSessionState,
    mut app_sender: A,
    copy_sender: C,
    mut sleeper: S,
) -> Result<AutosendSequenceOutcome, String>
```

To:

```rust
fn paste_prompt_sequence_and_submit_to_session_target_with_senders<A, C, S>(
    bodies: &[String],
    interval_ms: u64,
    state: &PromptPickSessionState,
    recent_state: Option<&LastInputTargetState>,
    mut app_sender: A,
    copy_sender: C,
    mut sleeper: S,
) -> Result<AutosendSequenceOutcome, String>
```

Inside the function, replace:

```rust
let Some(target) = state.take() else {
```

With:

```rust
let Some(target) = prompt_pick_target_or_recent(state, recent_state) else {
```

Update existing tests that intentionally expect no target to pass `None`. Update command-level calls to pass `Some(recent_state.inner())`.

**Step 8: Update command-level group function**

Change the command signature:

```rust
fn paste_prompt_sequence_and_submit_to_last_target(
    bodies: Vec<String>,
    interval_ms: u64,
    session_state: tauri::State<PromptPickSessionState>,
    app: tauri::AppHandle,
) -> Result<AutosendSequenceOutcome, String>
```

To:

```rust
fn paste_prompt_sequence_and_submit_to_last_target(
    bodies: Vec<String>,
    interval_ms: u64,
    session_state: tauri::State<PromptPickSessionState>,
    recent_state: tauri::State<LastInputTargetState>,
    app: tauri::AppHandle,
) -> Result<AutosendSequenceOutcome, String>
```

Update `paste_prompt_sequence_and_submit_to_last_target_impl` to accept `recent_state: &LastInputTargetState`, and pass `Some(recent_state)` into `paste_prompt_sequence_and_submit_to_session_target_with_senders`.

**Step 9: Run focused Rust tests**

Run:

```bash
cd src-tauri && cargo test autosend
```

Expected: PASS.

**Step 10: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "fix: use recent target when prompt session is still pending"
```

---

### Task 4: Lock Popover Window Reuse In Rust Tests

**Files:**
- Modify: `src-tauri/src/windows.rs`
- Test: `src-tauri/src/windows.rs`

**Step 1: Add pure helper tests**

Inside `#[cfg(test)] mod tests` in `src-tauri/src/windows.rs`, add:

```rust
#[test]
fn reuses_popover_only_for_the_same_mode() {
    assert!(should_reuse_popover(Some("popover"), "popover"));
    assert!(should_reuse_popover(Some("button-controls"), "button-controls"));
    assert!(!should_reuse_popover(Some("button-controls"), "popover"));
    assert!(!should_reuse_popover(None, "popover"));
}
```

**Step 2: Add a source-level behavior test for reuse path**

Add:

```rust
#[test]
fn show_popover_mode_repositions_and_shows_existing_same_mode_window() {
    let source = include_str!("windows.rs");
    let start = source
        .find("fn show_popover_mode")
        .expect("show_popover_mode should exist");
    let end = source[start..]
        .find("#[tauri::command]")
        .expect("show_popover_mode should end before next command");
    let function_source = &source[start..start + end];

    assert!(function_source.contains("should_reuse_popover"));
    assert!(function_source.contains("set_position(prompt_button_window_position(x, y))"));
    assert!(function_source.contains("window.show().map_err"));
    assert!(function_source.contains("emit_popover_opened(app, mode)"));
}
```

**Step 3: Run Rust window tests and verify failure**

Run:

```bash
cd src-tauri && cargo test windows::tests
```

Expected: FAIL because `should_reuse_popover` and the reuse path do not exist yet.

**Step 4: Commit**

```bash
git add src-tauri/src/windows.rs
git commit -m "test: require prompt popover window reuse"
```

---

### Task 5: Reuse The Existing Popover Window When Mode Matches

**Files:**
- Modify: `src-tauri/src/windows.rs`
- Test: `src-tauri/src/windows.rs`

**Step 1: Import Tauri event emission**

At the top of `src-tauri/src/windows.rs`, replace:

```rust
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
```

With:

```rust
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
```

**Step 2: Add popover mode state helpers**

Near the popover constants, add:

```rust
fn popover_mode_state() -> &'static std::sync::Mutex<Option<String>> {
    static STATE: std::sync::OnceLock<std::sync::Mutex<Option<String>>> =
        std::sync::OnceLock::new();
    STATE.get_or_init(|| std::sync::Mutex::new(None))
}

fn current_popover_mode() -> Option<String> {
    popover_mode_state()
        .lock()
        .expect("popover mode lock poisoned")
        .clone()
}

fn set_popover_mode(mode: Option<&str>) {
    *popover_mode_state()
        .lock()
        .expect("popover mode lock poisoned") = mode.map(str::to_string);
}

fn should_reuse_popover(existing_mode: Option<&str>, requested_mode: &str) -> bool {
    existing_mode == Some(requested_mode)
}

fn emit_popover_opened(app: &tauri::AppHandle, mode: &str) {
    let _ = app.emit_to(POPOVER_WINDOW_LABEL, "prompt-popover-opened", mode);
}
```

**Step 3: Replace `show_popover_mode` with a reuse-aware version**

Replace the existing function:

```rust
fn show_popover_mode(x: f64, y: f64, mode: &str, app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(POPOVER_WINDOW_LABEL) {
        window.close().map_err(|e| e.to_string())?;
    }

    let url = format!("index.html?mode={}", mode);
    let window = WebviewWindowBuilder::new(app, POPOVER_WINDOW_LABEL, WebviewUrl::App(url.into()))
        .title("Prompt Picker")
        .inner_size(POPOVER_WIDTH, POPOVER_HEIGHT)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .accept_first_mouse(true)
        .skip_taskbar(true)
        .position(x, y)
        .build()
        .map_err(|e| e.to_string())?;
    crate::macos_panels::configure_non_activating_panel(&window)?;
    Ok(())
}
```

With:

```rust
fn show_popover_mode(x: f64, y: f64, mode: &str, app: &tauri::AppHandle) -> Result<(), String> {
    let existing_mode = current_popover_mode();
    if let Some(window) = app.get_webview_window(POPOVER_WINDOW_LABEL) {
        if should_reuse_popover(existing_mode.as_deref(), mode) {
            window
                .set_position(prompt_button_window_position(x, y))
                .map_err(|e| e.to_string())?;
            window.show().map_err(|e| e.to_string())?;
            crate::macos_panels::configure_non_activating_panel(&window)?;
            emit_popover_opened(app, mode);
            return Ok(());
        }

        window.close().map_err(|e| e.to_string())?;
        set_popover_mode(None);
    }

    let url = format!("index.html?mode={}", mode);
    let window = WebviewWindowBuilder::new(app, POPOVER_WINDOW_LABEL, WebviewUrl::App(url.into()))
        .title("Prompt Picker")
        .inner_size(POPOVER_WIDTH, POPOVER_HEIGHT)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .accept_first_mouse(true)
        .skip_taskbar(true)
        .position(x, y)
        .build()
        .map_err(|e| e.to_string())?;
    crate::macos_panels::configure_non_activating_panel(&window)?;
    set_popover_mode(Some(mode));
    emit_popover_opened(app, mode);
    Ok(())
}
```

**Step 4: Run Rust window tests**

Run:

```bash
cd src-tauri && cargo test windows::tests
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src-tauri/src/windows.rs
git commit -m "fix: reuse prompt popover window for same mode"
```

---

### Task 6: Refresh Prompt Data When A Reused Popover Opens

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/app/App.test.tsx`
- Test: `src/app/App.test.tsx`

**Step 1: Update the Tauri event mock**

In `src/app/App.test.tsx`, replace:

```ts
const emitMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
```

With:

```ts
const emitMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const listenMock = vi.hoisted(() => vi.fn());
const eventHandlers = vi.hoisted(() => new Map<string, (event: { payload: unknown }) => void>());
```

Replace:

```ts
vi.mock("@tauri-apps/api/event", () => ({
  emit: emitMock,
}));
```

With:

```ts
vi.mock("@tauri-apps/api/event", () => ({
  emit: emitMock,
  listen: listenMock,
}));
```

In `beforeEach`, add:

```ts
eventHandlers.clear();
listenMock.mockReset();
listenMock.mockImplementation((eventName: string, handler: (event: { payload: unknown }) => void) => {
  eventHandlers.set(eventName, handler);
  return Promise.resolve(() => {
    eventHandlers.delete(eventName);
  });
});
```

**Step 2: Add a failing refresh test**

Add this test in `src/app/App.test.tsx` near the popover-mode tests:

```ts
it("refreshes prompt data when a reused popover is opened", async () => {
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  (readTextFile as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce(JSON.stringify({ version: 1, prompts: mockPrompts }))
    .mockResolvedValueOnce(JSON.stringify({
      version: 1,
      prompts: [
        {
          id: "2",
          title: "Updated Prompt",
          type: "single",
          prompts: [{ id: "entry-2", body: "Updated body", order: 0 }],
          intervalMs: 700,
          order: 0,
          createdAt: "2026-07-03T00:00:00.000Z",
          updatedAt: "2026-07-03T00:00:00.000Z",
        },
      ],
    }));

  await act(async () => {
    render(<App />);
  });

  await waitFor(() => {
    expect(screen.getByText("Test Prompt")).toBeTruthy();
  });

  await act(async () => {
    eventHandlers.get("prompt-popover-opened")?.({ payload: "popover" });
  });

  await waitFor(() => {
    expect(screen.getByText("Updated Prompt")).toBeTruthy();
  });
});
```

**Step 3: Run the focused App test and verify failure**

Run:

```bash
npm test -- --run src/app/App.test.tsx
```

Expected: FAIL because `App.tsx` does not listen for `prompt-popover-opened` yet.

**Step 4: Import `listen` in `App.tsx`**

Replace:

```ts
import { emit } from "@tauri-apps/api/event";
```

With:

```ts
import { emit, listen } from "@tauri-apps/api/event";
```

**Step 5: Add a prompt reload callback**

Inside `App`, after refs are created:

```ts
const reloadPrompts = useCallback(async () => {
  setPrompts(await storeRef.current.list());
}, []);
```

**Step 6: Use `reloadPrompts` for initial prompt loading**

In the existing initial `useEffect`, replace:

```ts
storeRef.current.list().then((items) => {
  if (active) setPrompts(items);
});
```

With:

```ts
storeRef.current.list().then((items) => {
  if (active) setPrompts(items);
});
```

Do not change this line if preserving the `active` guard is simpler. The important implementation is the event listener in the next step.

**Step 7: Listen for reused popover openings**

After the initial loading `useEffect`, add:

```ts
useEffect(() => {
  let active = true;
  let unlisten: (() => void) | undefined;

  listen<string>("prompt-popover-opened", async (event) => {
    if (!active || event.payload !== "popover") return;
    await reloadPrompts();
  })
    .then((cleanup) => {
      if (active) {
        unlisten = cleanup;
      } else {
        cleanup();
      }
    })
    .catch((error) => {
      console.warn("Failed to listen for prompt popover openings:", error);
    });

  return () => {
    active = false;
    unlisten?.();
  };
}, [reloadPrompts]);
```

**Step 8: Run the focused App test**

Run:

```bash
npm test -- --run src/app/App.test.tsx
```

Expected: PASS.

**Step 9: Commit**

```bash
git add src/App.tsx src/app/App.test.tsx
git commit -m "fix: refresh prompts when reusing popover"
```

---

### Task 7: Full Verification

**Files:**
- No source changes unless a verification failure identifies a specific bug.

**Step 1: Run frontend tests**

Run:

```bash
npm test -- --run
```

Expected: PASS.

**Step 2: Run Rust tests**

Run:

```bash
cd src-tauri && cargo test
```

Expected: PASS.

**Step 3: Inspect changed files**

Run:

```bash
git status --short
git diff --stat
```

Expected: only these files should be changed by this plan:

```text
public/overlay.html
src/overlay/overlayHtml.test.ts
src-tauri/src/windows.rs
src-tauri/src/lib.rs
src/App.tsx
src/app/App.test.tsx
docs/plans/2026-07-03-instant-calico-prompt-popover.md
```

Do not stage `dist/`, `node_modules/`, or `src-tauri/target/`.

**Step 4: Build the app only after tests pass**

Run:

```bash
npm run tauri build
```

Expected: App and DMG are produced under:

```text
src-tauri/target/release/bundle/macos/Prompt Picker.app
src-tauri/target/release/bundle/dmg/Prompt Picker_1.0.0_aarch64.dmg
```

**Step 5: Manual interaction smoke check**

Open the built app and verify:

```text
1. Click Calico once with a normal hand movement.
   Expected: prompt list appears immediately.

2. Click Calico with slight pointer movement.
   Expected: prompt list still appears.

3. Deliberately drag Calico.
   Expected: Calico moves and the prompt list does not open.

4. Right-click Calico.
   Expected: button controls open.

5. Edit a prompt in Manage Prompts, then click Calico again.
   Expected: prompt list shows the edited prompt.

6. Click a prompt.
   Expected: existing paste/send behavior remains unchanged.
```

**Step 6: Final commit if verification created source changes**

If any verification fix was required, commit it separately:

```bash
git add <specific source/test files only>
git commit -m "fix: stabilize instant prompt popover verification"
```

Do not commit generated build artifacts.
