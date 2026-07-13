# Prompt Popover Startup, Hover, and WeChat Submit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep the prewarmed prompt popover hidden until the kitten is clicked, provide immediate live hover feedback for prompt rows, and make the installed, calibrated WeChat 4.1.2 reliably paste and submit exactly once when the user selects fill-and-send.

**Architecture:** Preserve the existing non-activating overlay and target-specific autosend architecture. Separate native panel configuration from presentation, use CSS native hover as the sole visual source of truth while retaining React pointer events only for preview behavior, and replace WeChat 4.1.2's hard-coded failed paste verification with recovery-bound target evidence before a single submit event.

**Tech Stack:** React, TypeScript, CSS, Tauri 2, Rust, macOS AppKit/Accessibility APIs, Vitest, Cargo tests.

---

## Scope

This plan addresses three confirmed defects only:

1. The prewarmed prompt popover becomes visible at the top-left during app startup.
2. Moving the pointer over prompt rows does not reliably show visible hover feedback.
3. WeChat can receive pasted text but the backend reports `PasteNotConfirmed` and refuses to press Enter.

## User-visible target behavior

### App startup

```text
Launch Prompt Drawer
        |
        v
Only the kitten is visible
        |
        v
Click kitten -> prompt popover appears beside the kitten
```

There must be no prompt list at `(0, 0)` or in the top-left before the user clicks the kitten.

### Prompt row hover

```text
Pointer outside rows      -> no row highlighted
Pointer enters row A      -> row A highlights immediately
Pointer moves to row B    -> row A clears, row B highlights
Pointer leaves the list   -> all hover highlighting clears
```

Hover must not select, paste, submit, or persist the last-used prompt. Keyboard focus and pressed states must continue to work independently.

### WeChat delivery

```text
Fill only:
focus input -> paste once -> leave text unsent

Fill and send:
focus input -> paste once -> bounded wait -> verify target/focus stability
            -> press Enter exactly once

Target or focus changed:
stop safely -> do not press Enter in another app/window
```

## Invariants and non-goals

- Do not change the successful Codex, Cursor, terminal, Claude, or browser delivery paths.
- Do not add a browser extension or require extra user actions.
- Do not add retries for paste or Enter; retries can duplicate text or messages.
- Do not weaken bundle ID, PID, process identity, window, or focus safety checks.
- `NativeSubmitKey::None` remains authoritative: fill-only must never verify for submission or press Enter.
- Enable automatic WeChat submission only for the installed, calibrated WeChat 4.1.2 profile in this plan. Unknown or uncalibrated WeChat versions keep the explicit no-submit capability gate.
- Do not add startup delays, visible loading UI, version bumps, packaging, releases, or unrelated refactors.
- Keep the prompt popover prewarmed for fast first-open performance.

---

## Task 0: Establish the execution baseline

**Files:**
- Read: `src-tauri/src/windows.rs`
- Read: `src-tauri/src/macos_panels.rs`
- Read: `src/ui/PromptQuickList.tsx`
- Read: `src/styles.css`
- Read: `src-tauri/src/platform/macos/input_profiles.rs`
- Read: `src-tauri/src/platform/macos/autosend_transaction.rs`
- Read: `src-tauri/src/platform/macos.rs`

### Step 1: Confirm the branch and worktree state

Run:

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
```

Expected:

- Work is performed on the intended execution branch/worktree.
- Existing unrelated changes, if any, are recorded and left untouched.
- The exact starting commit is captured in the execution notes.

### Step 2: Run focused baseline tests

Run:

```bash
npm test -- src/ui/PromptQuickList.test.tsx src/ui/QuickPickerLayoutStyles.test.ts
cargo test --manifest-path src-tauri/Cargo.toml --lib macos_panels
cargo test --manifest-path src-tauri/Cargo.toml --lib windows
cargo test --manifest-path src-tauri/Cargo.toml --lib input_profiles
cargo test --manifest-path src-tauri/Cargo.toml --lib autosend_transaction
```

Expected:

- Existing tests pass before implementation.
- If a command's test-name filter matches no tests, record that fact and run the containing module's tests without relying on an empty success.

### Step 3: Do not commit

This task establishes evidence only.

---

## Task 1: Keep the prewarmed prompt popover hidden

**Files:**
- Modify: `src-tauri/src/macos_panels.rs`
- Modify: `src-tauri/src/windows.rs`
- Test: `src-tauri/src/macos_panels.rs`
- Test: `src-tauri/src/windows.rs`

The confirmed defect is that `prewarm_prompt_popover()` builds the window with `.visible(false)`, then calls `configure_non_activating_panel()`, whose unconditional `orderFrontRegardless()` makes the supposedly hidden window visible. Configuration and presentation must become separate operations.

### Step 1: Add failing configuration/presentation contract tests

Add source-level contract tests next to the existing macOS panel/window tests that require:

1. The native configuration helper does not call `orderFrontRegardless`.
2. A dedicated presentation helper does call `orderFrontRegardless` after configuration.
3. `prewarm_prompt_popover()` configures the popover but does not present it.
4. The normal show path uses the dedicated presentation helper.

Prefer small helper-body assertions scoped to the relevant function instead of broad file-wide string checks. The tests should fail against the current implementation for the confirmed reason.

### Step 2: Run the focused tests and confirm RED

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib macos_panels
cargo test --manifest-path src-tauri/Cargo.toml --lib windows
```

Expected: the new contract tests fail because configuration still presents the window.

### Step 3: Separate native panel configuration from presentation

In `src-tauri/src/macos_panels.rs`:

- Keep `configure_non_activating_panel` responsible only for native class/style/behavior configuration.
- Remove the unconditional `orderFrontRegardless()` call from configuration.
- Add a narrowly named presentation helper, for example `show_non_activating_panel`, that:
  1. dispatches one atomic configuration-and-presentation operation through `run_on_main_thread_sync`;
  2. applies or confirms non-activating configuration before presentation;
  3. presents the window with `orderFrontRegardless()`;
  4. does not make the panel key or main;
  5. verifies visibility only after the native presentation call completes.

Do not call AppKit window APIs from the caller thread after `configure_non_activating_panel()` returns. Keeping configuration and presentation in separate main-thread dispatches would reintroduce an avoidable ordering gap.

Keep existing runtime assertions that prove `canBecomeKeyWindow == false` and `canBecomeMainWindow == false`.

### Step 4: Route window lifecycle calls correctly

In `src-tauri/src/windows.rs`:

- Make `prewarm_prompt_popover()` build the popover hidden and call configuration only.
- Make `show_non_activating_overlay_window()` call the explicit macOS presentation helper.
- Preserve the non-macOS behavior with `window.show()`.
- Check every current call site so kitten, popover, and status overlays still use the intended helper.
- Do not change popover coordinates, dimensions, focus-target capture, or dismissal behavior.

### Step 5: Run focused tests and confirm GREEN

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib macos_panels
cargo test --manifest-path src-tauri/Cargo.toml --lib windows
```

Expected: all focused tests pass.

### Step 6: Commit the isolated fix

```bash
git add src-tauri/src/macos_panels.rs src-tauri/src/windows.rs
git commit -m "fix: keep prewarmed prompt popover hidden"
```

---

## Task 2: Restore immediate native hover feedback

**Files:**
- Modify: `src/styles.css`
- Modify: `src/ui/PromptQuickList.tsx`
- Modify: `src/ui/QuickPickerLayoutStyles.test.ts`
- Modify: `src/ui/PromptQuickList.test.tsx`
- Modify: `src-tauri/src/macos_panels.rs`
- Test: `src-tauri/src/macos_panels.rs`

The current visual rule is attached only to `.prompt-quick-item.is-hovered`. React adds that class through pointer events, but real NSPanel/WKWebView event delivery does not reliably produce the visual state. CSS `:hover` must become the sole visual hover mechanism. React pointer events remain useful only for delayed full-content/group preview behavior.

Do not keep `.is-hovered` as a second visual source. If pointer-enter is delivered but pointer-leave is missed while the non-key panel hides or loses tracking, that class can remain stuck and override the correct native hover state.

### Step 1: Replace the test that forbids native hover

In `src/ui/QuickPickerLayoutStyles.test.ts`:

- Remove the assertion that `.prompt-quick-item:hover` must not exist.
- Add an assertion that the stylesheet includes `.prompt-quick-item:not(:disabled):hover`.
- Assert that no `.prompt-quick-item.is-hovered` visual selector remains.
- Preserve assertions for compact sizing, focus visibility, active state, and overflow behavior.

### Step 2: Run the focused style test and confirm RED

Run:

```bash
npm test -- src/ui/QuickPickerLayoutStyles.test.ts
```

Expected: the new native-hover assertion fails.

### Step 3: Add native hover without changing interaction behavior

In `src/styles.css`, change the visual selector to the equivalent of:

```css
.prompt-quick-item:not(:disabled):hover {
  /* existing hover border/background declarations */
}
```

Do not change:

- click handlers;
- selection logic;
- prompt submission logic;
- category switching;
- keyboard focus behavior;
- delayed preview timing;
- row dimensions or typography.

Do not add a default highlighted row or persist a last-used highlight.

### Step 4: Remove the redundant React visual-hover state

In `src/ui/PromptQuickList.tsx`:

- remove `hoveredPromptId`;
- stop adding the `is-hovered` class;
- remove calls whose only purpose is setting or clearing that visual ID;
- retain pointer handlers, timers, and `hoverPreview` state only where they drive delayed preview behavior;
- keep `hoverResetKey` cleanup for preview timers and stale keyboard focus;
- keep click, selection, category, and submit handlers unchanged.

Update `PromptQuickList.test.tsx` so it no longer tests a React visual class. Keep tests for preview scheduling, preview cancellation, stale focus cleanup, click behavior, and no hover side effects.

### Step 5: Make native mouse tracking explicit for overlay panels

In `src-tauri/src/macos_panels.rs`, set `acceptsMouseMovedEvents` to true while configuring the non-activating panel. This is idempotent and makes the hover requirement independent of Tao/Wry implementation details.

Add a narrow configuration contract test requiring this call before presentation. Do not change `setIgnoresMouseEvents(false)`, `accept_first_mouse(true)`, panel key behavior, or outside-click monitoring.

### Step 6: Run focused tests and confirm GREEN

Run:

```bash
npm test -- src/ui/QuickPickerLayoutStyles.test.ts src/ui/PromptQuickList.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml --lib macos_panels
```

Expected: all focused tests pass.

### Step 7: Commit the isolated fix

```bash
git add src/styles.css src/ui/PromptQuickList.tsx src/ui/PromptQuickList.test.tsx
git add src/ui/QuickPickerLayoutStyles.test.ts src-tauri/src/macos_panels.rs
git commit -m "fix: restore native prompt hover feedback"
```

---

## Task 3: Add bounded submit evidence for calibrated WeChat 4.1.2

**Files:**
- Modify: `src-tauri/src/platform/macos/input_profiles.rs`
- Modify: `src-tauri/src/platform/macos.rs`
- Test: `src-tauri/src/platform/macos/input_profiles.rs`
- Test: `src-tauri/src/platform/macos.rs`

The current WeChat profile selects `PasteVerificationPolicy::PasteOnlyWithoutSubmitEvidence`. The verifier returns `false` unconditionally for this policy. In fill-and-send mode, the transaction therefore suppresses Enter even when WeChat visibly contains the pasted prompt.

Do not solve this by assigning WeChat to the existing `FocusStableAfterProfiledDelay` policy. Its calibrated implementation currently proves only that the app is frontmost and exposes a usable window; it does not bind verification to the recovered window or prove editable focus. Its exact-Accessibility implementation also cannot pass when no expected composer is supplied. Reusing it would create both false-positive and false-negative behavior.

### Step 1: Add failing profile tests

Add tests that require:

1. WeChat 4.1.2 keeps its existing calibrated focus point.
2. WeChat 4.1.2 uses a dedicated recovered-target verification policy rather than the existing generic stable-focus policy.
3. Unknown and uncalibrated WeChat versions remain `PasteOnlyWithoutSubmitEvidence` and cannot enter the submit phase.
4. Behavioral snapshots for Codex, Cursor, terminal, Claude, and browser profiles remain unchanged.

Add a generic policy variant that is initially assigned only to calibrated WeChat 4.1.2:

```rust
PasteVerificationPolicy::RecoveredTargetStableAfterDelay {
    delay_ms: 220,
}
```

This policy name is deliberate: it is submit-safety evidence for a target with unreadable input content, not proof that AX exposed the pasted value. Do not call it content confirmation.

### Step 2: Run focused profile tests and confirm RED

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib input_profiles
```

Expected: the WeChat policy assertions fail against the current fixed-false policy.

### Step 3: Change only the WeChat paste-evidence policy

In `src-tauri/src/platform/macos/input_profiles.rs`:

- Assign `RecoveredTargetStableAfterDelay { delay_ms: 220 }` only when `observed_version == Some("4.1.2")`.
- Preserve WeChat 4.1.2's calibrated point (`50%` horizontal, `65px` from the bottom) and all focus-acquisition parameters.
- Keep unknown and uncalibrated WeChat versions on `ExactAccessibility` plus `PasteOnlyWithoutSubmitEvidence`.
- Keep `PasteOnlyWithoutSubmitEvidence` as an explicit capability gate.
- Keep `permits_submit()` (or replace it with an equivalently explicit pure helper) and update its tests so 4.1.2 is permitted while unknown versions are not.
- Keep `NativeSubmitKey::None` as the transaction-level authority that structurally skips all submission work.

Do not alter profiles for other applications.

### Step 4: Capture recovery-time evidence before paste

In `src-tauri/src/platform/macos.rs`, add a small transaction-scoped evidence value for `RecoveredTargetStableAfterDelay`, for example:

```rust
struct RecoveredTargetEvidence {
    bundle_id: String,
    pid: u32,
    launch_identity: ProcessLaunchIdentity,
    window: TargetWindowIdentity,
    focused_editable: Option<FocusedEditableIdentity>,
}
```

`FocusedEditableIdentity` must identify the AX object without requiring its frame to remain unchanged. Prompt insertion can legitimately increase the WeChat composer height, so reusing `ComposerFingerprint` frame equality after paste would create a false focus-loss failure for long prompts.

Prefer, in order:

1. equality of the retained AX element object plus owner PID;
2. stable owner PID, role, subrole, and identifier hash when object equality is unavailable.

Do not use post-paste frame equality as editable identity. Frame may be recorded for diagnostics, but it is not a rejection criterion after content insertion.

Populate it after the target app is activated and the calibrated click completes, but before the clipboard is changed or paste is posted.

Evidence requirements:

- read the live focused window after recovery; do not reuse an unverified stale session window;
- require the live window to belong to the captured target PID;
- retain the existing captured bundle ID and process launch identity;
- attempt to capture a focused editable fingerprint from the trusted WeChat process group without requiring `AXValue` or selected-text access;
- treat focused editable evidence as optional only because WeChat may expose a successful input focus without readable AX content;
- never synthesize a successful evidence record when the live window cannot be read.

Add pure comparison tests for PID, launch identity, window role/frame, and optional focused editable fingerprints. Use the existing frame tolerance rather than exact floating-point equality.

Name the focused tests so the planned filter is non-empty, including at least:

- `recovered_target_evidence_rejects_process_replacement`;
- `recovered_target_evidence_rejects_window_change`;
- `recovered_target_evidence_allows_composer_resize`;
- `recovered_target_evidence_rejects_focused_element_change`;
- `recovered_target_evidence_allows_known_wechat_without_ax_editable_when_window_is_stable`.

The last test is required because it exercises the exact degraded-evidence path needed by the installed WeChat build. Pair it with a profile test proving that no unknown WeChat version or non-WeChat profile can select this policy.

### Step 5: Verify the same recovered target after paste

After the profile-owned `220ms` delay, `RecoveredTargetStableAfterDelay` must prove:

- the captured bundle ID still matches;
- PID and process identity still match;
- the current live window matches the recovery-time window, not merely that some usable WeChat window exists;
- if a focused editable identity was observable after recovery, the same AX element (or the same stable non-geometric identity) remains focused after paste;
- if AX cannot expose an editable fingerprint, the known 4.1.2 calibrated profile may rely on the same frontmost process plus the same recovery-time window; no other app/version may inherit this degraded evidence.

It must not require reading WeChat's input value through Accessibility APIs, because WeChat may not expose that value even after a successful paste.

It must not treat elapsed time, a successful synthetic click, or the existence of any WeChat window alone as proof. Any observable target/window/focus change prevents Enter.

Use the same recovered-evidence comparison in both places where the transaction can authorize progress after recovery:

1. the post-paste verification callback after the bounded delay;
2. the transaction's final target/focus revalidation immediately before posting Enter.

The second check must not fall back to the old calibrated rule of “frontmost process plus any usable window.” This closes the race where the post-paste check succeeds but the user changes to another WeChat window before the final submit phase.

Do not tighten or otherwise change the existing calibrated verification path used by Claude and browsers in this task. The new evidence branch is isolated to the new policy.

### Step 6: Use the profile-owned delay without changing other profiles

Add a pure helper that derives the post-paste verification delay from `PasteVerificationPolicy`.

- `RecoveredTargetStableAfterDelay { delay_ms }` returns its profile-owned delay.
- Existing policies retain their current effective `220ms` behavior.
- Existing `FocusStableAfterProfiledDelay { min_ms, max_ms }` must continue to resolve to `220ms` clamped within its current bounds, preserving current Claude/browser timing while making the bounds real rather than dead fields.

Add unit tests for each policy. Do not move sleeps into shared code in a way that changes the number or ordering of paste/submit events.

### Step 7: Run focused tests and confirm GREEN

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib input_profiles
cargo test --manifest-path src-tauri/Cargo.toml --lib recovered_target
```

Expected:

- WeChat 4.1.2 uses recovery-bound target evidence.
- Unknown WeChat versions retain the no-submit capability gate.
- Other application policies remain unchanged.
- The fixed-false behavior is gone only for calibrated WeChat 4.1.2.

### Step 8: Commit the isolated profile fix

```bash
git add src-tauri/src/platform/macos/input_profiles.rs src-tauri/src/platform/macos.rs
git commit -m "fix: verify calibrated WeChat submit target"
```

---

## Task 4: Lock down one-paste/one-submit transaction behavior

**Files:**
- Modify: `src-tauri/src/platform/macos/autosend_transaction.rs`
- Test: `src-tauri/src/platform/macos/autosend_transaction.rs`
- Verify: `src/App.tsx`
- Verify: `src/shared/i18n.ts`

### Step 1: Add transaction-level regression tests

Add or strengthen tests proving:

1. `submit_key != None` plus successful post-paste verification performs exactly one paste and exactly one submit.
2. Failed content-change verification performs exactly one paste and zero submits and returns `PasteNotConfirmed`.
3. `submit_key == None` performs exactly one paste, skips submit verification, and performs zero submits.
4. A recovered target/window change before submit performs zero submits and returns `TargetChanged`.
5. A previously observable focused editable mismatch performs zero submits and returns `FocusNotAcquired`.
6. Unknown WeChat versions never reach paste-and-submit through the calibrated 4.1.2 policy.
7. The existing Claude/browser verification result and timing remain unchanged.
8. No branch retries paste or submit.
9. Calibrated WeChat 4.1.2 with no readable AX editable identity, but the same process identity and recovery-time window, performs exactly one submit.
10. The same missing-AX condition cannot authorize submission for an unknown WeChat version or another profile.
11. Changing to another WeChat window after post-paste verification but before the final submit validation performs zero submits and returns `TargetChanged`.

Use counters or recorded calls in the existing fake transaction dependencies. Assert exact counts, not only final status.

### Step 2: Let post-paste verification report an accurate failure reason

The current transaction accepts a boolean `verify_paste()` callback and maps every `false` result to `PasteNotConfirmed`. That is inaccurate for the new recovered-target policy, where failure means the target window or focus changed rather than that readable content failed to change.

Replace the boolean contract with a small typed result, for example:

```rust
enum PostPasteVerification {
    Confirmed,
    Rejected(TransactionFailure),
}
```

Requirements:

- value/hash or selection evidence failures return `PasteNotConfirmed`;
- recovered app/PID/window mismatches return `TargetChanged`;
- an observable focused editable mismatch returns `FocusNotAcquired`;
- `NativeSubmitKey::None` does not invoke the callback at all;
- a confirmed result proceeds to the final target/focus validation; for `RecoveredTargetStableAfterDelay`, that final validation reuses the same recovery-bound evidence before posting exactly one submit event;
- do not add a retry or a second paste/submit path.

Update all in-module fakes and callers explicitly. Do not use a boolean plus a hidden mutable side channel for the failure reason.

### Step 3: Run transaction tests and inspect RED/GREEN honestly

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib autosend_transaction
```

Expected:

- If existing transaction behavior already satisfies the contract, tests pass without production changes.
- If a new test fails, make only the smallest transaction change needed to satisfy the stated contract.

### Step 4: Preserve user-facing status semantics

Verify without changing copy unless a test proves it is wrong:

- successful fill-only reports the existing filled/copied success state;
- successful fill-and-send reports the existing submitted success state;
- genuine verification failure can still report `PasteNotConfirmed`;
- recovered WeChat target/window changes report the existing target-changed state;
- observable WeChat editable-focus loss reports the existing focus failure state;
- WeChat 4.1.2 no longer reports `PasteNotConfirmed` merely because its input value is inaccessible.

Do not remove the general `paste_not_confirmed` i18n strings while other verification policies can still legitimately emit that result.

### Step 5: Run frontend status tests

Run:

```bash
npm test -- src/app/App.test.tsx
```

Expected: existing status mapping remains correct.

### Step 6: Commit the transaction contract and coverage

```bash
git add src-tauri/src/platform/macos/autosend_transaction.rs
git add src-tauri/src/platform/macos.rs
git commit -m "fix: report post-paste verification failures accurately"
```

---

## Task 5: Run full automated verification

**Files:**
- Verify only; do not modify unrelated files.

### Step 1: Run formatting checks

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
git diff --check
```

Expected: no formatting or whitespace errors.

### Step 2: Run all frontend tests and build

```bash
npm test
npm run build
```

Expected: all tests pass and the production frontend build succeeds.

### Step 3: Run all Rust library tests

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Expected: all Rust library tests pass.

### Step 4: Run Clippy if the repository's current baseline supports it

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Expected: no warnings. If pre-existing unrelated warnings prevent this command from passing, record the exact warnings and do not modify unrelated code.

### Step 5: Review scope and commit history

```bash
git status --short
git diff origin/main...HEAD --stat
git diff origin/main...HEAD -- src-tauri/src/macos_panels.rs src-tauri/src/windows.rs src/styles.css src/ui/PromptQuickList.tsx src/ui/PromptQuickList.test.tsx src/ui/QuickPickerLayoutStyles.test.ts src-tauri/src/platform/macos/input_profiles.rs src-tauri/src/platform/macos.rs src-tauri/src/platform/macos/autosend_transaction.rs
git log --oneline --decorate origin/main..HEAD
```

Expected:

- Only planned files changed.
- No version bump, package artifact, release metadata, or unrelated refactor appears.
- Each commit corresponds to one planned behavior.

---

## Task 6: Perform macOS behavioral verification before acceptance

This task requires a locally built app and direct macOS interaction. It is verification, not additional feature work.

### Step 1: Verify cold startup

1. Quit all Prompt Drawer processes.
2. Launch the freshly built app.
3. Observe every display and Space before clicking the kitten.

Expected:

- The kitten is visible at its saved position.
- No prompt list appears at the top-left or anywhere else.
- The previously frontmost app does not lose key-window status merely because Prompt Drawer launched.

### Step 2: Verify first and repeated popover opening

1. Click the kitten once.
2. Dismiss the popover.
3. Open it repeatedly.

Expected:

- The first open remains fast because the popover was prewarmed.
- The popover appears beside the kitten, never at `(0, 0)`.
- Dismissal and reopening remain correct.
- Clicking the kitten, moving over rows, and clicking a prompt row do not make a Prompt Drawer overlay the macOS key or main window.
- Before prompt selection triggers intentional target recovery, the previously active app keeps its active-window appearance.

### Step 3: Verify live hover

1. Open the prompt list.
2. Move the pointer across several prompt rows without clicking.
3. Leave the list and re-enter.

Expected:

- The row directly under the pointer highlights immediately.
- The previous row clears as the pointer moves.
- No row stays highlighted after leaving.
- Hover causes no selection, paste, send, category switch, or remembered last-used state.

### Step 4: Verify WeChat fill-only

1. Select `Fill only` in settings.
2. Make WeChat the target, click the kitten, and select a prompt.

Expected:

- The prompt appears in the WeChat input exactly once.
- Enter is never pressed.
- The message remains unsent for editing.

### Step 5: Verify WeChat fill-and-send

1. Select `Fill and send` in settings.
2. Make WeChat the target, click the kitten, and select a short test prompt.

Expected:

- The prompt is pasted exactly once.
- After bounded stable-focus verification, Enter is pressed exactly once.
- One message is sent.
- The false `Unable to confirm whether it was filled` status does not appear when the paste and target/focus checks succeeded.

Repeat with a long multiline prompt that visibly grows the composer before submission.

Expected:

- Composer resizing alone does not trigger `FocusNotAcquired` or `TargetChanged`.
- The long prompt is pasted once and sent once.
- A genuinely different focused element or window still blocks Enter.

### Step 6: Verify safety on target change

1. Start a prompt selection for WeChat.
2. Before submission, deliberately switch to another app/window.

Expected:

- The transaction stops.
- No Enter is sent to the new app/window.
- No duplicate paste occurs.

### Step 7: Run the cross-application regression matrix

Verify both fill-only and fill-and-send where supported:

| Target | Expected result |
|---|---|
| Codex | Existing reliable behavior unchanged |
| Cursor | Existing reliable behavior unchanged |
| Terminal/CLI | Existing reliable behavior unchanged |
| Claude app | Existing reliable behavior unchanged |
| Chrome ChatGPT | Existing reliable behavior unchanged |
| Chrome Gemini | Existing reliable behavior unchanged |
| Chrome Manus | Existing reliable behavior unchanged |
| WeChat 4.1.2 | Fill-only leaves text; fill-and-send sends exactly once |
| Unknown WeChat version fixture | Keeps the no-submit capability gate |

Record pass/fail and the exact app/browser versions used. Do not compensate for failures by adding per-app changes outside this plan.

---

## Acceptance criteria

The work is complete only when all of the following are true:

- Cold launch never displays the prompt popover before kitten interaction.
- Prewarming remains enabled and first open remains fast.
- Prompt rows show immediate, pointer-following native hover feedback.
- Hover has no command side effects and does not persist.
- Kitten and prompt popover overlays remain non-key and non-main during interaction.
- WeChat 4.1.2 fill-only pastes once and never submits.
- WeChat 4.1.2 fill-and-send pastes once and submits once after recovery-bound target/focus verification.
- Unknown and uncalibrated WeChat versions remain unable to auto-submit until separately calibrated and verified.
- A changed target/focus prevents submission.
- Codex, Cursor, terminal, Claude, and supported browser paths show no regression.
- Focused and full frontend/Rust tests pass.
- The diff contains no unrelated UI, delivery, version, packaging, or release changes.

## Execution notes

- Execute tasks in order; do not combine all changes into one large edit.
- Stop and investigate if a RED test fails for a different reason than the behavior being introduced.
- After each task, inspect the diff before committing.
- Packaging, notarization, tagging, GitHub Release creation, and pushing to `main` require a separate explicit instruction after this plan is implemented and reviewed.
