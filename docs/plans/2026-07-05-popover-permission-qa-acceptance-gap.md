# Popover Permission QA Acceptance Gap Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the current code-execution acceptance gap by documenting that the permission/popover fixes are implemented and verified, while deferring user-run visual screenshots to a later follow-up.

**Architecture:** This is a documentation and verification pass, not a feature rewrite. The code fixes are already on `main`; this plan records the updated QA boundary, keeps source code unchanged, reruns automatic verification, and pushes the execution record. Visual screenshots are explicitly out of scope for this execution because the user will provide them later.

**Tech Stack:** Tauri 2, Rust unit tests, Vitest, Vite production build, Git.

---

## Scope

This plan handles the latest instruction:

1. Do not wait for popover or menu bar screenshots.
2. Do not perform physical UI testing.
3. Do not modify feature code unless automatic verification exposes a real defect.
4. Record that screenshots are user-owned follow-up evidence.
5. Push the resulting plan and QA record to `origin/main`.

This plan does not:

1. Change `src-tauri/src/platform/macos.rs`.
2. Change `public/overlay.html`.
3. Change `src/overlay/overlayHtml.test.ts`.
4. Change prompt categories, prompt card layout, Calico motion, menu bar icon generation, release packaging, signing, notarization, or GitHub releases.
5. Stage generated churn from `dist/`, `node_modules/`, `src-tauri/target/`, `release/`, or generated schema files.

## Acceptance Criteria

1. The plan file is committed.
2. A QA status record exists at:
   - `docs/qa/2026-07-05-popover-permission-menubar-polish.md`
3. The QA record clearly states:
   - code execution and automatic verification are complete;
   - physical UI screenshots are deferred by user instruction;
   - final visual acceptance remains pending until the user provides screenshots.
4. The already-implemented code fixes remain intact:
   - plain paste checks Accessibility before copying;
   - opening Accessibility settings only enters the 4 second debounce after the open command succeeds.
5. Automatic checks pass:
   - `npm test`
   - `cargo test --manifest-path src-tauri/Cargo.toml --lib`
   - `npm run build`
6. Only the plan and QA record are staged and committed.
7. The commit is pushed to `origin/main`.

---

## Task 0: Commit This Updated Plan

**Files:**
- Add: `docs/plans/2026-07-05-popover-permission-qa-acceptance-gap.md`

**Step 1: Verify the plan file is pending**

Run:

```bash
git status --short docs/plans/2026-07-05-popover-permission-qa-acceptance-gap.md
```

Expected:

```text
?? docs/plans/2026-07-05-popover-permission-qa-acceptance-gap.md
```

or:

```text
AM docs/plans/2026-07-05-popover-permission-qa-acceptance-gap.md
```

**Step 2: Commit the plan**

Run:

```bash
git add docs/plans/2026-07-05-popover-permission-qa-acceptance-gap.md
git commit -m "docs: plan popover permission qa acceptance gap"
```

Expected: Commit succeeds.

---

## Task 1: Create A Deferred Visual QA Record

**Files:**
- Create: `docs/qa/2026-07-05-popover-permission-menubar-polish.md`

**Context:**

The previous review required screenshots, but the user explicitly changed the execution boundary: Codex should not wait for screenshots and should not run physical UI testing. The QA record must say this plainly. Do not mark visual QA as `PASS` without screenshots.

**Step 1: Record the current commit under test**

Run:

```bash
git rev-parse --short HEAD
```

Expected: A short commit hash.

**Step 2: Create the QA status document**

Create `docs/qa/2026-07-05-popover-permission-menubar-polish.md` with this structure, replacing `<commit>` with the current short commit hash:

```markdown
# Popover Permission Menubar Polish QA

Date: 2026-07-05
Build: automatic verification only
Commit: <commit>
Tester: Codex for automatic checks; user will provide physical UI screenshots later
Codex physical UI testing: Not performed by user request

## Code Execution Status

- [x] Plain paste checks Accessibility before clipboard mutation.
- [x] Accessibility settings debounce is only recorded after the settings open command succeeds.
- [x] Regression tests for both fixes exist.
- [x] Automatic verification completed in this execution pass.

Result: PASS
Notes: Code-level execution and automatic verification are complete.

## Deferred User Visual QA

Screenshots to be provided later by user:

- `docs/qa/2026-07-05-popover-permission-menubar-popover.png`
- `docs/qa/2026-07-05-popover-permission-menubar-menubar.png`

Pending checks:

- [ ] Only one visible rounded prompt panel.
- [ ] Four rounded-corner outside areas are transparent.
- [ ] No outer rectangular shell.
- [ ] No gray gutter between native window and panel.
- [ ] No clipped rectangular shadow.
- [ ] Category tabs remain inside the panel.
- [ ] Prompt list still scrolls normally.
- [ ] The `P` menu bar icon is readable and crisp at normal menu bar size.
- [ ] The `P` icon does not look oversized compared with adjacent menu bar icons.

Result: PENDING USER SCREENSHOTS
Notes: The user explicitly requested that Codex not wait for these screenshots in this execution pass.
```

**Step 3: Verify the QA record exists**

Run:

```bash
test -f docs/qa/2026-07-05-popover-permission-menubar-polish.md
```

Expected: Exit code `0`.

**Step 4: Commit the QA record**

Run:

```bash
git add docs/qa/2026-07-05-popover-permission-menubar-polish.md
git commit -m "test: record deferred popover visual qa"
```

Expected: Commit succeeds.

---

## Task 2: Reconfirm The Code Fixes Remain Intact

**Files:**
- Read-only check: `src-tauri/src/platform/macos.rs`
- Read-only check: `public/overlay.html`
- Read-only check: `src/overlay/overlayHtml.test.ts`

**Step 1: Confirm plain paste checks Accessibility before copying**

Run:

```bash
nl -ba src-tauri/src/platform/macos.rs | sed -n '434,460p'
```

Expected order:

```text
ensure_accessibility_trusted_with(is_trusted)?;
copy_sender(body)?;
```

and:

```text
paste_prompt_with_accessibility_gate(body, copy_sender, is_accessibility_trusted)
```

**Step 2: Confirm overlay debounce is success-only**

Run:

```bash
nl -ba public/overlay.html | sed -n '335,348p'
```

Expected order:

```text
await invokeOrThrow('open_accessibility_settings');
lastAccessibilitySettingsOpenAt = now;
```

**Step 3: Confirm the regression tests still exist**

Run:

```bash
rg -n "plain_paste_does_not_copy_before_accessibility_permission|only debounces Accessibility settings after the settings open command succeeds" src-tauri/src/platform/macos.rs src/overlay/overlayHtml.test.ts
```

Expected: Both test names are found.

---

## Task 3: Run Fresh Automatic Verification

**Files:**
- No source file edits expected.

**Step 1: Run frontend tests**

Run:

```bash
npm test
```

Expected:

```text
Test Files  20 passed
Tests  229 passed
```

Exact duration and warning text may differ.

**Step 2: Run Rust unit tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Expected:

```text
test result: ok. 118 passed; 0 failed
```

**Step 3: Run production frontend build**

Run:

```bash
npm run build
```

Expected:

```text
✓ built
```

---

## Task 4: Guard Against Unrelated Generated Files

**Files:**
- No source file edits expected.

**Step 1: Review working tree**

Run:

```bash
git status --short
```

Expected: Existing generated churn may appear in `dist/`, `node_modules/`, `src-tauri/target/`, `release/`, or generated schemas.

**Step 2: Confirm no unintended files are staged**

Run:

```bash
git diff --cached --name-only
```

Expected: Empty output.

If any file is staged unintentionally, unstage it:

```bash
git restore --staged <unexpected-file>
```

---

## Task 5: Push And Report

**Files:**
- No source file edits expected.

**Step 1: Push to main**

Run:

```bash
git push origin main
```

Expected:

```text
main -> main
```

**Step 2: Verify remote main matches local HEAD**

Run:

```bash
git ls-remote origin refs/heads/main
git rev-parse HEAD
```

Expected: Both hashes match.

**Step 3: Final user-facing report**

Report:

1. The code fixes are already in place and verified.
2. The latest execution recorded that visual screenshots are pending user follow-up.
3. The user-facing app behavior remains:
   - unauthorized paste paths no longer replace the clipboard before Accessibility is trusted;
   - clicking Calico can retry opening Accessibility settings if the previous attempt failed;
   - no UI behavior was changed in this pass.
