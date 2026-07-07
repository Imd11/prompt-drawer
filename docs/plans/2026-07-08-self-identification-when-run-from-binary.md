# Self-Identification When Run From Binary Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Prompt Picker reliably recognize itself as the frontmost app regardless of whether it was launched from an `.app` bundle or directly from the `prompt-picker` binary, so autosend stops trying to activate `[ NULL ]` as a bundle id.

**Architecture:** Three surgical gatekeeper fixes. (1) Harden `parse_bundle_id` to reject `lsappinfo`'s `[ NULL ]` placeholder by requiring real bundle ids to be double-quoted (lsappinfo's own output convention). (2) Add `std::process::id()` comparison at the **three** target-recording gatekeepers (`current_input_target`, `prompt_pick_session_target`, and `record_last_app_if_valid`) so PP never records itself as the autosend target, even when its bundle_id and name don't match the string-based self-identification checks. A code audit confirmed these three gates are the only production write paths into `LastInputTargetState` and `PromptPickSessionState` — there is no bypass via JS frontend or other Tauri commands.

**Tech Stack:** Rust, Tauri 2, macOS `lsappinfo` / `osascript`, `cargo test` for unit tests.

---

## Root Cause (Confirmed)

When PP is launched directly from `./prompt-picker` (binary, not `.app` bundle):

1. `lsappinfo info <PP_ASN>` outputs `bundleID=[ NULL ]` (unquoted placeholder) instead of `bundleID="local.promptpicker.dev"`.
2. `lsappinfo` also reports PP's name as `prompt-picker` (binary filename with hyphen) instead of `Prompt Picker` (the `CFBundleName` from `Info.plist`).
3. `parse_bundle_id` (`src-tauri/src/platform/macos.rs:1112-1126`) accepts `[ NULL ]` as a valid bundle id because it only checks for non-emptiness, not for the placeholder.
4. `current_input_target` (`src-tauri/src/platform/macos.rs:317`) and `prompt_pick_session_target` (`src-tauri/src/lib.rs:1017`) both fail their string-based self-identification checks (`bundle_id == "local.promptpicker.dev"` and `name == "Prompt Picker"`), so PP records **itself** as the autosend target with `bundle_id = "[ NULL ]"`.
5. When the user selects a prompt, PP calls `activate_app_by_bundle_id("[ NULL ]")` → `osascript` fails → `recover_target_app_for_autosend` returns `Err` → mapped to `TargetFocusFailed` → UI shows "Switch to an input first".

Evidence captured during diagnosis:
- `/tmp/pp_lsappinfo.log` shows `bundleID=[ NULL ]` for PP's own ASN.
- `/tmp/pp_osascript.log` shows `tell application id "[ NULL ]" to activate`.
- Minimal Rust reproduction confirms `parse_bundle_id("bundleID=[ NULL ]\n")` returns `Some("[ NULL ]")`.

---

## Task 1: Add Failing Test for `parse_bundle_id` Rejecting `[ NULL ]`

**Files:**
- Modify: `src-tauri/src/platform/macos.rs` (test module, near line 1671)

**Step 1: Write the failing test**

In `src-tauri/src/platform/macos.rs`, find the existing test `parses_bundle_id_various_formats` (line 1670-1684) and add a new test immediately after it:

```rust
    #[test]
    fn parses_bundle_id_rejects_lsappinfo_null_placeholder() {
        // lsappinfo outputs `bundleID=[ NULL ]` (unquoted) when a process has no
        // registered bundle id — e.g., when launched directly from a binary instead
        // of an .app bundle. The parser must treat this as missing.
        assert_eq!(parse_bundle_id("bundleID=[ NULL ]\n"), None);
        assert_eq!(parse_bundle_id("    bundleID=[ NULL ]\n"), None);
        assert_eq!(parse_bundle_id("bundleID=[NULL]\n"), None);
        assert_eq!(parse_bundle_id("bundleID=\n"), None);
        // Quoted empty string is also missing.
        assert_eq!(parse_bundle_id("bundleID=\"\"\n"), None);
    }
```

**Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri && cargo test --lib parse_bundle_id_rejects_lsappinfo_null_placeholder -- --nocapture
```

Expected: FAIL. The first assertion (`bundleID=[ NULL ]`) will panic because `parse_bundle_id` currently returns `Some("[ NULL ]")`.

**Step 3: Commit (test only, no implementation yet)**

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
git add src-tauri/src/platform/macos.rs
git commit -m "test: add failing test for parse_bundle_id rejecting [NULL] placeholder"
```

---

## Task 2: Fix `parse_bundle_id` to Require Quoted Values

**Files:**
- Modify: `src-tauri/src/platform/macos.rs:1112-1126`

**Step 1: Replace the function body**

Replace the entire `parse_bundle_id` function at `src-tauri/src/platform/macos.rs:1112-1126` with:

```rust
/// Parse bundle ID from lsappinfo info output (any format).
pub fn parse_bundle_id(s: &str) -> Option<String> {
    for line in s.lines() {
        let line = line.trim();
        if line.starts_with("bundleID") || line.starts_with("CFBundleIdentifier") {
            if let Some(eq) = line.find('=') {
                let raw = line[eq + 1..].trim();
                // lsappinfo always wraps real bundle ids in double quotes
                // (e.g., `bundleID="com.openai.codex"`). An unquoted value like
                // `bundleID=[ NULL ]` means the bundle id is unavailable — this
                // happens when a process is launched directly from a binary
                // rather than an .app bundle. Returning None here lets the caller
                // fall back to `unknown.{asn}`, which downstream code correctly
                // treats as "not a real target".
                if raw.starts_with('"') {
                    let val = raw.trim_matches('"').trim();
                    if !val.is_empty() {
                        return Some(val.to_string());
                    }
                }
            }
        }
    }
    None
}
```

**Step 2: Run the new test to verify it passes**

Run:
```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri && cargo test --lib parse_bundle_id_rejects_lsappinfo_null_placeholder -- --nocapture
```

Expected: PASS.

**Step 3: Run the existing bundle id tests to verify no regression**

Run:
```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri && cargo test --lib parses_bundle_id_various_formats -- --nocapture
```

Expected: PASS. All three existing assertions use quoted values and should still pass.

**Step 4: Run the full macos platform test suite**

Run:
```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri && cargo test --lib platform::macos -- --nocapture
```

Expected: All tests PASS. If any fail, investigate before proceeding — the change may have broken a code path that relied on unquoted values (none expected based on code audit).

**Step 5: Commit**

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
git add src-tauri/src/platform/macos.rs
git commit -m "fix(parse_bundle_id): reject lsappinfo [NULL] placeholder by requiring quoted values

When PP runs from a binary (no .app bundle), lsappinfo reports bundleID=[ NULL ]
(unquoted). The parser treated this as a real bundle id, causing PP to record
itself as the autosend target. Now only double-quoted values are accepted,
matching lsappinfo's output convention for real bundle ids."
```

---

## Task 3: Add PID-Based Self-Check in `current_input_target`

**Files:**
- Modify: `src-tauri/src/platform/macos.rs:314-322`

**Step 1: Replace the self-identification check**

Replace the body of `current_input_target` at `src-tauri/src/platform/macos.rs:314-322` with:

```rust
pub fn current_input_target() -> Option<InputTarget> {
    let app_info = frontmost_app_info()?;

    // Reject PP itself. PID comparison is authoritative regardless of how PP was
    // launched (.app bundle vs raw binary). The string checks remain as a
    // secondary defense for callers that might construct FrontmostAppInfo without
    // a real pid.
    if app_info.pid == std::process::id()
        || app_info.app.bundle_id == "local.promptpicker.dev"
        || app_info.app.name == "Prompt Picker"
    {
        return None;
    }

    get_focused_input_element(app_info.pid, app_info.app.clone())
}
```

**Step 2: Run the macos platform test suite**

Run:
```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri && cargo test --lib platform::macos -- --nocapture
```

Expected: All tests PASS. (No existing test exercises this code path with PP's own pid, so no regression is possible. The added condition is purely additive.)

**Step 3: Commit**

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
git add src-tauri/src/platform/macos.rs
git commit -m "fix(current_input_target): add PID-based self-identification

String-based self-identification fails when PP is launched from a binary
(bundle_id becomes 'unknown.{asn}' after the parse_bundle_id fix, and name
becomes 'prompt-picker' with a hyphen). Adding std::process::id() comparison
makes PP reliably recognize itself regardless of launch mode."
```

---

## Task 4: Add PID-Based Self-Check in `prompt_pick_session_target`

**Files:**
- Modify: `src-tauri/src/lib.rs:998-1043`

**Step 1: Add the PID rejection clause**

In `src-tauri/src/lib.rs`, find `prompt_pick_session_target` (line 998). After line 1003 (`let frontmost = frontmost?;`) and before line 1004 (`if is_usable_autosend_app(&frontmost.app) {`), insert:

```rust
fn prompt_pick_session_target(
    frontmost: Option<FrontmostAppWithPid>,
    _visible_apps: Vec<FrontmostApp>,
    recent_target: Option<LastInputTarget>,
) -> Option<PromptPickSessionTarget> {
    let frontmost = frontmost?;

    // Reject PP itself. PID comparison is authoritative regardless of launch mode.
    // This prevents PP from recording itself as the autosend target when its
    // popover becomes frontmost (lsappinfo considers PP "in front" while the
    // popover is open, even though the popover window cannot become key).
    if frontmost.pid == Some(std::process::id()) {
        return None;
    }

    if is_usable_autosend_app(&frontmost.app) {
        // ... rest unchanged
```

**Step 2: Run the lib test suite**

Run:
```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri && cargo test --lib -- --nocapture
```

Expected: All tests PASS. Existing tests that call `prompt_pick_session_target` via `frontmost_target(...)` helper pass arbitrary pids (not the test process's pid), so the new check never triggers for them.

**Step 3: Commit**

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
git add src-tauri/src/lib.rs
git commit -m "fix(prompt_pick_session_target): reject PP itself via PID comparison

When PP's popover is open, lsappinfo reports PP as frontmost. Without this
check, PP would record itself as the session target (with bundle_id
'unknown.{asn}' after the parse_bundle_id fix), causing autosend to fail
with TargetFocusFailed."
```

---

## Task 4b: Add PID-Based Self-Check in `record_last_app_if_valid`

**Files:**
- Modify: `src-tauri/src/lib.rs:1088-1106`

**Why this task exists (bypass path discovered during plan review):**

The `current_input_target` Tauri command (lib.rs:91-104) has a **fallback path**:

```rust
fn current_input_target(...) -> Option<InputTarget> {
    if let Some(target) = platform::macos::current_input_target() {  // Task 3 fixes this
        record_last_input_target_if_valid(state.inner(), &target);
        return Some(target);
    }
    // FALLBACK — runs when current_input_target returns None
    if let Some(app) = platform::frontmost_app_with_pid() {
        record_last_app_if_valid(state.inner(), app);  // ← BYPASS: records PP here
    }
    None
}
```

When Task 3 makes `current_input_target` (macos.rs:314) correctly return `None` for PP, control falls through to line 99. `frontmost_app_with_pid()` still returns PP (popover is open), and `record_last_app_if_valid` (lib.rs:1088) records PP via its own `is_prompt_picker_app` string check — which also fails to recognize PP in binary mode. This re-creates the exact same bug Task 3 was supposed to fix.

A full audit of `LastInputTargetState` and `PromptPickSessionState` write sites confirmed there are exactly **three** production data-writing gates:
1. `record_last_input_target_if_valid` (lib.rs:1080) — gated by `current_input_target` (Task 3)
2. `record_last_app_if_valid` (lib.rs:1100) — gated by this task (Task 4b)
3. `record_prompt_pick_session_target_if_valid` (lib.rs:995) — gated by `prompt_pick_session_target` (Task 4)

No JS frontend command writes target data directly — all paths funnel through these three Rust-side gates.

**Step 1: Add the PID rejection clause**

In `src-tauri/src/lib.rs`, find `record_last_app_if_valid` (line 1088). Replace the first `if` block:

Before:
```rust
fn record_last_app_if_valid(state: &LastInputTargetState, target: FrontmostAppWithPid) {
    if is_prompt_picker_app(&target.app) {
        return;
    }
```

After:
```rust
fn record_last_app_if_valid(state: &LastInputTargetState, target: FrontmostAppWithPid) {
    if target.pid == Some(std::process::id()) || is_prompt_picker_app(&target.app) {
        return;
    }
```

**Step 2: Run the lib test suite**

Run:
```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri && cargo test --lib -- --nocapture
```

Expected: All tests PASS. Existing tests that exercise `record_last_app_if_valid` (if any) pass arbitrary pids via `frontmost_target(...)` helper that will never equal the test runner's pid.

**Step 3: Commit**

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
git add src-tauri/src/lib.rs
git commit -m "fix(record_last_app_if_valid): reject PP itself via PID comparison

This closes a bypass path in the current_input_target Tauri command: when
current_input_target() returns None (e.g., because Task 3's PID check
rejected PP), the fallback at lib.rs:99 calls record_last_app_if_valid,
which would re-record PP as the target via its own string-based check.
Adding PID comparison here ensures all three target-recording gates
consistently reject PP regardless of launch mode."
```

---

## Task 5: Repackage as `.app` and End-to-End Verify

**Files:** None (build + manual verification only)

This task verifies the fix end-to-end in BOTH launch modes (binary and `.app`).

**Step 1: Build the `.app` bundle**

Run:
```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker && npm run tauri build
```

Expected: Build succeeds. Output at `src-tauri/target/release/bundle/macos/`.

**Step 2: Install and launch from `.app`**

```bash
# Copy to /Applications (or open directly from build dir)
open /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/target/release/bundle/macos/*.app
```

Expected: PP launches, calico appears.

**Step 3: Verify `.app` mode works (regression check)**

1. Open Codex (or any app with a text input — Notes, Safari, etc.)
2. Click into a text field in Codex
3. Click the calico
4. Select any prompt
5. Expected: prompt is auto-pasted and submitted. No "Switch to an input first" error.

**Step 4: Verify binary mode is now fixed (the bug scenario)**

Quit the `.app` PP completely. Then launch from binary:

```bash
/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/target/release/prompt-picker
```

Repeat steps 1-5 above. Expected: prompt is auto-pasted and submitted. The "Switch to an input first" error no longer appears.

**Step 5: Verify with diagnostic interception (optional confirmation)**

To confirm PP no longer calls `activate` with `[ NULL ]`:

```bash
# Clear old logs
rm -f /tmp/pp_lsappinfo.log /tmp/pp_osascript.log

# Launch with interception wrappers
cd /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/target/release && \
  PATH=/tmp/osascript_wrapper:/tmp/lsappinfo_wrapper:$PATH ./prompt-picker
```

Reproduce the scenario (click calico, select prompt). Then check:

```bash
grep 'activate' /tmp/pp_osascript.log
```

Expected: No `tell application id "[ NULL ]" to activate` entries. If PP calls activate at all, it should be with a real bundle id like `com.openai.codex`.

**Step 6: Final commit (if any cleanup needed)**

No code changes in this task. If verification passes, the fix is complete.

---

## Task 6 (Optional): Clean Up Misleading `#[allow(dead_code)]` Annotations

**Files:**
- Modify: `src-tauri/src/platform/macos.rs:982, 997, 1050`

These three functions are marked `#[allow(dead_code)]` but are actually called by `recover_target_app_for_autosend` (which is NOT marked dead_code). The annotations are misleading historical residue.

**Step 1: Remove the `#[allow(dead_code)]` attributes**

Remove the `#[allow(dead_code)]` line immediately before each of:
- `activate_app_by_bundle_id` (line 982)
- `wait_for_frontmost_bundle_id` (line 997)
- `restore_focus_before_autosend` (line 1050)

**Step 2: Verify compilation**

Run:
```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri && cargo build --release 2>&1 | tail -20
```

Expected: Build succeeds with no warnings about these functions being unused. (If warnings appear, the functions ARE unused and the original annotation was correct — investigate before proceeding.)

**Step 3: Commit**

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
git add src-tauri/src/platform/macos.rs
git commit -m "chore: remove misleading #[allow(dead_code)] from autosend helpers

These functions are called by recover_target_app_for_autosend (which is not
dead code). The annotations were historical residue from earlier refactors."
```

---

## Verification Matrix

After all tasks complete, verify these scenarios:

| Launch Mode | Target App | Expected Result |
|-------------|------------|-----------------|
| `.app` bundle | Codex | Auto-paste + submit ✓ |
| `.app` bundle | Notes | Auto-paste + submit ✓ |
| `.app` bundle | Safari input | Auto-paste + submit ✓ |
| Binary direct | Codex | Auto-paste + submit ✓ (was failing) |
| Binary direct | Notes | Auto-paste + submit ✓ (was failing) |
| Binary direct | Safari input | Auto-paste + submit ✓ (was failing) |

## What NOT to Change

- **UI error text** (`targetFocusFailed: "Switch to an input first"`): After the fix, users won't see this error in the bug scenario. The text itself is fine.
- **Codex `AXFocusedUIElement` handling**: Codex (Electron) doesn't expose focused elements via native AX. Current code already handles `missing value` correctly (elemPos stays `{0,0}`). This was never the bug — PP just never got to probing Codex because it recorded itself first.
- **`recover_target_app_for_autosend` timeout/retry logic**: Not the cause. Leave as-is.
- **`is_prompt_picker_app` string checks**: Leave them as secondary defense. Don't change signature — would require threading pid through 5 call sites, and the three gatekeeper fixes (Tasks 3, 4, 4b) already break the failure chain at every confirmed entry point. The string checks remain as a fallback for any future code path that constructs `FrontmostApp` without a real pid.

## Safety Audit Summary (Pre-Execution)

A deep code audit using three parallel exploration agents confirmed:

1. **`parse_bundle_id` requiring quotes is safe**: Tested 15 running apps via `lsappinfo info` — all use `bundleID="com.x"` (quoted) for real values and `bundleID=[ NULL ]` (unquoted) only for missing values. Zero apps produce unquoted real bundle ids. The fix cannot reject any real target.

2. **PID checks have no false positives or negatives**: `std::process::id()` always matches what `lsappinfo` reports for PP. PP is a single process (Tauri's `spawn_blocking` uses threads, not subprocesses). No two processes can share a pid on macOS. Existing tests use hardcoded pids (1, 123, 456) that never collide with the test runner's pid.

3. **Three gates are the complete chokepoint set**: Full audit of `LastInputTargetState` and `PromptPickSessionState` write sites found exactly three production data-writing paths, all covered by Tasks 3, 4, and 4b. No JS frontend command writes target data directly — all paths funnel through Rust-side gatekeepers.

4. **Pareto improvement**: No regression in `.app` mode (string checks remain as secondary defense). No regression for other target apps (PID check only rejects PP itself). No new failure modes introduced. Binary mode goes from completely broken to fully fixed.
