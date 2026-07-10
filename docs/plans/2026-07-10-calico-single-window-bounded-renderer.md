# Calico Single-Window Bounded Renderer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate long-running Calico disappearance by enforcing exactly one native prompt-button window and replacing unbounded WebKit animated-APNG decoding with a renderer that owns and releases a strictly bounded set of decoded resources.

**Architecture:** Keep the existing motion names, trigger conditions, prompt popover behavior, drag behavior, status feedback, and prompt workflow unchanged. Render motion frames into one visible `<canvas>` from pre-generated static sprite sheets, with a preferred `ImageBitmap` backend and a tested static `HTMLImageElement`/Object-URL compatibility backend selected by a real WebView capability check. Retain no more than two decoded surfaces, allow at most one decode in flight, release every stale or evicted surface explicitly, and schedule only the next source frame rather than running a permanent 60 Hz loop. Remove healthy-age WebView rebuilds entirely; native in-memory desired visibility controls one idempotent button window, and both button and popover labels are reused instead of close-then-build replacement.

**Tech Stack:** Tauri 2.11, Rust atomics/managed state, Tokio one-shot/time primitives, macOS WKWebView/WebKit, Windows WebView2, vanilla browser modules, Canvas 2D, `ImageBitmap`, static `HTMLImageElement`/Object URLs, Vite, Vitest, ffmpeg/ffprobe for one-time committed asset generation.

---

## Why This Plan Replaces the Previous Recovery Approach

This plan supersedes:

- `docs/plans/2026-07-06-calico-motion-memory-stability.md`
- `docs/plans/2026-07-07-calico-overlay-render-recovery.md`

Those plans reduced URL growth and added recovery, but they preserved two unsafe assumptions:

1. Reusing two APNG URLs would make WebKit release old decoded frames.
2. Closing and rebuilding a healthy WebView every 30 minutes was a safe maintenance operation.

The July 10 live process proves both assumptions false:

- Prompt Picker main process peak footprint: about 34 MiB.
- Calico WebContent footprint: about 752.8 MiB.
- Shared graphics memory in that process: about 586.2 MiB.
- Live `org.webkit.ImageDecoder` queues: about 120.
- Native windows named `Prompt Button`: 3, although the product requires 1.
- The idle APNG pool decodes to about 205.3 MiB per renderer instance; three instances predict about 616 MiB, closely matching the observed 586.2 MiB shared graphics allocation.
- Saved settings still say `floatingButton.visible: true`, while no Prompt Picker button window is visible on the current desktop.

The causal chain is therefore:

```text
APNG source rotation
  -> decoded frame surfaces remain in WebKit
  -> 30-minute healthy rebuild calls asynchronous close + immediate same-label build
  -> old/new WebViews overlap or the valid registry entry is lost
  -> multiple APNG runtimes multiply graphics allocations
  -> WebKit stops presenting the sprite or the active button window disappears
  -> the native transparent window may still block clicks
  -> DOM heartbeat continues and reports a false healthy state
```

The implementation must remove this chain rather than add another fallback image or another periodic reset.

## UX Contract

From the user's perspective, the behavior remains familiar:

```text
Calico remains visible for the whole App session
  -> idle and contextual motions still play
  -> only one Calico can ever be visible
  -> click opens the existing prompt panel
  -> drag, right-click, permissions, and status feedback remain unchanged
  -> no invisible 288 x 288 window remains after a renderer failure
```

No user-facing memory controls, reset buttons, sync controls, diagnostics, or new settings are introduced.

## Hard Invariants

The completed implementation must encode these as tests:

1. At most one native `Prompt Button` window is managed at any time.
2. Healthy window age is never a rebuild trigger.
3. No runtime path calls `close()` or `destroy()` and immediately builds the same window label.
4. The visible Calico DOM contains exactly one visual surface: one canvas.
5. At most two decoded motion-sheet surfaces are live in total, including a resolved in-flight replacement, and at most one fetch/decode operation is in flight.
6. Every evicted, stale, or partially loaded surface is released exactly once: `ImageBitmap.close()` or `img.src = ""` plus `URL.revokeObjectURL()`.
7. A late async load can never replace a newer motion; a failed load leaves the last valid canvas frame visible.
8. Frame scheduling uses at most one deadline timer, and static/final frames have no active timer.
9. APNG finite/infinite playback semantics, motion names, priorities, durations, scale, offsets, and trigger conditions remain unchanged.
10. Native desired visibility is held in memory; a stale file read or in-flight show cannot revive a user-disabled pet.
11. Prompt-button and prompt-popover labels are reused; no runtime path performs same-label close/destroy followed by immediate build.
12. Canvas drawing preserves contain geometry, transparent alpha, CSS transforms, and display-density changes without layout shift.
13. Autosend and prompt data behavior are outside this change. Popover lifecycle internals may change only to reuse the existing window while preserving the current UI and events.
14. Renderer readiness is scoped to a native-issued renderer instance id. A callback from an old WebView instance can never show, hide, or change readiness for the current instance.
15. A current renderer transition from ready to unready immediately hides an already-visible native button window; it does not merely block future show calls.
16. Runtime Canvas context loss, draw failure, page suspension, and restoration have an explicit state transition and redraw path. A renderer that cannot prove a valid visible frame is never left inside a visible click-blocking window.
17. First-frame replacement is committed to the visible canvas with one successful copy operation from a bounded off-DOM scratch surface; no clear-before-draw path can erase the prior valid frame on failure.
18. Delayed timers after sleep/throttling derive the displayed frame from monotonic total elapsed time and skip expired frames instead of replaying a callback backlog.
19. A different-mode popover handshake is asynchronous and non-blocking. No synchronous Tauri command or UI-thread operation waits for a React acknowledgement.
20. On macOS, a positively reported WebContent-process termination hides the button immediately and navigates the same existing WebView to a fresh overlay URL/renderer instance. It never waits for window age, overlaps two windows, or rebuilds a healthy WebView.

## Explicit Non-Goals

- Do not redesign Calico art or motion timing.
- Do not remove any authorized Calico action.
- Do not change prompt storage, categories, import/export, file sync, permission UX, autosend, focus recovery, or packaging metadata.
- Do not change the settings schema or settings UI; settings file transport may be serialized through native commands only to prevent visibility-write races.
- Do not add a second baseline `<img>` underneath the canvas.
- Do not use periodic App/WebView restart as the primary solution.
- Do not add per-App behavior or macOS-only motion behavior.
- Do not silently raise the minimum supported macOS version or drop the `safari13` build target to avoid implementing the compatibility renderer.
- Do not ship source APNG files in the release bundle once equivalent generated sheets exist; retain authorized sources in the repository outside `public/`.

## Execution Prerequisite

The current main worktree is dirty and diverged from `origin/main`, and this plan file is currently untracked. Preserve the main worktree exactly. Pin the remote SHA, create a dedicated worktree from that exact SHA, copy this plan into it, and commit the plan before implementation:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
git fetch origin
BASE_SHA=$(git rev-parse origin/main)
printf '%s\n' "$BASE_SHA"
test -z "$(git branch --list fix/calico-single-window-renderer)"
git worktree add /Users/yang/Desktop/GitHub-pre/prompt-picker-calico-fix \
  -b fix/calico-single-window-renderer "$BASE_SHA"
cp /Users/yang/Desktop/GitHub-pre/prompt-picker/docs/plans/2026-07-10-calico-single-window-bounded-renderer.md \
  /Users/yang/Desktop/GitHub-pre/prompt-picker-calico-fix/docs/plans/
cd /Users/yang/Desktop/GitHub-pre/prompt-picker-calico-fix
git tag calico-single-window-base-20260710 "$BASE_SHA"
git add docs/plans/2026-07-10-calico-single-window-bounded-renderer.md
git commit -m "docs: add bounded calico renderer plan"
```

Expected: the new worktree is clean after the plan commit, its parent is the pinned released `1.0.8` SHA, and the plan is available inside the execution worktree. If the branch or local baseline tag already exists, stop and inspect it; do not delete or overwrite it automatically. Do not clean, reset, cherry-pick uncommitted diagnostics, or overwrite `/Users/yang/Desktop/GitHub-pre/prompt-picker`.

All final scope comparisons use `calico-single-window-base-20260710`, not the moving `origin/main` reference.

`dist/` is ignored today but still contains legacy tracked files. In the dedicated worktree, assert those tracked files are clean before every build/probe. Builds may modify them for verification, but this task does not update or delete legacy tracked `dist` files. After consuming the built output, run `git restore --worktree -- dist` only in this clean dedicated worktree and verify `git diff --quiet -- dist`; never run that cleanup in the user's dirty primary worktree.

---

### Task 1: Capture the Failure Baseline and Guard the Scope

**Files:**
- Inspect: `public/overlay.html`
- Inspect: `public/calico/motion-runtime.js`
- Inspect: `public/calico/idle-director.js`
- Inspect: `src-tauri/src/lib.rs`
- Inspect: `src-tauri/src/windows.rs`
- Inspect: `src/overlay/*.test.ts`

**Step 1: Confirm the worktree baseline**

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/main
```

Expected: clean worktree; `HEAD` equals the `origin/main` commit captured when the worktree was created.

**Step 2: Run the existing focused tests**

Run:

```bash
npm ci
npm test -- \
  src/overlay/calicoMotionRuntime.test.ts \
  src/overlay/calicoIdleDirector.test.ts \
  src/overlay/calicoManifest.test.ts \
  src/overlay/overlayHtml.test.ts
cd src-tauri && cargo test prompt_button && cd ..
```

Expected: PASS. Record any pre-existing failure before proceeding; do not weaken tests to make the baseline green.

Record the pre-change shipped Calico asset size for the final package comparison:

```bash
npm run build
du -sk dist/calico | tee /tmp/prompt-picker-calico-base-assets-kib
git restore --worktree -- dist
git diff --quiet -- dist
```

Expected: the file contains one numeric KiB baseline and remains outside the repository.

**Step 3: Confirm the known unsafe paths are present**

Run:

```bash
rg -n "REPLAY_SLOT_COUNT|replay=|aged_out|30 \* 60|rebuild_prompt_button_window|window.close" \
  public src src-tauri/src
```

Expected: current source contains bounded replay URLs, age-based rebuild, and close-then-build recovery.

**Step 4: Do not commit**

This task only establishes the baseline.

---

### Task 2: Specify the Native Single-Window Lifecycle with Failing Tests

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Later modify: `src-tauri/src/windows.rs`
- Later modify: `src/App.tsx`
- Later modify: `src/platform/platformApi.ts`
- Test: existing Rust tests in `src-tauri/src/lib.rs` and `src-tauri/src/windows.rs`
- Create: `src/platform/platformApi.test.ts`
- Modify: `src/overlay/useInputTargetPolling.test.ts`
- Modify: `src/app/App.test.tsx`

**Step 1: Replace time-based rebuild tests with presence-decision tests**

In the existing Rust test module, add tests for a pure decision helper that does not exist yet:

```rust
#[test]
fn prompt_button_monitor_builds_when_enabled_button_is_missing() {
    assert_eq!(
        prompt_button_ensure_action(true, false, false),
        PromptButtonEnsureAction::BuildMissing
    );
}

#[test]
fn prompt_button_monitor_shows_enabled_hidden_button() {
    assert_eq!(
        prompt_button_ensure_action(true, true, false),
        PromptButtonEnsureAction::ShowExisting
    );
}

#[test]
fn prompt_button_monitor_leaves_enabled_visible_button_alone() {
    assert_eq!(
        prompt_button_ensure_action(true, true, true),
        PromptButtonEnsureAction::None
    );
}

#[test]
fn prompt_button_monitor_never_revives_user_disabled_button() {
    assert_eq!(
        prompt_button_ensure_action(false, false, false),
        PromptButtonEnsureAction::None
    );
    assert_eq!(
        prompt_button_ensure_action(false, true, false),
        PromptButtonEnsureAction::None
    );
}
```

Add managed desired-visibility and race tests. Settings JSON is used only once to initialize the native state; it is not polled as a runtime source of truth:

```rust
#[test]
fn disabled_visibility_wins_over_an_in_flight_show() {
    let state = PromptButtonVisibilityState::new(true);
    let show_generation = state.generation();
    state.set(false);

    assert!(!state.may_show(show_generation));
}

#[test]
fn monitor_never_revives_a_disabled_pet() {
    assert_eq!(
        prompt_button_ensure_action(false, false, false),
        PromptButtonEnsureAction::None
    );
}

#[test]
fn saved_visibility_initializes_state_once() {
    let settings = serde_json::json!({ "floatingButton": { "visible": false } });
    let state = PromptButtonVisibilityState::from_settings(&settings);
    assert!(!state.desired_visible());
}
```

Add a popover lifecycle test proving that switching from `popover` to `button-controls` and back chooses `ReuseExisting` and never `CloseThenBuild`. Add a frontend platform API test proving that the Close pet path invokes one native command that marks desired visibility false before hiding the window.

**Step 2: Run tests and verify failure**

Run:

```bash
cd src-tauri && cargo test prompt_button_monitor -- --nocapture
```

Expected: FAIL because the lifecycle decision, managed visibility state/generation, native visibility command, and popover reuse decision do not exist yet.

**Step 3: Commit the failing specification only if stopping**

Normally continue directly to Task 3.

---

### Task 3: Remove Periodic Rebuild and Implement an Idempotent Presence Monitor

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/windows.rs`
- Modify: `src/App.tsx`
- Modify: `src/platform/platformApi.ts`
- Modify: `src/storage/tauriSettingsStorage.ts`
- Create: `src/storage/tauriSettingsStorage.test.ts`
- Modify: `src/shared/settingsStore.test.ts`
- Modify: existing related Rust and frontend tests

**Step 1: Add managed native desired visibility and the pure lifecycle decision**

Near the existing settings helpers in `src-tauri/src/lib.rs`, add a managed state backed by atomics. The generation closes the race where a queued main-thread `show_prompt_button` was created while enabled but runs after the user closes the pet:

```rust
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

struct PromptButtonVisibilityState {
    desired_visible: AtomicBool,
    generation: AtomicU64,
}

impl PromptButtonVisibilityState {
    fn new(visible: bool) -> Self { /* initialize both atomics */ }
    fn from_settings(settings: &serde_json::Value) -> Self { /* parse once */ }
    fn desired_visible(&self) -> bool { /* Acquire load */ }
    fn generation(&self) -> u64 { /* Acquire load */ }
    fn set(&self, visible: bool) { /* store visibility, then increment generation */ }
    fn may_show(&self, requested_generation: u64) -> bool {
        self.desired_visible() && self.generation() == requested_generation
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PromptButtonEnsureAction {
    None,
    ShowExisting,
    BuildMissing,
}

fn prompt_button_ensure_action(
    expected_visible: bool,
    window_present: bool,
    window_visible: bool,
) -> PromptButtonEnsureAction {
    if !expected_visible {
        PromptButtonEnsureAction::None
    } else if !window_present {
        PromptButtonEnsureAction::BuildMissing
    } else if !window_visible {
        PromptButtonEnsureAction::ShowExisting
    } else {
        PromptButtonEnsureAction::None
    }
}
```

At App setup, register `SettingsFileState`, read valid settings through its locked read path once, create `PromptButtonVisibilityState::from_settings(...)`, and register it with `.manage(...)`. A parse/read failure may use the existing product default at startup only. Runtime monitor iterations must never parse `settings.json`.

**Step 2: Remove the old recovery state**

Delete from `src-tauri/src/lib.rs`:

- `PromptButtonHealthSnapshot`
- `PromptButtonHealthPayload`
- `PromptButtonHealthState`
- `should_rebuild_prompt_button`
- `.manage(PromptButtonHealthState::default())`
- the `prompt-button-health` listener
- the age/stale-heartbeat rebuild branch
- tests that assert `aged_out`, `safe_to_rebuild`, or `rebuild_prompt_button_window`

This is deliberate deletion, not refactoring. Healthy window age must no longer influence lifecycle.

**Step 3: Replace the watchdog with a presence-only monitor backed by native memory**

After the initial `show_prompt_button`, retain a low-frequency native thread, but make it read only `PromptButtonVisibilityState`. Capture the generation before queuing work and re-check it on the main thread:

```rust
let monitor_app = app.handle().clone();
std::thread::spawn(move || loop {
    std::thread::sleep(std::time::Duration::from_secs(15));

    let visibility = monitor_app.state::<PromptButtonVisibilityState>();
    let expected_visible = visibility.desired_visible();
    let requested_generation = visibility.generation();
    let button = monitor_app.get_webview_window(crate::windows::BUTTON_WINDOW_LABEL);
    let action = prompt_button_ensure_action(
        expected_visible,
        button.is_some(),
        button
            .as_ref()
            .and_then(|window| window.is_visible().ok())
            .unwrap_or(false),
    );

    if action == PromptButtonEnsureAction::None {
        continue;
    }

    let ensure_app = monitor_app.clone();
    let _ = monitor_app.run_on_main_thread(move || {
        let visibility = ensure_app.state::<PromptButtonVisibilityState>();
        if !visibility.may_show(requested_generation) {
            return;
        }
        let (x, y) = startup_prompt_button_position(&ensure_app);
        let _ = show_prompt_button(x, y, ensure_app);
    });
});
```

`show_prompt_button` is the one idempotent entry point:

- existing visible window: no-op except position/size checks;
- existing hidden window: show it using the existing legacy `<img>` overlay behavior;
- missing window: build it once with the fixed label and show it using the existing legacy overlay behavior.

The public show entry point must also verify desired visibility immediately before showing/building. The monitor is recovery for a missing native window, not a second settings synchronization mechanism.

**Step 4: Route every user/tray visibility change through the same native state**

Add a Tauri command such as `set_prompt_button_visibility(visible, app, state)`. It must apply the runtime intent first: update `PromptButtonVisibilityState`, hide/show the popover and button, and emit `prompt-button-visibility-changed` to every App webview. Persistence happens after the visible result and must not undo the runtime intent if disk writing fails.

Return a structured outcome:

```ts
type PromptButtonVisibilityOutcome = {
  visible: boolean;
  applied: boolean;
  persisted: boolean;
  error: string | null;
};
```

To eliminate partial in-process reads and protect this task's live visibility field, add a managed `SettingsFileState` mutex and native `read_settings_text` / `write_settings_text` commands. Route **every** native settings reader/writer through the same state: startup/menu reads, the visibility JSON patch, `set_accessibility_prompt_requested`, and any remaining `read_settings_value` / `write_settings_value` caller. Delete or make private-through-state the old unlocked file helpers so a later caller cannot bypass serialization. All reads wait for a full write.

Before `write_settings_text` persists frontend-supplied JSON, parse it and reject malformed or non-object JSON without touching the existing file, then normalize only `floatingButton.visible` from `PromptButtonVisibilityState.desired_visible()`. Preserve every other key/value supplied by the frontend byte-for-byte at the JSON-value level, including unknown forward-compatible keys, so the transport migration cannot silently reset language, blacklist, placement, insertion mode, permissions, or prompt-library link data. Change `createTauriSettingsStorage` to use these commands while preserving the existing JSON schema and `SettingsStore` API.

The mutex serializes complete individual file reads and writes; it does not make the existing frontend `read -> modify -> write` sequence a general transaction. Do not claim otherwise or expand this task into a settings-store redesign. The visibility normalization is the narrow protection required here. Add tests for malformed JSON leaving the old file intact, unknown and all known settings fields surviving a write, frontend write versus native visibility patch, accessibility-marker write versus visibility change, no production settings writer bypassing `SettingsFileState`, missing AppData directory creation, persistence failure, and the same resolved AppData path on macOS and Windows. Do not invent an untested cross-platform rename-over-existing sequence in this task.

Update:

- `src/App.tsx` Close pet: call the native visibility command instead of writing settings and hiding separately.
- tray Show/Hide pet actions: call the same native helper rather than independently writing JSON and showing/hiding.
- every React App webview (`main` and `prompt-popover`): listen for `prompt-button-visibility-changed` and update `activeSettings.floatingButton.visible` in memory without issuing another native show/hide call. The standalone button overlay does not own settings state.
- `src/overlay/useInputTargetPolling.ts`: stop polling and stop issuing show calls when the synchronized value is false; resume normal position tracking when it becomes true. Existing positioning behavior remains unchanged.
- `show_prompt_button`: re-check native desired visibility before every show/build, so stale callers cannot override Close pet.
- `hide_prompt_button`: remains a temporary window operation and must not mutate desired visibility; only `set_prompt_button_visibility` changes user intent.

The JSON file remains persisted configuration, but the native atomic state is the live authority during the process lifetime. If persistence fails, Calico still follows the user's current show/hide command, the outcome reports `persisted: false`, and the frontend logs the failure without showing a contradictory state. Add tests for Close pet versus an in-flight show, tray show after Close pet, a later unrelated settings write preserving visibility, and persistence failure still applying the visible result.

Do not add renderer-readiness gating in this task. The existing legacy `<img>` overlay has no readiness callback. Readiness is introduced atomically with the Canvas integration in Task 9 so no intermediate commit can permanently hide Calico.

**Step 5: Delete the unsafe button rebuild helper**

Delete `rebuild_prompt_button_window` from `src-tauri/src/windows.rs`. Do not replace it with another close/build helper.

**Step 6: Reuse the same prompt-popover window for both modes**

Change `show_popover_mode` so an existing `POPOVER_WINDOW_LABEL` is always reused. Same-mode requests may reposition, resize, refresh, and show immediately. Different-mode requests use a latest-wins asynchronous handshake backed by managed native `PopoverModeRequestState` and a monotonically increasing request id:

```text
hide existing popover
  -> increment mode request id
  -> set_popover_mode(Some(requested_mode))
  -> resize/reposition while hidden
  -> emit prompt-popover-mode-requested { requestId, mode }
  -> React setMode(mode)
  -> React waits one requestAnimationFrame after commit
  -> invoke acknowledge_prompt_popover_mode { requestId, mode }
  -> native verifies request id is still current
  -> enable outside-click monitoring and show the reused window
```

Add the explicit dependency `tokio = { version = "1", features = ["sync", "time"] }` and implement the different-mode path as an `async` Tauri command/future using `tokio::sync::oneshot` plus `tokio::time::timeout`. Use `tauri::async_runtime` only to spawn detached timeout/cancellation work when needed. No mutex guard, condition variable, synchronous command, `run_on_main_thread` closure, or UI-thread operation may block while awaiting React. A newer request cancels/resolves the older waiter as superseded without hiding or mutating the newer request. Window hide/resize/show operations run on the main thread only for their short operation and never wait there.

Treat hide/toggle/visibility commands as state transitions, not unrelated window calls:

- `hide_prompt_popover`, Close pet, drag-start dismissal, and desired visibility false increment/cancel the pending request id before hiding, so a late acknowledgement cannot reopen the panel;
- a second `toggle_prompt_popover_from_button` while the same popover-open request is pending cancels that request and returns `opened: false`, preserving toggle semantics;
- a right-click/button-controls request while a popover request is pending supersedes it and becomes the only current waiter;
- never hold `PopoverModeRequestState` or renderer-state locks while emitting events, invoking Tauri window methods, awaiting a channel, or calling `run_on_main_thread`; extract the decision and release the lock first.

Add a bounded one-second asynchronous handshake timeout. Timeout keeps the window hidden, clears outside-click monitoring only when the timed-out request is still current, and returns/logs an error; it must never show stale content. A later click may retry with a new request id. Preserve the existing command result semantics: a different-mode command resolves as opened only after the acknowledged mode is actually visible, and returns an error when superseded or timed out.

Update the existing React listener to accept both modes. React acknowledgement proves only that the correct structural mode has committed. It must not await `reloadPromptData()` or linked-file synchronization; emit the existing `prompt-popover-opened` event after native show, then refresh prompt data asynchronously as today. This keeps slow disk/file-sync work outside the one-second handshake. The current Close pet control and prompt list remain visually and behaviorally unchanged.

Do not call `window.close()` when switching `popover <-> button-controls`. If an existing window is genuinely invalid, return an error and let an explicit future recovery policy handle it; do not overlap asynchronous close with same-label build.

**Step 7: Add regression guards against every same-label rebuild**

In the `windows.rs` tests, replace the old narrow source test and add behavior tests:

```rust
#[test]
fn overlay_runtime_has_no_same_label_close_then_build_path() {
    let source = include_str!("windows.rs");

    assert!(!source.contains("rebuild_prompt_button_window"));
    assert!(!source.contains("window.close()"));
}

#[test]
fn popover_mode_switch_reuses_the_existing_window() {
    assert_eq!(
        popover_window_action(Some("popover"), "button-controls"),
        PopoverWindowAction::ReuseExisting
    );
}
```

Add tests proving stale acknowledgements cannot show the window, hide/Close pet/drag dismissal cancel a pending request, a second pending toggle closes rather than reopens, right-click supersedes a pending popover, a newer request resolves the previous waiter without touching the newer request, no lock is held across event/window/await boundaries, no synchronous/UI-thread wait is used, native mode is updated before outside-click geometry is evaluated, timeout remains hidden, slow prompt-data reload does not delay acknowledgement, and the visible window never displays the previous mode at the new mode's dimensions.

If another legitimate close remains in this module, replace the source-string assertion with a pure lifecycle-decision test that specifically proves both fixed labels never choose close-then-build. Do not weaken the invariant to button-only.

**Step 8: Run focused tests**

Run:

```bash
cd src-tauri && cargo test prompt_button -- --nocapture && cd ..
npm test -- \
  src/platform/platformApi.test.ts \
  src/storage/tauriSettingsStorage.test.ts \
  src/shared/settingsStore.test.ts \
  src/overlay/useInputTargetPolling.test.ts \
  src/app/App.test.tsx
```

Expected: PASS.

**Step 9: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock \
  src-tauri/src/lib.rs src-tauri/src/windows.rs src/App.tsx \
  src/platform/platformApi.ts src/platform/platformApi.test.ts \
  src/storage/tauriSettingsStorage.ts src/storage/tauriSettingsStorage.test.ts \
  src/shared/settingsStore.test.ts \
  src/overlay/useInputTargetPolling.test.ts src/app/App.test.tsx
git commit -m "fix: enforce a single calico window lifecycle"
```

---

### Task 4: Add a Repeatable Real-WebView Renderer Capability Gate

**Files:**
- Create: `scripts/run-calico-webview-probe.mjs`
- Create: `tests/fixtures/calico-runtime-surface-probe.html`
- Create: `src-tauri/src/calico_probe.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `package.json`
- Modify: `.github/workflows/build-windows.yml`

The repository targets old WebKit behavior, but files under `public/` are copied verbatim and are not transpiled by Vite. Do not rely on `vite.config.ts` to make the raw Calico modules parse. This task creates a repeatable debug-only App-protocol probe and is a stop/go gate before bulk conversion.

**Step 1: Write the probe fixture**

Commit an HTML fixture that exercises both paths independently. In the runner, embed three fixed base64-encoded 2x2 PNGs with distinct documented transparent/opaque colors; decode them to `public/calico/runtime-probe-a.png`, `-b.png`, and `-c.png` before the debug build. The initial loader gate uses `-a`; Task 7 cycles all three through the production renderer to exercise eviction. This avoids opaque binary-edit steps while still loading PNG through the App protocol:

1. preferred: `fetch -> Blob -> createImageBitmap -> drawImage -> close`;
2. compatibility: `fetch -> Blob -> URL.createObjectURL -> HTMLImageElement.decode/load -> drawImage -> img.src = "" -> URL.revokeObjectURL`.

The fixture calls a debug-only Tauri command with:

```json
{
  "createImageBitmapAvailable": true,
  "imageBitmapCloseAvailable": true,
  "preferredBackendDrawn": true,
  "compatibilityBackendDrawn": true,
  "transparentPixelPreserved": true,
  "opaquePixelPreserved": true,
  "objectUrlRevoked": true,
  "rendererDiagnostics": null,
  "error": null
}
```

Use `getImageData` only in this diagnostic fixture.

**Step 2: Add the debug-only native probe entry**

In `src-tauri/src/calico_probe.rs`, guarded by `#[cfg(debug_assertions)]`:

- activate only when `PROMPT_PICKER_CALICO_PROBE_OUTPUT` is set;
- open `WebviewUrl::App("calico/runtime-surface-probe.html")`, guaranteeing the production App protocol rather than a dev-server URL;
- expose `record_calico_surface_probe`, which atomically writes JSON to the requested output path under `src-tauri/target/calico-probe-artifacts/` and exits the App;
- enforce a native timeout so a parse/load crash returns nonzero instead of hanging CI.

Normal startup and release builds must not expose the probe command or window. `rendererDiagnostics` is `null` in the initial loader-only gate; Task 7 extends the same fixture to import the production renderer and populate it after real-WebView stress.

**Step 3: Add the cross-platform runner**

`scripts/run-calico-webview-probe.mjs` must:

1. fail before doing work unless tracked `dist` and temporary `public/calico/runtime-*` paths are clean/absent, then copy the committed HTML fixture into `public/calico/runtime-surface-probe.html` and decode the runner's three fixed base64 PNGs into `public/calico/runtime-probe-{a,b,c}.png`;
2. run `tauri build --debug --no-bundle`, allowing Tauri's normal `beforeBuildCommand` to embed those App-protocol resources;
3. recreate `src-tauri/target/calico-probe-artifacts/`, launch `src-tauri/target/debug/prompt-picker` on macOS/Linux or `prompt-picker.exe` on Windows with result/log paths in that ignored directory;
4. wait with a fixed timeout, parse the JSON, and fail unless the compatibility backend and alpha checks pass;
5. allow preferred-backend absence, but fail when it is selected without both successful drawing and an explicit `ImageBitmap.close()` capability;
6. remove only the temporary `public/calico/runtime-*` and generated `dist/calico/runtime-*` files in `finally`, restore tracked build output with `git restore --worktree -- dist`, and do so even after build/launch failure; preserve `src-tauri/target/calico-probe-artifacts/` for local inspection/CI upload;
7. assert `git status --short -- public/calico` is unchanged and `git diff --quiet -- dist` succeeds after cleanup.

Always print the probe JSON path, backend decision, native stderr, and timeout reason before cleanup. In the Windows workflow, upload the probe JSON and runner log with `if: always()` so a WebView2 infrastructure/startup failure is distinguishable from a renderer capability failure. A missing GUI session, missing WebView2 runtime, process crash, parser failure, and pixel assertion failure must produce different nonzero diagnostics rather than the same generic timeout.

Add:

```json
"test:calico-webview": "node scripts/run-calico-webview-probe.mjs"
```

**Step 4: Run the macOS WKWebView gate**

Run:

```bash
npm run test:calico-webview
```

Expected: compatibility backend, transparent alpha, opaque pixels, and cleanup pass through the real WKWebView App protocol.

**Step 5: Commit and run the Windows WebView2 gate**

Add `npm run test:calico-webview` to `.github/workflows/build-windows.yml` before installer packaging, followed by an `if: always()` artifact-upload step for `src-tauri/target/calico-probe-artifacts/`. Keep this step permanently so later renderer changes receive the same gate. Commit and push the feature branch so GitHub can execute the new workflow definition:

```bash
git add scripts/run-calico-webview-probe.mjs tests/fixtures \
  src-tauri/src/calico_probe.rs src-tauri/src/lib.rs package.json \
  .github/workflows/build-windows.yml
git commit -m "test: add real webview calico capability gate"
git push -u origin fix/calico-single-window-renderer
gh workflow run build-windows.yml --ref fix/calico-single-window-renderer
sleep 3
RUN_ID=$(gh run list --workflow build-windows.yml \
  --branch fix/calico-single-window-renderer --limit 1 \
  --json databaseId --jq '.[0].databaseId')
test -n "$RUN_ID"
gh run watch "$RUN_ID" --exit-status
```

Expected: the workflow writes and validates the result JSON. A successful compile without this probe is not acceptance.

**Step 6: Apply the gate**

- If both platforms have a working backend, continue.
- If `ImageBitmap` fails but compatibility passes, keep compatibility as mandatory product code.
- If compatibility fails, stop and revise the renderer architecture; do not lower OS support silently.

---

### Task 5: Generate Static Sprite Sheets and Frame Metadata

**Files:**
- Create: `assets/calico-source/manifest.json`
- Copy for source preservation: `public/calico/*.apng` -> `assets/calico-source/*.apng`
- Create: `scripts/generate-calico-sprite-sheets.mjs`
- Create: `public/calico/sheets/manifest.json`
- Create: `public/calico/sheets/*.png`
- Create: `src/overlay/calicoSheetManifest.test.ts`
- Modify: `package.json`

The original APNG files are copied into the authorized repository source directory in this task, while the existing copies under `public/` and the current runtime manifest remain untouched so this commit is still fully runnable. Task 9 atomically switches the runtime to Canvas and removes the public APNG copies in the same green commit. Use three explicit metadata layers:

- `assets/calico-source/manifest.json`: state-to-source-file mapping plus authorization/source metadata;
- `public/calico/manifest.json`: currently remains backward-compatible; Task 9 converts it to runtime behavior only;
- `public/calico/sheets/manifest.json`: generated render metadata: sheet file, frame geometry, durations, and APNG play count.

Normal development and release builds consume committed sprite sheets and do not require ffmpeg.

**Step 1: Write the failing manifest coverage test**

Create `src/overlay/calicoSheetManifest.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type SourceManifest = {
  states: Record<string, { file: string }>;
};

type SheetEntry = {
  file: string;
  pixelFormat: "rgba";
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  columns: number;
  rows: number;
  gutter: number;
  strideX: number;
  strideY: number;
  sheetWidth: number;
  sheetHeight: number;
  frameDurationsMs: number[];
  plays: number;
};

describe("Calico sprite sheet manifest", () => {
  it("covers every APNG motion with deterministic frame metadata", () => {
    const sources = JSON.parse(
      readFileSync("assets/calico-source/manifest.json", "utf8")
    ) as SourceManifest;
    const sheets = JSON.parse(
      readFileSync("public/calico/sheets/manifest.json", "utf8")
    ) as { states: Record<string, SheetEntry> };

    for (const [state] of Object.entries(sources.states)) {
      const sheet = sheets.states[state];
      expect(sheet, state).toBeDefined();
      expect(existsSync(`public${sheet.file}`), state).toBe(true);
      expect(sheet.frameCount, state).toBeGreaterThan(0);
      expect(sheet.columns * sheet.rows, state).toBeGreaterThanOrEqual(sheet.frameCount);
      expect(sheet.file, state).toMatch(/-sheet-[a-f0-9]{12}\.png$/);
      expect(sheet.pixelFormat, state).toBe("rgba");
      const png = readFileSync(`public${sheet.file}`);
      expect(png.toString("ascii", 12, 16), state).toBe("IHDR");
      expect(png[25], `${state} PNG color type`).toBe(6); // truecolor + alpha
      expect(sheet.gutter, state).toBeGreaterThanOrEqual(2);
      expect(sheet.strideX, state).toBe(sheet.frameWidth + sheet.gutter);
      expect(sheet.strideY, state).toBe(sheet.frameHeight + sheet.gutter);
      expect(sheet.sheetWidth, state).toBe(
        sheet.columns * sheet.frameWidth + (sheet.columns - 1) * sheet.gutter
      );
      expect(sheet.sheetHeight, state).toBe(
        sheet.rows * sheet.frameHeight + (sheet.rows - 1) * sheet.gutter
      );
      expect(sheet.frameDurationsMs, state).toHaveLength(sheet.frameCount);
      expect(sheet.frameDurationsMs.every((value) => value > 0), state).toBe(true);
      expect(Number.isInteger(sheet.plays), state).toBe(true);
      expect(sheet.plays, state).toBeGreaterThanOrEqual(0);
    }
  });

  it("preserves an authorized source copy without breaking the legacy runtime", () => {
    expect(existsSync("assets/calico-source/calico-idle.apng")).toBe(true);
    expect(existsSync("public/calico/calico-idle.apng")).toBe(true);
  });
});
```

**Step 2: Run the test and verify failure**

Run:

```bash
npm test -- src/overlay/calicoSheetManifest.test.ts
```

Expected: FAIL because `public/calico/sheets/manifest.json` does not exist.

**Step 3: Add the generator**

Create `scripts/generate-calico-sprite-sheets.mjs` with these responsibilities:

```js
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const root = process.cwd();
const calicoDir = join(root, "public", "calico");
const sourceDir = join(root, "assets", "calico-source");
const outputDir = join(calicoDir, "sheets");
const sourceManifest = JSON.parse(
  readFileSync(join(sourceDir, "manifest.json"), "utf8")
);

function readApngPlayCount(path) {
  const png = readFileSync(path);
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    if (type === "acTL") {
      return png.readUInt32BE(offset + 12); // num_plays; 0 means infinite
    }
    offset += 12 + length;
  }
  throw new Error(`Missing APNG acTL chunk: ${path}`);
}

const ffmpegVersion = execFileSync("ffmpeg", ["-version"], { encoding: "utf8" })
  .split("\n")[0];
const ffprobeVersion = execFileSync("ffprobe", ["-version"], { encoding: "utf8" })
  .split("\n")[0];

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const states = {};
for (const [state, entry] of Object.entries(sourceManifest.states)) {
  const input = join(sourceDir, entry.file);
  const stream = JSON.parse(execFileSync("ffprobe", [
    "-v", "error",
    "-count_frames",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,nb_read_frames",
    "-of", "json",
    input,
  ], { encoding: "utf8" })).streams[0];
  const frames = JSON.parse(execFileSync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_frames",
    "-show_entries", "frame=duration_time",
    "-of", "json",
    input,
  ], { encoding: "utf8" })).frames;

  const frameCount = Number(stream.nb_read_frames);
  const columns = Math.ceil(Math.sqrt(frameCount));
  const rows = Math.ceil(frameCount / columns);
  const gutter = 2;
  const baseName = basename(entry.file, ".apng");
  const temporaryOutput = join(outputDir, `${baseName}-sheet.tmp.png`);

  execFileSync("ffmpeg", [
    "-v", "error", "-y", "-i", input,
    "-vf", `tile=${columns}x${rows}:padding=${gutter}:margin=0:color=black@0`,
    "-pix_fmt", "rgba",
    "-frames:v", "1",
    temporaryOutput,
  ]);

  const hash = createHash("sha256")
    .update(readFileSync(temporaryOutput))
    .digest("hex")
    .slice(0, 12);
  const outputName = `${baseName}-sheet-${hash}.png`;
  renameSync(temporaryOutput, join(outputDir, outputName));

  states[state] = {
    file: `/calico/sheets/${outputName}`,
    pixelFormat: "rgba",
    frameWidth: Number(stream.width),
    frameHeight: Number(stream.height),
    frameCount,
    columns,
    rows,
    gutter,
    strideX: Number(stream.width) + gutter,
    strideY: Number(stream.height) + gutter,
    sheetWidth: columns * Number(stream.width) + (columns - 1) * gutter,
    sheetHeight: rows * Number(stream.height) + (rows - 1) * gutter,
    frameDurationsMs: frames.map((frame) =>
      Math.max(1, Math.round(Number(frame.duration_time) * 1000))
    ),
    plays: readApngPlayCount(input),
  };
}

writeFileSync(
  join(outputDir, "manifest.json"),
  `${JSON.stringify({
    schemaVersion: 1,
    generator: { ffmpegVersion, ffprobeVersion },
    states,
  }, null, 2)}\n`
);
```

Before accepting the generated metadata:

- verify ffprobe returns one positive duration for every frame;
- verify every generated PNG uses IHDR color type 6 (`RGBA`) and the output command explicitly requests `-pix_fmt rgba`, so transparent gutters cannot become opaque/black;
- verify `acTL.num_plays` is preserved exactly (`0` means infinite);
- assert the known finite-play assets remain finite: `collapsing`, `happy`, `mini-alert`, `mini-enter`, `mini-happy`, `mini-peek`, `react-left`, `react-poke`, `waking`, and `yawning`;
- assert known infinite assets such as `idle`, `react-drag`, `sleeping`, and working states remain `plays: 0`;
- record, but do not "correct", differences between APNG intrinsic duration and runtime `durationMs` (for example mini-alert 3500 ms versus runtime 4000 ms, waking 5125 ms versus runtime 5800 ms). The renderer owns intrinsic playback; the motion runtime still owns when it returns to another state.

If any asset omits `duration_time` or `acTL`, stop and handle that asset explicitly in the generator; do not silently write `NaN`, an arbitrary frame rate, or infinite playback.

**Step 4: Add the maintenance script**

Add to `package.json`:

```json
"calico:generate-sheets": "node scripts/generate-calico-sprite-sheets.mjs"
```

Do not add this command to `npm run build`. Generated assets are committed and release builds must remain independent of local ffmpeg installation.

**Step 5: Preserve source assets without switching the runtime, then generate**

Copy every APNG into the source directory. Do not move or remove the public runtime files yet:

```bash
mkdir -p assets/calico-source
cp public/calico/*.apng assets/calico-source/
```

Create `assets/calico-source/manifest.json` from the existing state/file mapping and preserve the existing authorization/source metadata. Leave `public/calico/manifest.json` unchanged in this task.

Run:

```bash
npm run calico:generate-sheets
find public/calico/sheets -type f -print | LC_ALL=C sort | xargs shasum -a 256 \
  > /tmp/prompt-picker-calico-sheets-first.sha256
npm run calico:generate-sheets
find public/calico/sheets -type f -print | LC_ALL=C sort | xargs shasum -a 256 \
  > /tmp/prompt-picker-calico-sheets-second.sha256
diff -u /tmp/prompt-picker-calico-sheets-first.sha256 \
  /tmp/prompt-picker-calico-sheets-second.sha256
npm test -- src/overlay/calicoSheetManifest.test.ts
```

Expected: the two same-toolchain generations are byte-identical and tests PASS; one content-hashed sheet exists for every APNG source state, the manifest records the exact ffmpeg/ffprobe version, play counts and gutters are correct, and the existing APNG runtime still works. A different ffmpeg version may intentionally produce different committed bytes/hashes, but that change is reviewable and never occurs during normal build or packaging.

**Step 6: Check generated size and dimensions**

Run:

```bash
du -sh public/calico/sheets
find public/calico/sheets -name '*.png' -print0 | xargs -0 file | head
npm run build
npm test -- \
  src/overlay/calicoManifest.test.ts \
  src/overlay/calicoMotionRuntime.test.ts \
  src/overlay/calicoIdleDirector.test.ts
git restore --worktree -- dist
git diff --quiet -- dist
```

Expected:

- `public/calico/sheets` is at most 25 MiB compressed on disk;
- no sheet exceeds the grid dimensions described by metadata;
- generated sheet filenames contain their content hash;
- every existing Calico test still passes and the intermediate commit continues shipping APNG intentionally.

The final release-size budget is checked only after Task 9 removes the public APNG copies. Do not judge final package delta from this intentionally duplicated intermediate commit.

**Step 7: Commit**

```bash
git add package.json scripts/generate-calico-sprite-sheets.mjs \
  assets/calico-source public/calico/sheets \
  src/overlay/calicoSheetManifest.test.ts
git commit -m "build: generate calico motion sprite sheets"
```

---

### Task 6: Specify a Bounded Canvas Frame Renderer

**Files:**
- Create: `src/overlay/calicoFrameRenderer.test.ts`
- Later create: `public/calico/frame-renderer.js`

The renderer and surface loaders must be dependency-injected so unit tests do not rely on jsdom Canvas or image decoding. Unit tests specify ownership and timing; Task 4 and Task 11 cover real WebViews.

**Step 1: Specify the two releaseable surface backends**

Add tests for a common surface contract:

```ts
type SheetSurface = {
  source: CanvasImageSource;
  release(): void;
};
```

Prove:

- preferred backend calls `createImageBitmap(blob)` and releases with `close()` exactly once;
- compatibility backend loads a static `HTMLImageElement` from a fetched Blob Object URL, then releases with `img.src = ""` and `URL.revokeObjectURL()` exactly once;
- backend selection chooses preferred only when the capability probe successfully decodes, draws, preserves alpha, and confirms `typeof bitmap.close === "function"`, not merely when the global `createImageBitmap` name exists;
- a failed load releases every partially allocated Blob URL/surface.

**Step 2: Specify a single-flight latest-wins decode pump**

Issue 2,000 rapid, non-awaited `play()` calls. The fake loader must keep promises unresolved and complete them out of order. Assert after every transition:

```ts
expect(renderer.diagnostics().pendingDecodeCount).toBeLessThanOrEqual(1);
expect(renderer.diagnostics().decodedSheetCount).toBeLessThanOrEqual(2);
expect(renderer.diagnostics().liveSurfaceCount).toBeLessThanOrEqual(2);
```

The pump contract is:

- at most one decode/fetch is active;
- before starting an uncached third sheet, evict any non-active cached sheet so the active surface plus incoming replacement can never exceed two live decoded surfaces;
- only the newest queued request is retained;
- a superseded active fetch is aborted where supported;
- if an unabortable stale decode resolves, release it immediately and never draw it;
- requests for an already cached surface do not start another decode.

This test must not sequentially `await renderer.play()` because that would hide the actual overlap bug.

**Step 3: Specify playback and timer semantics**

Use fake timers and add tests proving:

- `plays: 0` loops indefinitely using intrinsic per-frame durations;
- `plays: 1` and other finite counts stop on and retain the final frame after the requested play count;
- a repeated request for the current state restarts at frame zero only when runtime metadata has `replay: true`; `replay: false` keeps the current animation phase;
- runtime auto-return may replace that final frame earlier, but the renderer never restarts a finite animation by modulo arithmetic;
- only one deadline `setTimeout` is active for the next source frame;
- no timer exists while showing the baseline or holding a finite final frame;
- no permanent `requestAnimationFrame` loop is created;
- when a fake timer fires several source durations late, the renderer derives the current frame/play count from monotonic total elapsed time, skips expired frames in one bounded calculation, and schedules only the next future deadline;
- after a long delay, an infinite action lands at `elapsed % totalDuration`, while a finite action clamps to its correct frame/final frame without a zero-delay callback storm.

**Step 4: Specify frame geometry and display density**

Add pure geometry tests for source frames sized `266x200` and `355x200` drawn into a square canvas. Assert contain-fit destination rectangles preserve aspect ratio, center the image, use generated `strideX`/`strideY` without sampling neighboring cells, and never stretch it. Presentation transforms have one owner: `renderer.setPresentation({ scale, offsetX, offsetY })` updates the existing CSS variables on the canvas; `drawFrame` performs contain-fit only and never applies scale/offset.

Because assigning `canvas.width/height` clears all visible pixels, specify DPR changes as a prepared transaction. `prepareBackingStoreResize(nextDpr)` renders the current frame into the one scratch canvas at the new backing dimensions without touching the visible canvas and returns a generation-bound token. Integration hides/marks the native window unready and awaits the accepted hide result, then `commitPreparedResize(token)` revalidates the token, resizes the visible backing store, commits the prepared scratch frame, and reports ready true. Preparation/hide failure leaves the old visible canvas/resolution untouched. Add tests that this flow changes backing resolution without changing CSS size, scale, offset, pointer hit area, or native 288 px bounds, and that stale tokens/context loss cannot commit.

**Step 5: Specify atomic visual replacement and failure behavior**

Add tests proving:

- a new sheet is not drawn until loading succeeds;
- a motion load failure leaves the previous valid canvas frame/baseline visible;
- each candidate frame is fully rendered into one fixed-size off-DOM scratch canvas before the visible canvas is touched; that scratch canvas is allocated once per renderer, resized only with the backing store, never appended to DOM, and never recreated per frame;
- visible replacement uses one identity-transform `drawImage(scratchCanvas, 0, 0)` with `globalCompositeOperation = "copy"` and no preceding visible-canvas `clearRect`;
- a source-to-scratch draw exception leaves the prior visible pixels and `visualReady` unchanged;
- a scratch-to-visible commit exception transitions renderer state to lost, invokes the fatal-render callback once, stops its timer, and never claims a valid visible frame;
- repeated failures do not accumulate timers, pending loads, surfaces, or Object URLs;
- a baseline load failure is reported through the renderer error callback and `visualReady` remains false, so overlay integration can hide the click-blocking native window rather than leave a transparent 288 x 288 blocker;
- `suspend({ retainFrame: true })` cancels timers/pending work, evicts non-active surfaces, and keeps the last canvas pixels/current-frame metadata; `resume()` or `redrawCurrentFrame()` restores one frame without creating another renderer or listener;
- there is exactly one canvas; no fallback image layer is introduced.

This is atomic frame retention inside one renderer, not a second visual fallback.

**Step 6: Run tests and verify failure**

Run:

```bash
npm test -- src/overlay/calicoFrameRenderer.test.ts
```

Expected: FAIL because `public/calico/frame-renderer.js` does not exist.

---

### Task 7: Implement the Bounded Canvas Frame Renderer

**Files:**
- Create: `public/calico/frame-renderer.js`
- Test: `src/overlay/calicoFrameRenderer.test.ts`
- Modify: `tests/fixtures/calico-runtime-surface-probe.html`
- Modify: `scripts/run-calico-webview-probe.mjs`

**Step 1: Implement the releaseable surface loaders and capability selection**

Implement two loaders behind one `SheetSurface` contract:

- `loadImageBitmapSurface`: fetch static PNG, decode with `createImageBitmap`, release with idempotent `bitmap.close()`;
- `loadHtmlImageSurface`: fetch static PNG, create Object URL, wait for `decode()` or `load`, release with idempotent `img.src = ""` and `URL.revokeObjectURL()`.

Capability selection must perform an actual tiny decode/draw probe once per WebView and cache only the backend choice, not decoded motion sheets. Export the shared probe function so the Task 4 fixture imports the production `frame-renderer.js` and tests the exact loaders used by the App. If preferred probing fails, log once and use the compatibility backend. If both fail, report a renderer initialization error; do not create a second image layer or silently raise the OS requirement.

Extend the Task 4 real-WebView fixture after the production renderer exists: run rapid non-awaited state changes against the three runner-generated App-protocol probe PNGs through the selected production backend, include snapshots/maxima for `decodedSheetCount`, `liveSurfaceCount`, `pendingDecodeCount`, `queuedRequestCount`, `activeTimerCount`, `state`, and `visualReady` in `rendererDiagnostics`, then dispose and report all zero/released post-dispose counts. This is the authoritative built-WebView diagnostics source; do not add a user-facing diagnostics panel or a production heartbeat.

In the same task, tighten `run-calico-webview-probe.mjs`: `rendererDiagnostics` must now be non-null; fail unless peak decoded/live surfaces are `<= 2`, peak pending/queued decode and active timer counts are `<= 1`, no stale generation drew, and post-dispose decoded/live/pending/queued/timer counts are zero with every Object URL revoked. The runner must print those maxima in both local and Windows artifact logs.

Raw modules under `public/calico` are copied verbatim. Keep their syntax within the oldest supported WebKit parser and make the real-WebView probe import the production `frame-renderer.js` after this task, so syntax/API failures are caught rather than hidden by Vite's main bundle target.

**Step 2: Implement explicit ownership and single-flight loading**

Export:

```js
export function createCalicoFrameRenderer({
  canvas,
  maxDecodedSheets = 2,
  loadSurface = defaultLoadSurface,
  drawFrame = defaultDrawFrame,
  setTimer = globalThis.setTimeout.bind(globalThis),
  clearTimer = globalThis.clearTimeout.bind(globalThis),
  now = () => performance.now(),
  onError = console.error,
} = {}) {
  let generation = 0;
  let frameTimer = 0;
  let pendingDecode = null;
  let queuedRequest = null;
  let activeState = "";
  let activeFile = "";
  const decoded = new Map();

  // play(), showBaseline(), stop(), suspend(), resume(),
  // redrawCurrentFrame(), prepareBackingStoreResize(),
  // commitPreparedResize(), dispose(), diagnostics()
}
```

Implement the following ownership rules:

- `play()` increments `generation`, retains only the newest queued request, and never launches a second concurrent decode.
- When the active load settles, release it if stale, then start only the latest queued request.
- Use `AbortController` for superseded fetches; still handle unabortable decode completion safely.
- Before an uncached load begins, evict non-active entries until `cached surfaces + incoming resolved surface <= maxDecodedSheets`; the active surface is retained until the replacement's first frame is ready.
- The LRU map and any resolved pending surface together contain at most `maxDecodedSheets` live decoded surfaces.
- Eviction cancels no active draw; never evict the current sheet before the replacement is ready.
- Every eviction calls `surface.release()` once.
- `suspend({ retainFrame: true })` increments generation, aborts pending work, clears the queued request/timer, releases non-active cached surfaces, retains at most the active surface/current-frame metadata, and does not clear the visible canvas.
- `resume()` reacquires/resizes the context if needed and calls `redrawCurrentFrame()`; it starts timing again only after a successful redraw.
- `dispose()` increments generation, aborts the active request, clears the queued request and timer, releases all surfaces, clears the map/current-frame metadata, and clears the canvas. It is for actual teardown, not ordinary native hide or reversible page suspension.
- Replaying a cached state resets frame index and elapsed time only when the caller requests restart (`replay: true`); otherwise it preserves the current phase without changing the file URL.
- `diagnostics()` reports `backend`, `state` (`initializing`, `ready`, `suspended`, `lost`, or `disposed`), `decodedSheetCount`, `liveSurfaceCount`, `pendingDecodeCount`, `queuedRequestCount`, `activeTimerCount`, and `visualReady`.

**Step 3: Implement exact frame timing**

Use accumulated `frameDurationsMs`, a monotonic action start time, and cumulative frame boundaries, not a fixed FPS or permanent RAF. On every callback:

1. compute total monotonic elapsed time from the action start rather than assuming the previous timeout fired on time;
2. for `plays: 0`, derive elapsed-in-cycle with modulo total duration;
3. for finite `plays`, clamp total elapsed to the requested play count and hold the final frame when complete;
4. find the current frame from cumulative duration boundaries, skipping every expired frame without scheduling intermediate callbacks;
5. compute `sourceX` and `sourceY` from `columns` and frame index;
6. draw one frame through the scratch/commit path;
7. schedule exactly one `setTimeout` for the next future boundary only while the generation remains current.

Never apply modulo selection to a finite animation. A baseline and a held final frame have zero active timers. The source assets are mostly around 8 FPS, so a 60 Hz callback loop is unnecessary CPU and battery work.

**Step 4: Implement contain-fit drawing and DPR updates**

Compute the source cell from `strideX`/`strideY`, excluding the transparent gutter, then compute a contain-fit destination rectangle inside the logical canvas. Preserve source aspect ratio and center it. Add `setPresentation()` to update existing `--calico-scale`, `--calico-offset-x`, and `--calico-offset-y` CSS variables on the canvas; drawing must not apply those values again.

Implement DPR changes through `prepareBackingStoreResize` / `commitPreparedResize`, never by directly assigning visible canvas dimensions from a resize/display callback. Preparation uses the same single scratch canvas and current-frame metadata. Commit is allowed only after integration has received an accepted current-instance ready-false/hide outcome; it revalidates renderer generation before setting backing dimensions and copying the prepared frame. If commit fails, remain lost/unready and keep the native window hidden. CSS dimensions and native window bounds remain stable.

**Step 5: Keep one static baseline renderer**

Load a versioned `/calico/calico-idle-follow.svg?v=<CALICO_ASSET_VERSION>` into an off-DOM `Image` object once and draw it into the same canvas. Generated sheet filenames are content-hashed and immutable; sheet and behavior manifests are fetched with the same App asset version and `no-store`. Do not append the baseline image to the document. The canvas remains the only visible surface.

The baseline image is static and is not part of the decoded motion-sheet LRU. Its loaded frame remains on canvas with no timer.

**Step 6: Make frame replacement atomic**

Do not clear the canvas at motion-request time. Keep the previous valid frame until the requested surface is decoded and its first frame is rendered successfully into the bounded off-DOM scratch canvas. Commit the scratch canvas to the same-size visible canvas with one identity-transform `drawImage` under `globalCompositeOperation = "copy"`; restore context state afterward. Never call visible-canvas `clearRect` before that commit. On source/scratch load or draw failure, release partial resources, call `onError`, leave the prior frame untouched, and continue the decode pump. If the visible commit itself throws or the context is lost, transition to `lost`, stop scheduling, call the fatal-render callback, and report `visualReady: false` so overlay/native integration hides the window and begins event-driven restoration. If the initial baseline itself fails, use the same unready path instead of leaving an invisible click blocker.

**Step 7: Run focused tests**

Run:

```bash
npm test -- src/overlay/calicoFrameRenderer.test.ts
npm run test:calico-webview
```

Expected: PASS, including rapid non-awaited transitions, out-of-order completion, total live-surface bounds, both surface backends, finite/infinite/replay playback, zero static timers, error cleanup, contain geometry, gutters, DPR changes, production-module loading, non-null real-WebView diagnostics, bounded maxima, and zero post-dispose ownership counts.

**Step 8: Commit**

```bash
git add public/calico/frame-renderer.js src/overlay/calicoFrameRenderer.test.ts \
  tests/fixtures/calico-runtime-surface-probe.html scripts/run-calico-webview-probe.mjs
git commit -m "feat: add bounded calico canvas renderer"
```

---

### Task 8: Route the Motion State Machine Through the Renderer

**Files:**
- Modify: `public/calico/motion-runtime.js`
- Modify: `src/overlay/calicoMotionRuntime.test.ts`

Tasks 8 and 9 are one atomic migration checkpoint. The new runtime constructor is incompatible with the still-legacy overlay until Task 9 wires the Canvas, so do not commit, push, package, or stop between these tasks.

**Step 1: Rewrite tests around a renderer fake**

Replace image-source assertions with renderer calls. The fake should expose:

```ts
const renderer = {
  play: vi.fn().mockResolvedValue(true),
  showBaseline: vi.fn().mockResolvedValue(true),
  setPresentation: vi.fn(),
  dispose: vi.fn(),
  diagnostics: vi.fn(() => ({
    decodedSheetCount: 1,
    pendingDecodeCount: 0,
    activeTimerCount: 1,
    visualReady: true,
  })),
};
```

Preserve tests for:

- priority and `minUntil` rules;
- force reset;
- default-state fallback;
- auto-return timer;
- drag state with duration zero;
- stale renderer rejection not changing the newer state;
- runtime `durationMs` auto-return remaining independent of sheet intrinsic duration/play count;
- `replay: true` restarting frame timing without new decoding and `replay: false` preserving the current phase;
- scale/offset metadata being applied exactly once through `renderer.setPresentation`;
- all existing motion names.

Delete tests that treat `?replay=` URL changes as desired behavior. The new hard invariant is that replay does not create resource identities.

**Step 2: Run and verify failure**

Run:

```bash
npm test -- src/overlay/calicoMotionRuntime.test.ts
```

Expected: FAIL until runtime accepts `renderer` and sheet metadata.

**Step 3: Replace direct `<img src>` mutation**

Change the runtime constructor to:

```js
export function createCalicoMotionRuntime({
  renderer,
  host,
  manifest,
  sheetManifest,
  now = () => Date.now(),
}) {
  // existing priority/minimum-duration state
}
```

For every accepted state, first call `renderer.setPresentation(entry)`. For the default state call `renderer.showBaseline(entry)`. For every generated motion state, resolve `sheetManifest.states[state]` and call `renderer.play(state, sheetEntry, { restart: entry.replay === true })`. Runtime code must not inspect or load APNG extensions. A repeated active `replay: false` state must not reset the renderer clock.

Delete:

- `REPLAY_SLOT_COUNT`
- `replayCounter`
- `replaySourceFor`
- all `image.setAttribute("src", ...)` calls
- image `error` listeners
- `naturalWidth`-based health checks

Expose `dispose()` and forward it to the renderer.

**Step 4: Preserve synchronous state acceptance**

`apply()` must still return `true` or `false` synchronously so `idle-director.js` does not change. Renderer loading is asynchronous internally and guarded by generation tokens.

**Step 5: Run focused tests**

Run:

```bash
npm test -- src/overlay/calicoMotionRuntime.test.ts
```

Expected: PASS.

**Step 6: Continue directly to Task 9 without committing**

Expected working-tree state: runtime unit tests pass, but the full overlay migration is not yet complete. Do not create a red intermediate commit.

---

### Task 9: Integrate the Single Canvas into the Overlay

**Files:**
- Modify: `public/overlay.html`
- Modify: `public/calico/manifest.json`
- Delete: `public/calico/*.apng`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/windows.rs`
- Modify: `src/overlay/calicoManifest.test.ts`
- Modify: `src/overlay/overlayHtml.test.ts`

**Step 1: Add failing single-surface assertions**

Update the overlay test to require:

```ts
expect(html).toContain('id="calicoCanvas"');
expect(html).toContain('class="calico-sprite"');
expect(html).not.toContain('id="calicoSprite"');
expect(html).not.toContain("calico-action-sprite");
expect(html).not.toContain("sprite.naturalWidth");
expect(html).not.toContain("startOverlayHealthHeartbeat");
expect(html).toContain("calicoMotion?.dispose()");
expect(html).toContain("calicoMotion?.suspend");
expect(html).toContain("set_prompt_button_renderer_ready");
```

Add assertions that `frame-renderer.js` and `/calico/sheets/manifest.json` are loaded through the same versioned asset mechanism as the other Calico modules, that Canvas context-loss/restoration handlers exist, and that `pagehide` does not clear/dispose the visible canvas before native hide acknowledgement.

Update `calicoManifest.test.ts` in this same task to require behavior metadata for every state, the baseline SVG path only for the default state, generated sheet coverage for every non-default rendered state, and no APNG under `public/calico` or `dist/calico`.

**Step 2: Run and verify failure**

Run:

```bash
npm test -- src/overlay/overlayHtml.test.ts
```

Expected: FAIL against the current `<img>` overlay.

**Step 3: Replace the visible image with one canvas**

Replace:

```html
<img id="calicoSprite" class="calico-sprite" ... />
```

with:

```html
<canvas
  id="calicoCanvas"
  class="calico-sprite"
  width="252"
  height="252"
  aria-hidden="true"
></canvas>
```

Keep CSS display size at `126px`; the 252 x 252 backing store provides a 2x default render surface. The renderer should update backing resolution using `devicePixelRatio` when needed without changing layout dimensions.

**Step 4: Load and wire the renderer**

Version-import:

- `/calico/frame-renderer.js`
- `/calico/motion-runtime.js`
- `/calico/idle-director.js`

Fetch:

- `/calico/manifest.json`
- `/calico/sheets/manifest.json`

Create exactly one frame renderer, then pass it to `createCalicoMotionRuntime`.

In this same task, extend `PromptButtonVisibilityState` (or add a narrowly owned `PromptButtonRendererState` under the same managed lifecycle lock) with:

```rust
renderer_ready: bool,
renderer_instance_id: u64,
last_transition_id: u64,
```

Add `set_prompt_button_renderer_ready(renderer_instance_id, transition_id, ready)`. Native code issues a new nonzero renderer instance id every time a missing button WebView is built and appends it to the versioned overlay URL. The overlay increments a local transition id before every async readiness report. Native code accepts a transition only when the instance id is current and the transition id is strictly newer than the last accepted transition. Return a structured accepted/current-state outcome so stale callbacks are observable in tests and diagnostics but harmless.

All renderer-state mutation happens under one short native lock (or equivalent atomically consistent state transition), but the lock must be released before `window.hide/show/navigate`, event emission, logging, or any async wait. The transition function returns a pure action (`Ignore`, `HideCurrent`, or `ShowCurrent`) plus captured renderer instance id, transition id, and visibility generation. Immediately before **every** native hide or show action, reacquire state briefly and verify that the captured instance/transition is still the latest accepted transition and that its ready/desired-visible state still requires that exact action; show additionally re-checks visibility generation. If a newer transition has been accepted, discard the older lock-free action. This prevents state/window lock inversion, Close pet races, and an old hide executing after a newer ready/show.

Change button construction/showing atomically with the Canvas migration:

- a missing button allocates a new renderer instance id, builds one hidden WebView carrying that id, and resets readiness false/transition zero;
- the overlay retries local baseline initialization at most three times with bounded delays `0 ms`, `100 ms`, and `400 ms`;
- after the first successful baseline draw, report ready with the current instance/transition ids; native code shows the existing hidden window only if renderer instance, desired visibility, and visibility generation are still current;
- when the current instance reports ready false, native code sets readiness false and immediately hides an already-visible button window before returning; stale instance/transition reports do nothing;
- on final initialization failure, report ready false, log the concrete asset/backend error, and keep the native window hidden without clearing a still-visible canvas before the hide is applied;
- the presence monitor may build a missing hidden window but never shows an unready renderer;
- a later recoverable motion load/source-to-scratch failure retains the last valid frame and does not change readiness;
- a visible commit failure, Canvas context loss, or failed resume redraw reports ready false and hides the native window until the same renderer successfully redraws;
- a tray/user show request for an existing unready hidden WebView emits `prompt-button-renderer-resume-requested` once so the overlay can retry baseline/current-frame initialization without building another window. It must not create a retry loop in the native presence monitor.

Add renderer-ready lifecycle tests here, not Task 3. Cover current ready true, current ready false hiding a visible window, stale instance true/false, out-of-order transition ids, an accepted old hide action executing after a newer ready/show decision, Close pet racing with ready true, failed initialization followed by one explicit retry, and readiness restoration after a successful redraw. This ensures the legacy overlay remains visible until the exact commit that teaches the new overlay to report readiness.

Add App-level page/process hooks using the Tauri 2.11 APIs already present in this dependency version:

- `on_page_load`: when the `Prompt Button` page starts loading, keep its current native window hidden/unready; page-finished alone never shows it because only a successful Canvas readiness report may do so;
- `#[cfg(target_os = "macos")] on_web_content_process_terminate`: when the terminated WebView label is `Prompt Button`, atomically allocate a fresh renderer instance id and reset transition/readiness under the short state lock, then release it and queue one main-thread closure that revalidates the captured instance, hides the existing native window, and navigates that same WebView to the versioned overlay URL containing the new id;
- ignore termination events for main/popover WebViews in this task and preserve their existing behavior;
- do not add a liveness timeout, healthy-age reload, close/build replacement, or speculative periodic recovery.

Extract a shared `handle_prompt_button_webcontent_termination` helper plus pure decisions for label matching and instance rollover so unit tests run cross-platform; add a macOS-gated compile/behavior test for the real termination hook. Add a `#[cfg(debug_assertions)]` command that invokes the same helper for the `Prompt Button` window, enabling the Task 11 built-App interaction test; do not register or expose that command in release builds. The Windows Tauri API does not expose this termination callback, so Windows relies on bounded renderer/context recovery and the real WebView2/soak gates rather than an untestable imitation.

**Step 5: Atomically switch runtime metadata and remove shipped APNG**

After the Canvas successfully consumes both manifests:

1. remove APNG `file` paths from non-default runtime behavior entries while preserving `replay`, priority, duration, minimum duration, scale, and offsets;
2. keep the versioned baseline SVG reference for `idle-follow`;
3. run `git rm public/calico/*.apng`;
4. verify every removed APNG has an identical authorized copy under `assets/calico-source` before deletion;
5. verify content-hashed sheets cover every removed runtime state.

Do not delete public APNG before the Canvas/runtime path is wired in this task.

**Step 6: Remove obsolete health/rebuild signals**

Delete from `public/overlay.html`:

- `OVERLAY_HEARTBEAT_MS`
- `overlayStartedAt`
- `lastUserInteractionAt` only if no other behavior uses it
- `isSafeToRebuildPromptButtonNow`
- `emitOverlayHeartbeat`
- `startOverlayHealthHeartbeat`
- `startCalicoSpriteHealthWatchdog`
- `prompt-button-health` emission

The canvas renderer's ownership tests replace the invalid DOM-only watchdog. Do not add a hidden fallback image.

**Step 7: Implement reversible renderer/page lifecycle handling**

Add one idempotent lifecycle controller. The exact event wiring is:

```js
window.addEventListener("pagehide", () => {
  reportRendererReady(false); // increments transition id; stale completion is harmless
  calicoIdleDirector?.stop();
  calicoMotion?.suspend({ retainFrame: true });
});

window.addEventListener("pageshow", () => {
  resumeAndReportReady().catch(reportFatalRendererError);
});

calicoCanvas.addEventListener("contextlost", (event) => {
  event.preventDefault?.();
  reportFatalRendererError(new Error("Calico canvas context lost"));
});

calicoCanvas.addEventListener("contextrestored", () => {
  resumeAndReportReady().catch(reportFatalRendererError);
});

window.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    resumeAndReportReady().catch(reportFatalRendererError);
  }
});
```

Subscribe once to the Tauri window scale-factor change event (and re-check `devicePixelRatio` on `pageshow`). When DPR differs, the lifecycle controller pauses frame scheduling without clearing pixels, prepares the current frame at the new backing size, reports ready false and awaits the structured current-instance response confirming the hide transition was accepted, then commits the prepared resize, resumes timing from monotonic elapsed state, and reports ready true. If the readiness command fails/is stale, discard the prepared token, resume the old backing store, and keep the old visible pixels; never resize first. A lifecycle-generation change or context loss invalidates the token. Coalesce repeated scale changes to the latest DPR and run at most one resize transaction at a time.

The lifecycle controller owns a monotonically increasing JS `lifecycleGeneration`. Every initialize/resume attempt captures it and may report ready true only if the generation is still current and the renderer remains in a drawable state. `reportFatalRendererError`, `pagehide`, and a new context-loss event increment the generation before stopping work, so an older async resume cannot finish later, allocate a newer transition id, and incorrectly resurrect readiness.

`reportFatalRendererError` stops scheduling, transitions the renderer to lost/suspended, and reports ready false for the current instance/next transition before attempting any recovery. The native command hides the current visible window; meanwhile the retained prior pixels avoid a transparent interval if the asynchronous invoke is delayed. On platforms that support Canvas context events, use them; on older WebKit, visible-commit exceptions plus `pageshow`, `visibilitychange`, display/DPR updates, and the explicit native resume request cover the same redraw path.

`initializeCalicoMotionOnce` and `resumeAndReportReady` must be idempotent, share one in-flight promise per lifecycle generation, avoid duplicate event listeners/idle directors, reacquire/resize the context, redraw the current valid frame or baseline, and report readiness true only after that draw succeeds and the captured generation is still current. Two simultaneous resume events in one generation share the same work and produce one accepted readiness transition; a context loss during that work invalidates it. Add tests for `pagehide -> pageshow`, context lost/restored, context loss racing an unresolved resume, visible commit failure/recovery, delayed out-of-order ready reports, two simultaneous `pageshow` calls, DPR transaction success/failure/stale token, and an unsupported-context-event path using explicit resume. Do not dispose merely because the native window is hidden; hide/show is not page teardown. Call full `dispose()` only for actual document teardown after the native window is already gone, or in test cleanup.

**Step 8: Preserve every interaction call site**

Verify pointerdown, drag, pointerup, context menu, popover open/close, permission status, autosend status, hover attention, and reset still call the same motion-state APIs. Do not change event names or Tauri commands.

**Step 9: Run the complete atomic-migration test set**

Run:

```bash
npm test -- \
  src/overlay/calicoFrameRenderer.test.ts \
  src/overlay/calicoMotionRuntime.test.ts \
  src/overlay/calicoIdleDirector.test.ts \
  src/overlay/calicoManifest.test.ts \
  src/overlay/calicoSheetManifest.test.ts \
  src/overlay/overlayHtml.test.ts
cd src-tauri && cargo test prompt_button -- --nocapture && cd ..
npm run build
test -z "$(find dist/calico -name '*.apng' -print -quit)"
git restore --worktree -- dist
git diff --quiet -- dist
npm run test:calico-webview
```

Expected: PASS. The App is runnable at this checkpoint, one Canvas is ready before the native window appears, all behavior/runtime tests are green, no APNG ships, and the real-WebView probe imports the production renderer.

**Step 10: Commit Tasks 8 and 9 together**

```bash
git add public/overlay.html public/calico/manifest.json public/calico/motion-runtime.js \
  public/calico/sheets src-tauri/src/lib.rs src-tauri/src/windows.rs \
  src/overlay/calicoManifest.test.ts src/overlay/calicoMotionRuntime.test.ts \
  src/overlay/calicoFrameRenderer.test.ts src/overlay/overlayHtml.test.ts
git add -u public/calico
git commit -m "fix: render calico on one bounded canvas"
```

---

### Task 10: Add Regression Tests for Motion and Window Invariants

**Files:**
- Modify: `src/overlay/calicoManifest.test.ts`
- Modify: `src/overlay/calicoFrameRenderer.test.ts`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/windows.rs`

**Step 1: Guard all motion states**

Add a test that every non-default manifest state can be handed to the renderer and that no state name is removed. Compare the state-name set before and after this task; expected difference is empty.

**Step 2: Guard resource ownership under interruption**

Extend the renderer stress test with a sequence that alternates:

```text
idle motion -> hover -> drag -> reset -> working -> error -> reset
```

Issue all 2,000 transitions without awaiting each `play()`, then resolve fake loads out of order. Assert throughout:

- decoded sheet count never exceeds 2;
- total live decoded surface count, including a resolved replacement, never exceeds 2;
- pending decode count never exceeds 1;
- queued request count never exceeds 1 and represents only the latest request;
- stale loads never draw;
- every evicted/stale surface is released once for both backends;
- dispose leaves decoded sheet count 0;
- there is never more than one frame deadline timer;
- baseline and finite final frames have zero active timers;
- repeated failed loads leave the previous frame visible and do not increase resources;
- source-to-scratch failure never touches visible pixels, while visible-commit failure enters lost state and stops scheduling;
- suspend/resume retains one visible frame, redraws through the same renderer, and does not duplicate listeners or surfaces;
- a timer delayed by multiple loops/plays jumps directly to the elapsed-derived frame or finite final frame with no callback storm.

Add finite/infinite playback assertions using the generated `plays` metadata and contain/DPR geometry assertions for normal, mini, wide, and drag sheets.

**Step 3: Guard native lifecycle simplification**

Add or retain tests proving:

- missing enabled window -> build;
- hidden enabled window -> show;
- visible enabled window -> no-op;
- disabled window -> no-op;
- renderer-not-ready window -> remain hidden;
- current renderer ready false -> an already-visible window is hidden immediately;
- stale renderer instance and out-of-order transition reports -> no state/window change;
- close-vs-in-flight-show -> disabled generation wins;
- monitor reads native memory and never reparses settings on each tick;
- tray/front-end visibility changes emit one synchronized state and unrelated settings writes preserve it;
- persistence failure still applies the current show/hide intent and reports `persisted: false`;
- `popover <-> button-controls` switches reuse the same native window through a non-blocking async waiter, acknowledge the current request id, exclude prompt-data reload from the acknowledgement, and never show stale mode content;
- `pagehide -> pageshow` suspends/resumes exactly one renderer and restores readiness only after redraw;
- context loss, visible-commit failure, and explicit resume request hide while unready and restore the same window after one successful redraw;
- macOS WebContent termination -> hide immediately, roll renderer instance, navigate the same WebView, and show only after the new Canvas reports ready;
- no age, heartbeat, or motion state is an input to the decision.

**Step 4: Run focused tests**

Run:

```bash
npm test -- src/overlay
cd src-tauri && cargo test prompt_button -- --nocapture && cd ..
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/overlay src-tauri/src/lib.rs src-tauri/src/windows.rs
git commit -m "test: lock calico lifetime invariants"
```

---

### Task 11: Verify Functionality, Resource Bounds, and Long-Running Behavior

**Files:**
- No source changes expected.

Use `superpowers:verification-before-completion` before claiming completion.

**Step 1: Run all automated tests**

```bash
npm test
cd src-tauri && cargo test && cd ..
```

Expected: PASS.

**Step 2: Run production builds**

```bash
npm run build
npm run tauri -- build --no-bundle
git restore --worktree -- dist
git diff --quiet -- dist
npm run test:calico-webview
git push origin fix/calico-single-window-renderer
gh workflow run build-windows.yml --ref fix/calico-single-window-renderer
```

Expected: PASS.

Capture and watch the exact Windows run id as in Task 4. Expected: both platforms validate the current App-protocol runtime and the Windows installer builds; compilation alone or a workflow run against the earlier Task 4 commit is not acceptance.

**Step 3: Verify unsafe patterns are gone**

```bash
rg -n "REPLAY_SLOT_COUNT|[?]replay=|aged_out|30 \* 60|rebuild_prompt_button_window|prompt-button-health|naturalWidth" \
  public src src-tauri/src
! rg -n "requestAnimationFrame" public/calico/frame-renderer.js
find dist/calico -name '*.apng' -print
```

Expected: no removed production patterns, no permanent RAF in the frame renderer, and no APNG is shipped. `requestAnimationFrame` remains valid for drag coalescing and the one-shot popover render acknowledgement. Test descriptions may mention removed behavior only when asserting its absence.

**Step 4: Verify scope**

```bash
git diff --stat calico-single-window-base-20260710...HEAD
git diff --check calico-single-window-base-20260710...HEAD
git diff --name-only calico-single-window-base-20260710...HEAD
```

Expected changed areas:

```text
package.json
.github/workflows/build-windows.yml
src-tauri/Cargo.toml
src-tauri/Cargo.lock
scripts/generate-calico-sprite-sheets.mjs
scripts/run-calico-webview-probe.mjs
tests/fixtures/*calico-runtime*
assets/calico-source/*
public/calico/frame-renderer.js
public/calico/motion-runtime.js
public/calico/manifest.json
public/calico/sheets/*
public/overlay.html
src/App.tsx
src/platform/platformApi.ts
src/storage/tauriSettingsStorage.ts
src/storage/tauriSettingsStorage.test.ts
src/shared/settingsStore.test.ts
src/overlay/useInputTargetPolling.test.ts
src/app/App.test.tsx
src/overlay/*Calico-related tests*
src-tauri/src/lib.rs
src-tauri/src/calico_probe.rs
src-tauri/src/windows.rs
docs/plans/2026-07-10-calico-single-window-bounded-renderer.md
```

No prompt data, settings UI layout, import/export, autosend, permission, or release metadata files should change. The scoped `src/App.tsx`/platform changes may only route Close pet and renderer readiness through native lifecycle state and reuse popover mode events.

**Step 5: Verify bundle size and source separation**

If `/tmp/prompt-picker-calico-base-assets-kib` no longer exists, create a disposable worktree at `calico-single-window-base-20260710`, run `npm ci && npm run build` there, record `du -sk dist/calico`, and remove that disposable worktree. Never substitute the current build as its own baseline.

Run:

```bash
du -sk public/calico/sheets
du -sk assets/calico-source
find dist/calico -name '*.apng' -print
BASE_KIB=$(awk 'NR==1 {print $1}' /tmp/prompt-picker-calico-base-assets-kib)
CURRENT_KIB=$(du -sk dist/calico | awk '{print $1}')
DELTA_KIB=$((CURRENT_KIB - BASE_KIB))
printf 'base=%s KiB current=%s KiB delta=%s KiB\n' "$BASE_KIB" "$CURRENT_KIB" "$DELTA_KIB"
test "$DELTA_KIB" -le 15360
git restore --worktree -- dist
git diff --quiet -- dist
```

Expected: sheets <= 25 MiB, no shipped APNG, and release asset delta <= 15 MiB compared with the pre-change build. Record actual numbers.

**Step 6: Run the native interaction matrix**

On the built macOS App verify the normal scenarios below. Run the two explicitly injected renderer/process-failure rows against a debug `tauri build --debug --no-bundle` binary first, then rerun the non-injected rows against the release binary; debug-only commands must be absent from release command registration.

| Scenario | Expected |
|---|---|
| Idle motions cycle | One Calico, no blank frames between motions |
| Hover and press | Existing lift/press behavior remains |
| Drag | One drag Calico, no baseline/action overlap |
| Click | Existing prompt panel opens |
| Right-click | Existing Close pet control opens |
| Close pet | Button hides and native presence monitor does not revive it |
| Re-enable pet | One button window returns at saved position |
| Popover -> right-click -> popover | Same native popover window is reused; correct mode appears each time |
| Prompt selection | Existing paste/paste-and-send path is unchanged |
| Sleep/wake | Calico resumes at the elapsed-derived action frame without fast-forward callback bursts and remains visible/clickable |
| Switch Spaces/displays | Calico remains visible at a valid clamped position |
| Forced renderer suspend/resume in debug build | Existing window hides while unready, redraws one frame, then returns without a duplicate window |
| Injected macOS WebContent termination in debug build | Existing native window hides, the same window id reloads with a new renderer instance, and exactly one Calico returns after readiness |
| Slow linked prompt-library refresh | Popover structural mode appears within the handshake; data refresh completes afterward without timeout |

**Step 7: Verify native window count**

While the App runs, use `CGWindowListCopyWindowInfo` or the existing Swift diagnostic command to count windows owned by Prompt Picker with name `Prompt Button`.

Expected throughout testing: exactly 1 while enabled, 0 visible while disabled. Repeated checks must not produce increasing window IDs without old windows disappearing.

Also confirm repeated prompt-list/button-control mode changes do not create increasing `Prompt Popover` window IDs.

**Step 8: Verify renderer compatibility and visual fidelity**

From the JSON artifacts produced by `npm run test:calico-webview` on macOS WKWebView and Windows WebView2, record:

- selected backend (`ImageBitmap` or compatibility image);
- `decodedSheetCount <= 2`, `liveSurfaceCount <= 2`, `pendingDecodeCount <= 1`, `activeTimerCount <= 1`;
- baseline/final-frame `activeTimerCount == 0`;
- no object URL remains after compatibility-surface eviction/disposal;
- diagnostics return to `state: ready` after suspend/resume and report `state: lost`, `visualReady: false`, and zero timers during an injected visible-commit failure.

Capture screenshots for baseline, normal action, mini action, 355x200 wide action, and drag action on 1x and 2x displays where available. Expected: contain fit matches prior `object-fit: contain`, no stretching, clipping, duplicate image, transparent-edge halo, trails, or layout shift. Move the pet between displays with different scale factors and confirm the canvas backing store updates while its CSS/native bounds remain fixed.

**Step 9: Verify resource plateau**

After a 30-minute warm-up, record the Calico WebContent physical footprint and shared graphics allocation. Continue normal/accelerated motion activity for at least two hours and record again.

Acceptance thresholds:

- decoded-sheet and total-live-surface diagnostics never exceed 2 and pending decodes never exceed 1;
- no monotonic ImageDecoder/thread growth;
- shared graphics allocation does not approach the previous ~586 MiB state;
- post-warm-up physical-footprint growth is no more than 50 MiB over two hours;
- Calico remains visible and clickable.

The exact base footprint varies by macOS/WebKit version, so plateau behavior is the invariant, not a single universal absolute number.

During the accelerated phase, use bursty non-awaited motion requests as well as normal idle use so the single-flight path is exercised.

**Step 10: Run an extended user soak before release packaging**

Leave the App running for at least eight hours, including one sleep/wake cycle and normal prompt use.

Expected:

- Calico does not disappear;
- only one native button window exists;
- no duplicate Calico appears;
- transparent padding does not remain as an orphaned blocking window;
- App restart is not required.

This soak is a release acceptance gate. Source implementation may complete earlier, but do not claim the long-running user problem is empirically closed until this test passes.

**Step 11: Final commit if verification required only test corrections**

```bash
git add <only-files-needed-for-real-verification-fixes>
git commit -m "test: verify long-running calico stability"
```

Do not create an empty commit.

---

## Acceptance Criteria

- The overlay has one visible canvas and no baseline/action image layers.
- The authorized action set and all existing triggers are preserved.
- Runtime capability checks select a working backend on macOS WKWebView and Windows WebView2 without changing supported OS targets.
- The renderer has at most two live decoded sprite-sheet surfaces in total and at most one fetch/decode in flight.
- Stale async loads, partial failures, and evicted sheets are explicitly released for both backends.
- Rapid non-awaited transition stress remains within the decoded, pending, queued, and timer bounds.
- Finite APNG actions hold their final frame; infinite actions loop; `replay` and runtime auto-return behavior remain unchanged.
- Frame deadlines use at most one timer, with zero timers for baseline and finite final frames.
- Delayed callbacks after sleep/throttling derive the correct frame from monotonic total elapsed time and never replay an expired callback backlog.
- Canvas contain geometry, alpha, and scale/offset match the prior visual layout; DPR changes use a hide-confirmed prepared resize so backing-store clearing can never expose a transparent blocking window.
- Candidate frames are rendered off-DOM and committed atomically; a draw failure cannot clear the previous valid visible frame.
- Healthy age never closes or rebuilds the native button window.
- No production function performs same-label close-then-build recovery.
- A macOS WebContent termination uses the positive Tauri termination event to hide and navigate the same WebView with a new renderer instance; healthy WebViews are never periodically reloaded.
- The native monitor only ensures presence according to in-memory desired visibility and renderer readiness.
- Exactly one `Prompt Button` native window exists while enabled.
- Disabled pet state wins over stale/in-flight show work and is never revived by a partial settings write.
- Native and frontend visibility state remain synchronized across tray, main, and popover windows; persistence failure never reverses the current visible intent.
- Prompt-list and button-control modes reuse one prompt-popover window through a non-blocking async handshake and show only after the current structural mode is rendered; prompt-data refresh is not part of the acknowledgement deadline.
- Initial and runtime renderer failures, context loss, and page suspension never leave a transparent click-blocking native window.
- Readiness changes are accepted only from the current renderer instance and newest transition; current ready false hides an already-visible native window.
- `pagehide -> pageshow`, context restoration, and explicit resume reuse exactly one renderer and restore readiness only after a successful redraw.
- APNG sources remain in the repository outside `public`; release builds contain no APNG and remain within the defined size budget.
- Prompt popover, drag, right-click, settings, permissions, prompt data, and autosend behavior remain unchanged.
- Two-hour resource measurements plateau after warm-up.
- Eight-hour user soak passes without disappearance, duplicates, or orphaned click-blocking windows.

## User-Visible Result

```text
Launch Prompt Picker
  -> one Calico appears
  -> motions remain rich and unchanged
  -> completed motions release their decoded resources
  -> the same native window stays alive instead of being periodically replaced
  -> hours later, Calico is still visible and clickable
  -> clicking it still opens the same prompt panel
```

There is no new UI and no maintenance action for the user. The stability improvement is entirely internal.
