# Autosend: Instant Open + Instant Accurate Send Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Click the cat → the prompt popover opens instantly ("秒开"), AND pick a prompt → it pastes and sends instantly and accurately. Both, always, with **no send-time delay**.

**Architecture:** The popover-open path is already instant (cheap freeze in `prepare_prompt_pick_session_target` runs before `show_popover_mode`) and **stays untouched**. All slow target-acquisition runs **entirely in the background** during the user's browsing window and finishes before send.

This plan ships **Phase 1 only** as the actionable work. **Phase 2 is deferred** (documented at the end with the corrected architecture and a trigger condition) — see "Why Phase 2 is deferred" for the rationale.

- **Phase 1 — reliable lightweight background refresh (the fix):** v1.0.17 commit `e28389b` made popover-open instant by moving target capture to a **one-shot** background task that gives up on failure, leaving `window=None`/`page_url=None` at send → ChatGPT clicks 16px high, Claude fails focus. Replace the one-shot with a **bounded lightweight retry loop**: one full capture to establish identity, then a loop that re-reads only the cheap missing pieces (`current_target_window_identity` + `active_browser_page_url`) until the identity is complete or the user picks. The loop does **not** re-run `current_input_target()` or `begin_if_new` on retries, so it adds no redundant AX load and no session-reset race. `finish_capture` fires on completion → `wait_for_capture` at send returns **instantly**.

**Tech Stack:** Rust (Tauri v2), macOS Accessibility APIs (`AXUIElement*`), existing helpers: `current_target_window_identity` ([macos.rs:1254](src-tauri/src/platform/macos.rs:1254), cheap ~10-50ms, no tree traversal), `active_browser_page_url` ([macos.rs:806](src-tauri/src/platform/macos.rs:806)).

---

## Constraints (apply to every task)

- **Branch:** work on `main` only (no feature branches / worktrees). User's standing policy.
- **Never commit:** `dist/`, `src-tauri/target/`. (Verify they're gitignored; they almost certainly are.)
- **Every commit message ends with the trailer:**
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  ```
- **Do not touch the popover-open path's latency.** `prepare_prompt_pick_session_target` + `show_popover_mode` ordering in `show_prompt_popover_from_button` ([windows.rs:909](src-tauri/src/windows.rs:909)) and `toggle_prompt_popover_from_button` ([windows.rs:929](src-tauri/src/windows.rs:929)) stays as-is.
- **No synchronous AX work on the send path.** The send path (`paste_prompt_*_impl` → `recover_target_after_activation`) must gain **zero** new AX calls. The background does the work; send reads precomputed data.
- **No diagnostic logging beyond parity** with the existing single `eprintln!`.
- **Do not fake timing numbers** — measure or omit. Code that calls live `AXUIElement*` is verified by the manual QA matrix; only pure-logic seams are unit-tested.

---

## Root-cause recap

`e28389b` made the popover open instantly by moving target capture off the open path. The cost: capture became **one-shot**. On heavy/slow pages a single `active_browser_page_url` / `current_target_window_identity` attempt fails, the background gives up, and at send the identity is partial (`window=None` for Claude → focus fails; `page_url=None` for ChatGPT → `calibrated_bottom_offset_for_url` returns `None` → offset defaults to `80` instead of `64` → click lands **16px too high**). Codex uses `CodexFirstResponder` and is unaffected.

The fix is **not** to re-block the open path. It is to make the background reliably finish *during browsing* by **retrying** instead of giving up.

---

## Why Phase 1 alone satisfies the goal (no tradeoff)

- **Instant open:** the open path is untouched — Phase 1 adds no synchronous work to it.
- **Instant, accurate send for all human-speed picks:** the background refresh loop completes `window` + `page_url` during the realistic browsing pause (humans must read the list, choose, and click — well over the ~50-500ms the cheap reads take). `finish_capture` has already fired, so `wait_for_capture` returns instantly; the click uses the complete identity (correct offset, correct window).
- **No false tradeoff:** the only residual is a *superhuman* pick faster than the cheap read latency, where `wait_for_capture`'s existing cap is a safe correctness net — not a UX regression for real users.

---

## Phase 1 — Reliable lightweight background refresh

### Task 1: Expose `is_supported_browser`, add completion/consumed checks, add a window setter

**Files:**
- Modify: `src-tauri/src/platform/macos.rs` (add `pub` re-export near the existing private `is_supported_browser` import at line 22)
- Modify: `src-tauri/src/lib.rs` (`impl PromptPickSessionState`, after `finish_capture` ~line 1382, and after `set_page_url_if_current` ~line 1322 for the window setter)
- Test: `src-tauri/src/lib.rs` test module

**Step 1: Write the failing tests**

```rust
#[test]
fn session_is_consumed_reflects_active_session_and_consumed_flag() {
    let state = PromptPickSessionState::default();
    state.begin(7);
    assert!(!state.is_consumed(7));
    assert!(state.is_consumed(8)); // stale session

    let _ = state.take(); // consumed
    assert!(state.is_consumed(7));
}

#[test]
fn set_window_if_current_only_fills_a_missing_window() {
    let state = PromptPickSessionState::default();
    state.begin(11);
    // Populate a frozen identity via the public freeze path used in production.
    // Use prepare_prompt_pick_session_target is AX-bound; instead drive the merge
    // directly. If no test-visible setter exists to seed identity, add a tiny
    // #[cfg(test)] helper `seed_identity_for_test(session_id, identity)` and use it
    // here. (See Step 3 note.)
    // Assert: with window=None, set_window_if_current fills it and returns true;
    // calling again with a different window does NOT overwrite (returns true, window unchanged).
}
```

> **Verify before implementing:** check whether `PromptPickSessionState` exposes a way to seed `identity` from tests. The production path is `set_captured_if_current` (private). If seeding is not possible, add a `#[cfg(test)] fn seed_identity_for_test(&self, session_id, identity: CapturedTargetIdentity)` test-only setter (mirror `set_captured_if_current`'s guards) so the window-setter and completeness logic are unit-testable. This is the only test scaffolding allowed.

**Step 2: Run tests to verify they fail**

```bash
cd src-tauri && cargo test --lib session_is_consumed set_window_if_current -- --nocapture
```
Expected: compile error — methods do not exist.

**Step 3: Add the `pub` re-export in `src-tauri/src/platform/macos.rs`**

`is_supported_browser` is `pub(super)` in `input_profiles` and only imported privately into `macos` (line 22). Add a public wrapper so `lib.rs` can call it:

```rust
/// Public wrapper so callers outside `platform::macos` can ask whether a bundle id
/// is a supported browser (used to decide whether page_url is part of capture completeness).
pub fn target_bundle_is_supported_browser(bundle_id: &str) -> bool {
    is_supported_browser(bundle_id)
}
```

**Step 4: Implement the three methods in `impl PromptPickSessionState` (`src-tauri/src/lib.rs`)**

```rust
/// True when `session_id` is no longer the active, unconsumed session.
/// Used by the background refresh loop to stop as soon as the user picks.
pub fn is_consumed(&self, session_id: u64) -> bool {
    let state = self
        .0
        .inner
        .lock()
        .expect("prompt pick session lock poisoned");
    state.active_session_id != session_id || state.consumed
}

/// True when the captured identity has everything needed to send accurately:
/// window present, and (page_url present OR the target is not a browser).
/// Returns `true` for a stale/consumed session so the loop exits promptly.
pub fn target_capture_complete(&self, session_id: u64) -> bool {
    let state = self
        .0
        .inner
        .lock()
        .expect("prompt pick session lock poisoned");
    if state.active_session_id != session_id || state.consumed {
        return true;
    }
    let Some(identity) = &state.identity else {
        return false;
    };
    let window_ready = identity.window.is_some();
    let page_url_ready = identity.page_url.is_some()
        || !platform::macos::target_bundle_is_supported_browser(&identity.application.bundle_id);
    window_ready && page_url_ready
}

/// Fill a missing window identity for the current session. Parallel to
/// `set_page_url_if_current`. Does NOT overwrite an already-captured window.
pub fn set_window_if_current(&self, session_id: u64, window: TargetWindowIdentity) -> bool {
    let mut state = self
        .0
        .inner
        .lock()
        .expect("prompt pick session lock poisoned");
    if state.active_session_id != session_id || state.consumed {
        return false;
    }
    let Some(identity) = state.identity.as_mut() else {
        return false;
    };
    if identity.window.is_none() {
        identity.window = Some(window);
    }
    true
}
```

**Step 5: Run tests to verify they pass**

```bash
cd src-tauri && cargo test --lib session_is_consumed set_window_if_current -- --nocapture
```
Expected: PASS.

**Step 6: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/platform/macos.rs
git commit -m "feat(prompt-pick): add capture-completion checks and window setter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Replace the one-shot capture with a lightweight bounded refresh loop

This is the core fix. One full capture establishes the identity; a loop then re-reads only the cheap missing pieces until complete/consumed.

**Files:**
- Modify: `src-tauri/src/windows.rs` (`start_prompt_pick_session_capture`, line 674)
- Test: behavioral (the loop spawns live AX; lock the contract via the Task-1 helpers + a non-blocking-spawn assertion).

**Step 1: Add a behavioral test (contract lock)**

```rust
#[tokio::test]
async fn start_prompt_pick_session_capture_does_not_block_and_signals_finish() {
    // The loop spawns and must not run heavy work inline. Real AX behavior is
    // covered by the manual QA matrix; here we lock: spawn is near-instant and
    // a consumed session resolves wait_for_capture quickly.
    let session_state = crate::PromptPickSessionState::default();
    let recent_state = crate::LastInputTargetState::default();
    let session_id = 42;
    session_state.begin(session_id);
    session_state.mark_capture_pending(session_id);

    let started = std::time::Instant::now();
    start_prompt_pick_session_capture(session_id, session_state.clone(), recent_state);
    assert!(started.elapsed() < std::time::Duration::from_millis(50));

    std::thread::sleep(std::time::Duration::from_millis(150));
    let _ = session_state.take(); // consumed → loop exits → finish_capture fires
    let ready = session_state.wait_for_capture(std::time::Duration::from_millis(500));
    assert!(ready);
}
```

> If `#[tokio::test]` isn't wired for this module, run the same assertions through the existing integration harness. If the live-AX spawn makes it flaky in CI, mark `#[ignore]` and rely on the manual matrix; state this in the commit.

**Step 2: Run to establish baseline**

```bash
cd src-tauri && cargo test --lib start_prompt_pick_session_capture -- --nocapture
```

**Step 3: Implement the lightweight loop**

Replace the body of `start_prompt_pick_session_capture` in `src-tauri/src/windows.rs` (line 674) with:

```rust
fn start_prompt_pick_session_capture(
    session_id: u64,
    session_state: crate::PromptPickSessionState,
    recent_state: crate::LastInputTargetState,
) {
    tauri::async_runtime::spawn(async move {
        let result = tauri::async_runtime::spawn_blocking(move || {
            // One full capture to establish identity and recent_state (runs
            // current_input_target() exactly once).
            crate::capture_prompt_pick_session_target(&session_state, &recent_state, session_id);
            // Lightweight refresh: re-read only the cheap missing pieces until the
            // identity is complete or the user picks. No current_input_target(),
            // no begin_if_new on retries.
            run_prompt_pick_session_capture_loop(session_id, &session_state, std::thread::sleep);
            session_state.finish_capture(session_id);
        })
        .await;
        if let Err(error) = result {
            eprintln!("Prompt pick session task failed: {error}");
        }
    });
}

/// Bounded refresh loop. Stops as soon as the captured identity is complete, the
/// session is consumed, or MAX_ATTEMPTS is reached. Each iteration re-reads only
/// the cheap missing fields (window, page_url) — never the full input traversal.
fn run_prompt_pick_session_capture_loop(
    session_id: u64,
    session_state: &crate::PromptPickSessionState,
    mut sleep: impl FnMut(std::time::Duration),
) {
    const MAX_ATTEMPTS: u32 = 10;
    const PACING: std::time::Duration = std::time::Duration::from_millis(250);

    for attempt in 0..MAX_ATTEMPTS {
        if session_state.target_capture_complete(session_id) {
            break;
        }
        if session_state.is_consumed(session_id) {
            break;
        }
        refresh_prompt_pick_session_capture(session_id, session_state);
        if attempt + 1 < MAX_ATTEMPTS {
            sleep(PACING);
        }
    }
}

/// Re-read only the cheap, possibly-missing pieces for the frozen target and
/// merge them via the existing guarded setters.
fn refresh_prompt_pick_session_capture(
    session_id: u64,
    session_state: &crate::PromptPickSessionState,
) {
    let Some(target) = session_state.get() else {
        return;
    };
    let Some(pid) = target.pid else {
        return;
    };
    let bundle_id = target.app.bundle_id.clone();
    if let Some(window) = crate::platform::macos::current_target_window_identity(pid) {
        session_state.set_window_if_current(session_id, window);
    }
    if let Some(page_url) = crate::platform::macos::active_browser_page_url(pid, &bundle_id) {
        session_state.set_page_url_if_current(session_id, &bundle_id, page_url);
    }
}
```

**Why this is correct and adds no send delay:**
- The first full capture establishes identity + recent_state. The refresh loop then fills the cheap gaps; `set_window_if_current` and `set_page_url_if_current` only fill `None` fields (never overwrite).
- `target_capture_complete` flips `true` the moment `window` and (for browsers) `page_url` are present → `finish_capture` fires → `wait_for_capture` at send returns **instantly**.
- `is_consumed` lets the loop exit the moment the user picks (`take`/`take_captured` set `consumed = true` and notify the condvar → `wait_for_capture` returns).
- No `begin_if_new` on retries → no session-reset race. No `current_input_target()` on retries → no redundant AX traversal.
- `MAX_ATTEMPTS × PACING ≈ 2.25s` comfortably covers a realistic browsing window; the loop normally exits early via the completeness check.

> **Verify:** `crate::platform::macos::current_target_window_identity` and `active_browser_page_url` are `pub` and reachable from `windows.rs` via the crate-rooted path (they are called the same way from `lib.rs` as `platform::macos::*`). If the compiler prefers a different path, adjust — do not change behavior.

**Step 4: Run the full test suite**

```bash
cd src-tauri && cargo test --lib -- --nocapture
```
Expected: PASS, including the existing instant-open test (`prompt_popover_open_freezes_immediately_and_enriches_in_background` or its current name).

**Step 5: Commit**

```bash
git add src-tauri/src/windows.rs
git commit -m "fix(prompt-pick): retry target capture during browsing instead of one-shot

Replaces the one-shot background capture from e28389b with a bounded
lightweight refresh loop. Popover still opens instantly; the loop finishes
the cheap window/page_url reads during the user's browsing window and calls
finish_capture so send never blocks. Fixes partial-identity sends for ChatGPT
(wrong offset) and Claude (failed focus) on normal-speed picks.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Manual QA matrix (Phase 1 validation)

**Files:** none.

Build and run on a real target. Record pass/fail per row in the PR description.

| # | Scenario | Speed | Expected |
|---|---|---|---|
| 1 | Click cat → popover opens | — | Opens **instantly** (秒开), no perceptible delay vs. v1.0.16. |
| 2 | ChatGPT (Chrome) pick | normal (~1s+) | Pastes into composer, sends; click inside box (not 16px high). |
| 3 | ChatGPT (Safari) pick | normal | Same as #2. |
| 4 | Claude for Desktop pick | normal | Focus succeeds ("未能聚焦输入框" gone); pastes + sends. |
| 5 | Codex pick | any | Unchanged — still works via `CodexFirstResponder`. |
| 6 | Gemini / Manus (calibrated sites) | normal | Correct offset; pastes + sends. |
| 7 | Send latency feel | normal | Paste+send feels instant (no ~900ms hang). |

> **Honest residual (do not chase in Phase 1):** a *superhuman* ChatGPT pick (< ~500ms after open, before page_url is detected) can still fall back to the default 80px offset. Humans do not pick that fast (read + choose + click), so it is not expected in practice. If a row above fails, file a follow-up — do **not** expand this plan's scope.

**Step:** `cd src-tauri && cargo build` (clean), then run the matrix.

---

### Task 4: Version bump + release notes

**Files:** `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` (keep all three in sync — verify). Do **not** touch `CALICO_ASSET_VERSION`.

**Step 1:** bump per project convention (e.g. `1.0.18`).

**Step 2:** add a release-note line:
```
- Fixed: prompt autosend now reliably pastes and sends for ChatGPT and Claude
  (one-shot capture race from v1.0.17). The popover still opens instantly and
  send is instant, because target capture retries in the background during
  browsing instead of giving up after one attempt.
```

**Step 3:** commit.

```bash
git add -A
git commit -m "chore: bump version to 1.0.18

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 2 — DEFERRED (do not implement now)

**Status:** Deferred. The original Route B design (AX-locate the composer at click time) was reviewed and found to be **broken**: it placed a 100-300ms synchronous AX traversal (`collect_editable_candidates`) inside `recover_target_after_activation`, which is the **send path** — a direct violation of this plan's hard constraint "no synchronous AX on the send path" and of the "send must be instant" goal. It also used private/non-existent types (`EditableRole` is a private enum; `NativeEditableCandidate` exposes role/frame via `.resolver`, not directly) and had a weak "lowest-largest-TextArea" heuristic with no fallback for a wrong selection.

Phase 1 alone fixes the reported bug for all human-speed picks (see "Why Phase 1 alone satisfies the goal"). Phase 2's only additional value is hardening against future UI changes (the `URL → hardcoded offset` table is fragile) and the superhuman-fast-pick edge case — both are YAGNI until evidence shows they're needed.

**Corrected architecture if/when Phase 2 is revived (for reference only — not in scope now):**

1. **Capture the composer in the background, not at send.** Add an optional composer frame field to `CapturedTargetIdentity`. During the Phase-1 background refresh loop, locate the composer via AX (`collect_editable_candidates` on the focused window) and store its frame in the identity. Send reads the stored frame and clicks it — **zero new AX work at send**.
2. **Bounded-radius snap (do not blindly trust the AX pick).** Use the calibrated window point as the anchor. Only snap the click to the composer's center if the composer frame is within a bounded radius of the anchor (e.g. within the lower ~40% of the window and horizontally centered). If no composer is near the anchor, keep the calibrated point. This bounds the blast radius of a wrong AX selection (risk 6) and keeps the calibrated behavior as the fallback.
3. **Type-correct code.** Read `NativeEditableCandidate`/`ComposerCandidate`/`EditableRole` ([macos.rs:455-707](src-tauri/src/platform/macos.rs:455)) before writing any matching code; role is a `String` (e.g. `"AXTextArea"`), accessed via the candidate's resolver.

**Trigger to revisit Phase 2 (any one):**
- Task 3 QA shows a normal-speed miss on a calibrated site.
- A known site (ChatGPT/Gemini/Manus) changes its composer geometry and the offset table breaks.
- Product decides the `URL → offset` calibration table is no longer acceptable as a long-term dependency.

When revisited, write a **new** plan with the corrected background-capture architecture above; do not resurrect the send-time version.

---

## Out of scope (do not do)

- Do **not** revert `e28389b` or move capture back onto the open path.
- Do **not** add any AX call to the send path (including the deferred Phase 2's old design).
- Do **not** implement Phase 2 as part of this plan.
- Do **not** bundle unrelated refactors or add diagnostic logging.
- Do **not** commit `dist/` or `src-tauri/target/`.
