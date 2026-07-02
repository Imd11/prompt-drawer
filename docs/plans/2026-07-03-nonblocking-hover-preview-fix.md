# Nonblocking Hover Preview Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the quick picker hover preview so it shows full prompt content without covering or intercepting the prompt list.

**Architecture:** Keep the quick picker data model and selection flow unchanged. Move the hover preview from an overlaid absolute panel to an in-flow preview region inside the quick picker shell, so list items stay clickable and hover cannot flicker from pointer interception.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, CSS.

---

### Task 1: Add Tests for Nonblocking Preview Behavior

**Files:**
- Modify: `src/ui/PromptQuickList.test.tsx`

**Step 1: Add a single prompt hover coverage test**

Add a test that hovers the single prompt row and verifies its full content appears inside the tooltip.

**Step 2: Add a selection-after-hover test**

Add a test that hovers a prompt row and then clicks it, verifying `onSelect` still receives the prompt container.

**Step 3: Run the focused test file**

Run:

```bash
npm test -- --run src/ui/PromptQuickList.test.tsx
```

Expected: tests pass after implementation.

---

### Task 2: Make Hover Preview In-Flow and Nonblocking

**Files:**
- Modify: `src/ui/PromptQuickList.tsx`
- Modify: `src/styles.css`

**Step 1: Keep preview rendering outside the button list but inside the shell**

Continue rendering `PromptHoverPreview` as a sibling of the list, but style it as a normal flow region below the list rather than an absolute overlay.

**Step 2: Update CSS**

Change `.prompt-hover-preview` from `position: absolute` to in-flow layout:

- Remove absolute positioning and z-index.
- Use `margin`, `max-height`, and `overflow: auto`.
- Keep rounded border, shadow, and bounded height.
- Add `pointer-events: none` so preview content never steals the pointer or click target.

**Step 3: Preserve bounded popup behavior**

Ensure the preview remains constrained within the quick picker and does not expand beyond a reasonable height.

---

### Task 3: Fix Plan Document Whitespace

**Files:**
- Modify: `docs/plans/2026-07-03-prompt-picker-ui-polish-and-group-editor.md`

**Step 1: Remove the extra trailing blank line**

Ensure the file has no `git diff --check` warning.

---

### Task 4: Verify and Commit

**Files:**
- Test: `src/ui/PromptQuickList.test.tsx`
- Test: `src/ui/PromptQuickList.tsx`
- Test: `src/styles.css`
- Test: `docs/plans/2026-07-03-prompt-picker-ui-polish-and-group-editor.md`
- Test: `docs/plans/2026-07-03-nonblocking-hover-preview-fix.md`

**Step 1: Run focused tests**

```bash
npm test -- --run src/ui/PromptQuickList.test.tsx
```

Expected: PromptQuickList tests pass.

**Step 2: Run full frontend tests**

```bash
npm test -- --run
```

Expected: all frontend tests pass.

**Step 3: Run Rust tests**

```bash
cargo test
```

Expected: all Rust tests pass.

**Step 4: Run whitespace check**

```bash
git diff --check
```

Expected: no output and exit code 0.

**Step 5: Commit the fix**

```bash
git add src/ui/PromptQuickList.tsx src/ui/PromptQuickList.test.tsx src/styles.css docs/plans/2026-07-03-prompt-picker-ui-polish-and-group-editor.md docs/plans/2026-07-03-nonblocking-hover-preview-fix.md
git commit -m "fix: keep prompt hover preview nonblocking"
```

Expected: commit succeeds.
