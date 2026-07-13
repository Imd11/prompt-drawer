# Prompt Popover and WeChat Review Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the code-review gaps by preventing non-composer WeChat controls from authorizing Enter and by making unknown WeChat versions downgrade grouped prompts without losing content.

**Architecture:** Keep the existing versioned WeChat 4.1.2 calibrated path and transaction model. Strengthen recovery evidence by validating every observable focused editable through the existing composer resolver, and resolve the target's effective submit capability before the group sequence chooses between one joined paste and per-item submission. Do not change Codex, Cursor, terminal, Claude, browser, startup, or hover behavior.

**Tech Stack:** Rust, Tauri 2, macOS Accessibility APIs, React/TypeScript, Cargo tests, Vitest.

---

## Scope And Invariants

- Modify only the WeChat recovery-evidence path, effective submit-key resolution, grouped-prompt orchestration, tests, and this plan.
- Keep calibrated WeChat 4.1.2 at the existing `50%` horizontal / `65px` bottom-offset click point.
- Keep exactly one paste and at most one Enter for every single transaction.
- Keep unknown and uncalibrated WeChat versions unable to post Enter.
- Preserve `NativeSubmitKey::None` as the transaction authority for fill-only behavior.
- Do not add retries, browser extensions, new UI, copy changes, release metadata, or app-specific changes outside WeChat.
- Do not send a real WeChat message during automated verification.

## Task 1: Establish The Fix Baseline

**Files:**
- Read: `src-tauri/src/platform/macos.rs`
- Read: `src-tauri/src/platform/macos/composer_resolver.rs`
- Read: `src-tauri/src/platform/macos/input_profiles.rs`
- Read: `src-tauri/src/lib.rs`

### Step 1: Record the execution state

Run:

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
```

Expected: the execution worktree is clean before this plan file, and the reviewed task ends at `046c89633ee504b18619c1535b2ec133e5ed904a`.

### Step 2: Run the relevant baseline tests

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib recovered_target
cargo test --manifest-path src-tauri/Cargo.toml --lib input_profiles
cargo test --manifest-path src-tauri/Cargo.toml --lib paste_only_sequence
```

Expected: existing tests pass before the new regressions are added.

## Task 2: Reject Observable Non-Composer WeChat Focus

**Files:**
- Modify: `src-tauri/src/platform/macos.rs:1298-1432`
- Test: `src-tauri/src/platform/macos.rs`

### Step 1: Add failing pure regression tests

Add focused tests proving:

1. A focused `AXTextField` whose description contains `搜索联系人` is not valid recovered composer evidence.
2. A focused lower-window `AXTextArea` with message semantics is valid recovered composer evidence.
3. When recovery had no readable editable but verification later observes a validated composer, the known WeChat degraded path may continue.
4. A semantic search field can never satisfy the `None -> Some` degraded path.

Use a small pure helper around the existing `resolve_composer` contract:

```rust
fn recovered_editable_is_composer(
    candidate: &ComposerCandidate,
    trusted_pids: &[u32],
    window: &CandidateInput,
) -> bool {
    resolve_composer(std::slice::from_ref(candidate), trusted_pids, window) == Ok(0)
}
```

### Step 2: Run the tests and confirm RED

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib recovered_editable
```

Expected: the semantic-search regression fails because `recovered_focused_editable` currently accepts role-eligible text controls without composer resolution.

### Step 3: Validate observed editables before storing evidence

Change `recovered_focused_editable` to return a typed observation result rather than conflating an absent AX editable with an observable but invalid editable:

```rust
enum RecoveredEditableObservation {
    Composer(RecoveredFocusedEditable),
    Missing,
    Rejected,
}
```

For every trusted process:

- read its focused editable candidate;
- validate the candidate with `resolve_composer`, the trusted PID set, and the exact recovery-time window frame;
- return `Composer` for a validated message composer;
- remember that an invalid editable was observed, but continue scanning trusted child processes for a valid composer;
- return `Rejected` only when at least one editable was observable and none was a valid composer;
- return `Missing` only when no trusted process exposed any editable candidate.

At capture time, reject `Rejected` before clipboard mutation. At verification time, map `Rejected` to `TransactionFailure::FocusNotAcquired`. Preserve the existing known-4.1.2 degraded path only for `Missing`.

### Step 4: Run focused tests and confirm GREEN

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib recovered_editable
cargo test --manifest-path src-tauri/Cargo.toml --lib recovered_target
```

Expected: valid composer and missing-AX paths pass; semantic search paths fail closed.

### Step 5: Commit the focused-evidence fix

```bash
git add src-tauri/src/platform/macos.rs
git commit -m "fix: validate recovered WeChat composer"
```

## Task 3: Resolve Effective Submit Capability Before Group Dispatch

**Files:**
- Modify: `src-tauri/src/platform/macos.rs:2095-2130`
- Modify: `src-tauri/src/lib.rs:298-343`
- Test: `src-tauri/src/platform/macos/input_profiles.rs`
- Test: `src-tauri/src/lib.rs`

### Step 1: Add failing capability and group regressions

Add tests proving:

1. Requested Enter remains Enter for WeChat 4.1.2.
2. Requested Enter becomes `None` for missing, unknown, and uncalibrated WeChat versions.
3. Other application profiles preserve their requested submit key.
4. When the target's effective key is `None`, a grouped prompt is joined with blank lines, passed to the sender once, reports all bodies processed, and posts zero submits.
5. The frontend outcome cannot report success after processing only the first body.

The pure capability helper should have this contract:

```rust
fn effective_submit_key_for_profile(
    profile: InputCapabilityProfile,
    requested: NativeSubmitKey,
) -> NativeSubmitKey {
    match profile {
        InputCapabilityProfile::Accessibility(profile) if !profile.permits_submit() => {
            NativeSubmitKey::None
        }
        _ => requested,
    }
}
```

### Step 2: Run the tests and confirm RED

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib effective_submit
cargo test --manifest-path src-tauri/Cargo.toml --lib unknown_wechat_group
```

Expected: profile normalization can pass after extracting the existing logic, while the cross-layer group test fails because group dispatch currently branches on the requested key before the platform downgrades it.

### Step 3: Add one authoritative target-level resolver

In `platform/macos.rs`, expose a narrow target-level helper that:

- reads the target app version once;
- resolves `input_capability_profile_for_page` once;
- applies `effective_submit_key_for_profile`;
- returns the effective `NativeSubmitKey`.

Reuse `effective_submit_key_for_profile` inside `paste_prompt_and_submit_to_app_clipboard_with_copier` so single and sequence paths cannot diverge.

### Step 4: Normalize before sequence branching

In `paste_prompt_sequence_and_submit_to_last_target_impl`, calculate the effective key before calling `paste_prompt_sequence_and_submit_to_session_target_with_senders`.

If the effective key is `None`, the existing sequence helper must take its fill-only branch:

```text
join all non-empty bodies with two newlines
    -> call app sender once with NativeSubmitKey::None
    -> report processed_count == original clean body count
    -> never sleep between items
    -> never post Enter
```

Do not allow the per-item Enter loop to discover the downgrade after the first body.

### Step 5: Run focused tests and confirm GREEN

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib effective_submit
cargo test --manifest-path src-tauri/Cargo.toml --lib unknown_wechat_group
cargo test --manifest-path src-tauri/Cargo.toml --lib paste_only_sequence
```

Expected: unknown WeChat group content is handled as one complete fill-only operation, while WeChat 4.1.2 and all non-WeChat profiles retain existing behavior.

### Step 6: Commit the group capability fix

```bash
git add src-tauri/src/platform/macos.rs src-tauri/src/lib.rs
git commit -m "fix: normalize WeChat group submit capability"
```

## Task 4: Complete Automated Verification And Scope Review

**Files:**
- Verify only.

### Step 1: Run formatting and diff checks

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
git diff --check
```

Expected: both commands exit successfully.

### Step 2: Run all frontend tests and production build

```bash
npm test -- --run
npm run build
```

Expected: all frontend tests pass and the production build succeeds. Restore tracked generated `dist/` files afterward if the build rewrites them; generated bundle changes are outside this fix.

### Step 3: Run all Rust library tests

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Expected: all non-ignored Rust tests pass.

### Step 4: Review the final diff

```bash
git status --short
git diff 046c89633ee504b18619c1535b2ec133e5ed904a...HEAD --stat
git diff 046c89633ee504b18619c1535b2ec133e5ed904a...HEAD -- \
  src-tauri/src/platform/macos.rs \
  src-tauri/src/lib.rs \
  docs/plans/2026-07-14-popover-wechat-review-fixes.md
```

Expected: every source change maps to one of the two review findings; no UI, startup, hover, other-app profile, packaging, or release files changed.

## Task 5: Controlled macOS Acceptance

This task cannot safely send a real WeChat message without an explicit test conversation selected by the user. Automated completion must therefore stop short of claiming real-app acceptance.

After the code is built, the user should verify in a safe self-chat or test chat:

1. WeChat 4.1.2 fill-only: one prompt is inserted once and remains unsent.
2. WeChat 4.1.2 fill-and-send: one short test prompt is inserted and submitted exactly once.
3. Long prompt: composer growth does not block the single Enter.
4. Focus moved to search or another window: Enter is blocked.
5. Unknown-version fixture with a group: all bodies are inserted together and no Enter is posted.
6. Cold launch, native hover, Codex, Cursor, terminal, Claude, and browser paths remain unchanged.

Record actual pass/fail before final product acceptance.

## Acceptance Criteria

- Observable search or other non-composer editables cannot authorize a WeChat submit.
- Missing AX editable evidence remains available only to calibrated WeChat 4.1.2 and only with stable process/window evidence.
- Unknown WeChat versions never post Enter and never discard grouped prompt bodies.
- WeChat 4.1.2 still performs one paste and at most one Enter.
- Codex, Cursor, terminal, Claude, browsers, startup visibility, and hover code are unchanged.
- Full frontend tests, frontend build, formatting checks, diff checks, and Rust library tests pass.
- Real-app acceptance is explicitly reported as pending until the user performs the controlled WeChat test.
