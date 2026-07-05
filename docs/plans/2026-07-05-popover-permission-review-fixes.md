# Popover Permission Review Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the review blockers from the popover permission/menubar polish pass so the implementation can be accepted with clear code coverage and manual QA evidence.

**Architecture:** Keep the existing permission-first UX, popover geometry, and generated menubar icon design. This repair pass only closes the remaining exposed System Events command, fixes one debounce edge case in the overlay authorization flow, and records the manual QA evidence that the original plan required.

**Tech Stack:** Tauri 2, Rust, vanilla `public/overlay.html`, React/TypeScript tests with Vitest, Cargo unit tests, macOS manual QA screenshots.

---

## Scope

This plan fixes only the issues found in review:

1. `paste_prompt_with_copier` still uses System Events after mutating the clipboard.
2. `open_accessibility_settings` debounce state is updated before the open command succeeds.
3. Manual QA evidence for popover transparency and menubar icon clarity is missing.

This plan does not change:

1. Prompt categories.
2. Prompt card layout.
3. Calico motion behavior.
4. App release packaging, notarization, or GitHub release uploads.

## Acceptance Criteria

1. Every macOS command path that uses System Events for paste/typing has an Accessibility permission check before mutating the clipboard.
2. If opening Accessibility settings fails, the next Calico click can retry immediately instead of being blocked by the 4 second debounce.
3. Manual QA evidence exists for:
   - prompt popover: only one rounded panel, transparent corners, no outer rectangle, no gray gutter, no clipped shadow;
   - menu bar icon: the `P` appears crisp in the real macOS menu bar.
4. Existing tests still pass:
   - `npm test`
   - `cargo test --manifest-path src-tauri/Cargo.toml --lib`
   - `npm run build`

---

## Task 0: Commit This Repair Plan

**Files:**
- Add: `docs/plans/2026-07-05-popover-permission-review-fixes.md`

**Context:**

The repair plan itself is part of the implementation record. Commit it before code changes so later commits stay focused on actual fixes.

**Step 1: Check the plan file is the only plan change**

Run:

```bash
git status --short docs/plans/2026-07-05-popover-permission-review-fixes.md
```

Expected:

```text
?? docs/plans/2026-07-05-popover-permission-review-fixes.md
```

or, if it was already added by a previous run:

```text
A  docs/plans/2026-07-05-popover-permission-review-fixes.md
```

**Step 2: Commit the plan**

Run:

```bash
git add docs/plans/2026-07-05-popover-permission-review-fixes.md
git commit -m "docs: plan popover permission review fixes"
```

Expected: Commit succeeds.

---

## Task 1: Gate The Remaining Plain Paste Command Before Clipboard Mutation

**Files:**
- Modify: `src-tauri/src/platform/macos.rs`

**Context:**

The current implementation at `src-tauri/src/platform/macos.rs` keeps `paste_prompt_with_copier` as:

```rust
pub fn paste_prompt_with_copier<C>(body: &str, copy_sender: C) -> Result<(), String>
where
    C: FnOnce(&str) -> Result<(), String>,
{
    copy_sender(body)?;
    Command::new("osascript")
        .args([
            "-e",
            "tell application \"System Events\" to keystroke \"v\" using command down",
        ])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

This command is not currently used by the prompt picker selection path, but it is still exposed through the `paste_prompt` Tauri command. Since it uses System Events, it must not mutate the clipboard before the Accessibility permission check.

**Step 1: Write the failing test**

Add this test near the existing `platform::macos::tests` accessibility tests:

```rust
#[test]
fn plain_paste_does_not_copy_before_accessibility_permission() {
    let mut copied = false;

    let result = paste_prompt_with_accessibility_gate(
        "hello",
        |_| {
            copied = true;
            Ok(())
        },
        || false,
    );

    assert_eq!(
        result,
        Err(ACCESSIBILITY_PERMISSION_REQUIRED_ERROR.to_string())
    );
    assert!(!copied);
}
```

**Step 2: Run the failing Rust test**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib plain_paste_does_not_copy_before_accessibility_permission
```

Expected: FAIL because `paste_prompt_with_accessibility_gate` does not exist yet.

**Step 3: Implement the minimal helper and wire the public function through it**

Add a private helper immediately above `paste_prompt_with_copier`:

```rust
fn paste_prompt_with_accessibility_gate<C, T>(
    body: &str,
    copy_sender: C,
    is_trusted: T,
) -> Result<(), String>
where
    C: FnOnce(&str) -> Result<(), String>,
    T: FnOnce() -> bool,
{
    ensure_accessibility_trusted_with(is_trusted)?;
    copy_sender(body)?;
    Command::new("osascript")
        .args([
            "-e",
            "tell application \"System Events\" to keystroke \"v\" using command down",
        ])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

Then change `paste_prompt_with_copier` to:

```rust
pub fn paste_prompt_with_copier<C>(body: &str, copy_sender: C) -> Result<(), String>
where
    C: FnOnce(&str) -> Result<(), String>,
{
    paste_prompt_with_accessibility_gate(body, copy_sender, is_accessibility_trusted)
}
```

**Step 4: Run the focused Rust test**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib plain_paste_does_not_copy_before_accessibility_permission
```

Expected: PASS.

**Step 5: Run the broader Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Expected: PASS.

**Step 6: Audit remaining clipboard mutation sites**

Run:

```bash
rg -n "copy_sender\\(body\\)|let copy_result = copy_sender\\(body\\)" src-tauri/src/platform/macos.rs
```

Expected:

- `paste_prompt_with_copier` delegates to `paste_prompt_with_accessibility_gate`.
- Every `copy_sender(body)` in a System Events or target-app automation path is preceded by either:
  - `ensure_accessibility_trusted_with(is_accessibility_trusted)?`, or
  - `missing_accessibility_outcome_if_untrusted_with(is_accessibility_trusted)`.
- Plain clipboard mutation before permission no longer appears in `paste_prompt_with_copier`.

If a new unguarded copy site is found, fix it before committing.

**Step 7: Commit**

```bash
git add src-tauri/src/platform/macos.rs
git commit -m "fix: guard plain paste before clipboard mutation"
```

---

## Task 2: Retry Opening Accessibility Settings When The First Open Fails

**Files:**
- Modify: `public/overlay.html`
- Test: `src/overlay/overlayHtml.test.ts`

**Context:**

The current overlay flow updates `lastAccessibilitySettingsOpenAt` before calling `open_accessibility_settings`. If the open command fails, the next click within 4 seconds shows the “settings opened” message instead of retrying or showing the failure again.

Current shape:

```js
const now = Date.now();
if (now - lastAccessibilitySettingsOpenAt < 4_000) {
  showStatusBubble({ kind: 'failed', message: permissionText(permission, 'settingsOpened') });
  return;
}
lastAccessibilitySettingsOpenAt = now;

try {
  await invokeOrThrow('open_accessibility_settings');
  showStatusBubble({ kind: 'failed', message: permissionText(permission, 'settingsOpened') });
} catch (error) {
  showStatusBubble({ kind: 'failed', message: permissionText(permission, 'settingsOpenFailed') });
}
```

**Step 1: Write the failing static test**

In `src/overlay/overlayHtml.test.ts`, add a test near the existing Accessibility click-flow test:

```ts
it("only debounces Accessibility settings after the settings open command succeeds", () => {
  const html = readOverlayHtml();
  const settingsBlock = html.slice(
    html.indexOf("const now = Date.now();"),
    html.indexOf("} catch (error)", html.indexOf("const now = Date.now();"))
  );

  expect(settingsBlock.indexOf("await invokeOrThrow('open_accessibility_settings');"))
    .toBeLessThan(settingsBlock.indexOf("lastAccessibilitySettingsOpenAt = now;"));
});
```

**Step 2: Run the failing overlay test**

Run:

```bash
npm test -- src/overlay/overlayHtml.test.ts
```

Expected: FAIL because `lastAccessibilitySettingsOpenAt = now` currently appears before `await invokeOrThrow('open_accessibility_settings')`.

**Step 3: Move debounce assignment after successful settings open**

Change the relevant block in `public/overlay.html` to:

```js
const now = Date.now();
if (now - lastAccessibilitySettingsOpenAt < 4_000) {
  showStatusBubble({ kind: 'failed', message: permissionText(permission, 'settingsOpened') });
  return;
}

try {
  await invokeOrThrow('open_accessibility_settings');
  lastAccessibilitySettingsOpenAt = now;
  showStatusBubble({ kind: 'failed', message: permissionText(permission, 'settingsOpened') });
} catch (error) {
  console.error('Failed to open Accessibility settings', error);
  showStatusBubble({ kind: 'failed', message: permissionText(permission, 'settingsOpenFailed') });
}
```

**Step 4: Run the focused overlay test**

Run:

```bash
npm test -- src/overlay/overlayHtml.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add public/overlay.html src/overlay/overlayHtml.test.ts
git commit -m "fix: retry accessibility settings after open failure"
```

---

## Task 3: Record Manual QA Evidence For Popover And Menu Bar Icon

**Files:**
- Create directory if needed: `docs/qa/`
- Create: `docs/qa/2026-07-05-popover-permission-menubar-polish.md`
- Create manually during QA: `docs/qa/2026-07-05-popover-permission-menubar-popover.png`
- Create manually during QA: `docs/qa/2026-07-05-popover-permission-menubar-menubar.png`

**Context:**

The implementation already has structural tests:

- `src-tauri/src/windows.rs` asserts `POPOVER_WINDOW_PADDING == 0.0`.
- `src/styles.css` uses `.popover-root { padding: 0; }` and `.popover-window { box-shadow: none; }`.
- `src-tauri/src/lib.rs` asserts the menubar template icon is a binary transparent/opaque mask.

The original plan still requires real UI confirmation because transparent corners and menu bar sharpness cannot be fully proven by unit tests.

**Step 1: Create the QA checklist document**

Run:

```bash
mkdir -p docs/qa
git rev-parse --short HEAD
```

Create `docs/qa/2026-07-05-popover-permission-menubar-polish.md`:

```markdown
# Popover Permission Menubar Polish QA

Date: 2026-07-05
Build: local `npm run tauri build`
Commit: <fill with git rev-parse --short HEAD>

## Popover Visual Boundary

Screenshot: `docs/qa/2026-07-05-popover-permission-menubar-popover.png`

- [ ] Only one visible rounded prompt panel.
- [ ] Four rounded-corner outside areas are transparent.
- [ ] No outer rectangular shell.
- [ ] No gray gutter between native window and panel.
- [ ] No clipped rectangular shadow.
- [ ] Category tabs remain inside the panel.
- [ ] Prompt list still scrolls normally.

Result: PASS / FAIL
Notes:

## Menu Bar Icon

Screenshot: `docs/qa/2026-07-05-popover-permission-menubar-menubar.png`

- [ ] The `P` icon is readable at normal menu bar size.
- [ ] The edge appears pixel-aligned, not fuzzy.
- [ ] Template rendering works in the menu bar.
- [ ] The icon does not look oversized compared with adjacent menu bar icons.

Result: PASS / FAIL
Notes:
```

**Step 2: Build and open the local app under test**

Run:

```bash
npm run tauri build
osascript -e 'quit app "Prompt Picker"' || true
open "src-tauri/target/release/bundle/macos/Prompt Picker.app"
```

Expected:

- App launches.
- Menu bar icon appears.
- Floating Calico appears unless hidden in saved settings.
- The running app is the freshly built local app, not a previously installed copy.

If Calico does not appear because the floating button was hidden, use the menu bar menu to show it before continuing.

If Accessibility permission is not trusted, click Calico once and grant permission in System Settings. Then click Calico again after the permission is enabled.

**Step 3: Capture popover screenshot**

Click Calico when Accessibility is already authorized, then capture the popover:

```bash
screencapture -i docs/qa/2026-07-05-popover-permission-menubar-popover.png
```

Crop tightly around the popover. Do not include unrelated desktop content, private prompts beyond what is necessary to see the panel shape, or other user data.

Manual expected result:

```text
╭──────────────────────────────╮
│ Tabs                         │
│ Prompt cards                 │
│ Prompt cards                 │
╰──────────────────────────────╯

No outer rectangle.
No gray gutter.
No clipped shadow.
Transparent crescent corners.
```

If the screenshot shows an outer rectangle, do not mark the task complete. Return to the popover geometry/CSS implementation.

**Step 4: Capture menu bar screenshot**

Capture the menu bar area around the Prompt Picker icon:

```bash
screencapture -i docs/qa/2026-07-05-popover-permission-menubar-menubar.png
```

Crop tightly around the Prompt Picker menu bar icon. Avoid including unrelated menu bar content when possible.

Manual expected result:

- The `P` is visually sharper than the old fuzzy icon.
- It remains readable at menu bar size.
- It does not appear blurry due to half-alpha edges.

If the screenshot still looks fuzzy, adjust `scripts/generate-menubar-icon.py` and regenerate `src-tauri/icons/menubar-template.png` and `src-tauri/icons/menubar-template.rgba`.

**Step 5: Fill out the QA checklist**

Update:

```markdown
Result: PASS
Notes: <short factual note>
```

or:

```markdown
Result: FAIL
Notes: <what failed and what needs fixing>
```

**Step 6: Commit**

```bash
git add docs/qa/2026-07-05-popover-permission-menubar-polish.md \
  docs/qa/2026-07-05-popover-permission-menubar-popover.png \
  docs/qa/2026-07-05-popover-permission-menubar-menubar.png
git commit -m "test: record popover and menubar qa"
```

---

## Task 4: Final Verification And Push

**Files:**
- No code files unless previous tasks uncovered a defect.

**Step 1: Run frontend tests**

Run:

```bash
npm test
```

Expected: PASS.

**Step 2: Run Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Expected: PASS.

**Step 3: Run production frontend build**

Run:

```bash
npm run build
```

Expected: PASS.

**Step 4: Optional app build smoke test**

Run if local signing/build conditions are available:

```bash
npm run tauri build
```

Expected:

- App bundle and DMG are produced.
- If notarization env vars are missing, Tauri may skip notarization. That is acceptable for this repair pass because this plan is not a release plan.

**Step 5: Review git diff**

Run:

```bash
git status --short
git diff --cached --stat
git diff --name-only -- src-tauri/src/platform/macos.rs public/overlay.html src/overlay/overlayHtml.test.ts docs/qa docs/plans/2026-07-05-popover-permission-review-fixes.md
```

Expected:

- No unintended staged files remain.
- The only task-related changed files are the Rust fix, overlay debounce fix, overlay test, QA evidence, and this plan document.
- Existing unrelated `node_modules`, `src-tauri/target`, `dist`, `release`, or generated schema churn may still appear in `git status --short`; keep it unstaged unless the user explicitly asks to include it.

**Step 6: Push**

Run:

```bash
git push origin main
```

Expected: `main -> main` pushed successfully.

---

## Review Checklist Before Acceptance

Before marking the repair complete, confirm:

1. `paste_prompt_with_copier` no longer copies before permission.
2. `paste_prompt_to_app_with_copier`, autosend clipboard, foreground autosend, direct typing, and click-point autosend paths still keep permission checks before copy/typing.
3. Overlay opens Accessibility settings immediately on later unauthorized clicks.
4. Overlay retries opening settings if a previous open attempt failed.
5. The popover screenshot proves there is no outer rectangular shell.
6. The menu bar screenshot proves the `P` icon is visually sharper.
7. Tests and builds listed above pass.
