# Hover Preview Manual Acceptance Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the missing manual acceptance verification for the Calico prompt-list hover-preview lifecycle fix without changing feature behavior.

**Architecture:** The code fix already exists in `69b0800 fix: reset prompt hover preview lifecycle`; this plan only verifies it in the real Tauri app because the original bug involved reused native windows. Keep source code unchanged unless manual verification exposes a reproducible bug, then make the smallest targeted fix with a regression test.

**Tech Stack:** Tauri app runtime, React/Vitest test suite, Vite build, Git.

---

### Task 1: Confirm Current Scope And Clean Review Baseline

**Files:**
- Review only: `src/App.tsx`
- Review only: `src/ui/PromptQuickList.tsx`
- Review only: `src/app/App.test.tsx`
- Review only: `src/ui/PromptQuickList.test.tsx`
- Review only: `docs/plans/2026-07-04-reset-hover-preview-on-popover-open.md`

**Step 1: Confirm branch and latest commit**

Run:

```bash
git branch --show-current
git log -1 --oneline
git rev-parse HEAD origin/main
```

Expected:
- Branch is `main`.
- Latest commit is `69b0800 fix: reset prompt hover preview lifecycle` or a later commit that includes it.
- `HEAD` and `origin/main` match before doing any new work, unless a later intentional commit exists.

**Step 2: Inspect working tree without staging anything**

Run:

```bash
git status --short --branch
```

Expected:
- Source files for the hover-preview fix are clean.
- Existing local generated/cache changes may still appear, such as:
  - `node_modules/.package-lock.json`
  - `src-tauri/target/release/...`
  - old unrelated plan files
- Do not revert or stage those unrelated files in this task.

**Step 3: Re-read the acceptance checklist from the original plan**

Run:

```bash
nl -ba docs/plans/2026-07-04-reset-hover-preview-on-popover-open.md | sed -n '403,423p'
```

Expected checklist:
- Opening Calico prompt list does not show a hover detail panel immediately.
- Reopening after moving away does not show a stale detail panel.
- Hovering for less than 1.5 seconds does not show detail.
- Hovering for 1.5 seconds shows detail above the prompt container.
- Closing while detail is visible, then reopening, does not restore old detail.
- Clicking a prompt while detail is visible clears the detail before the prompt action continues.

---

### Task 2: Run Automated Guard Verification Before Manual Check

**Files:**
- No code changes expected.

**Step 1: Run focused tests for current task**

Run:

```bash
npm test -- --run src/ui/PromptQuickList.test.tsx src/app/App.test.tsx
```

Expected:
- PASS.
- Report exact counts from output.

**Step 2: Run build to ensure the app can be launched**

Run:

```bash
npm run build
```

Expected:
- PASS.
- Vite produces `dist/index.html` and assets.

**Step 3: Do not commit build output unless it changed intentionally**

Run:

```bash
git status --short -- dist src/App.tsx src/app/App.test.tsx src/ui/PromptQuickList.tsx src/ui/PromptQuickList.test.tsx
```

Expected:
- If `npm run build` changes tracked `dist` assets due to hash churn, do not commit yet.
- Only commit `dist` if a later code fix is made and the build output must be updated.

---

### Task 3: Manual Product Acceptance In Tauri Dev App

**Files:**
- No code changes expected.

**Step 1: Start the dev app**

Run:

```bash
npm run tauri dev
```

Expected:
- App launches.
- Calico appears.
- The menu bar app remains usable.

If another `Prompt Picker` process blocks startup, stop the old process first:

```bash
pkill -f "Prompt Picker" || true
pkill -f "prompt-picker" || true
```

Then run `npm run tauri dev` again.

**Step 2: Check clean open**

Manual steps:
1. Click Calico once to open the prompt list.
2. Do not move the mouse over a prompt item after the list opens.

Expected:
- Prompt list appears.
- No hover detail panel appears immediately.

**Step 3: Check reopen after no-hover close**

Manual steps:
1. Click Calico again to close the list.
2. Move the mouse away from all prompt containers.
3. Click Calico again to reopen the list.

Expected:
- Prompt list appears clean.
- No old hover detail panel appears.

**Step 4: Check 1.5-second delay**

Manual steps:
1. Move the cursor onto a prompt container.
2. Move away before 1.5 seconds.

Expected:
- No hover detail panel appears.

**Step 5: Check hover detail still works**

Manual steps:
1. Move the cursor onto a prompt container.
2. Keep it there for at least 1.5 seconds.

Expected:
- Hover detail panel appears.
- It is anchored near/above the hovered prompt container.
- It shows only the prompt body content, not title/meta.

**Step 6: Check stale detail is cleared across close/reopen**

Manual steps:
1. With the hover detail panel visible, click Calico to close the prompt list.
2. Click Calico again to reopen the prompt list.

Expected:
- Prompt list opens without the old hover detail panel.
- Detail panel appears again only after a fresh hover delay.

**Step 7: Check prompt selection cleanup**

Manual steps:
1. Open the prompt list.
2. Hover a prompt until the detail panel is visible.
3. Click that prompt.

Expected:
- Hover detail panel disappears immediately.
- Prompt action continues according to current setting:
  - Paste + Return: prompt is sent.
  - Paste only: prompt is inserted into the target input.

**Step 8: Stop the dev app**

Stop the dev server/app with `Ctrl+C` in the terminal running `npm run tauri dev`.

Expected:
- No long-running dev process remains.

---

### Task 4: If Manual Acceptance Fails, Fix Only The Reproduced Bug

**Files:**
- Modify only if needed: `src/App.tsx`
- Modify only if needed: `src/ui/PromptQuickList.tsx`
- Test only if needed: `src/app/App.test.tsx`
- Test only if needed: `src/ui/PromptQuickList.test.tsx`

**Step 1: Record exact failure**

Write down:
- Which manual step failed.
- What was expected.
- What actually happened.
- Whether it reproduced twice.

Expected:
- Do not change code until the failure is reproducible.

**Step 2: Add or adjust a failing regression test**

Choose the closest test file:
- `src/ui/PromptQuickList.test.tsx` for component hover state issues.
- `src/app/App.test.tsx` for popover lifecycle event issues.

Run the focused test:

```bash
npm test -- --run src/ui/PromptQuickList.test.tsx src/app/App.test.tsx
```

Expected:
- New or adjusted test fails before the fix.

**Step 3: Implement the smallest code fix**

Rules:
- Do not change autosend behavior.
- Do not change prompt data shape.
- Do not change Rust window positioning.
- Do not redesign UI.
- Touch only the minimum React code needed for the reproduced failure.

**Step 4: Verify focused tests pass**

Run:

```bash
npm test -- --run src/ui/PromptQuickList.test.tsx src/app/App.test.tsx
```

Expected:
- PASS.

**Step 5: Run full verification**

Run:

```bash
npm test -- --run
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected:
- All pass.

**Step 6: Commit only if code changed**

Run:

```bash
git add src/App.tsx src/app/App.test.tsx src/ui/PromptQuickList.tsx src/ui/PromptQuickList.test.tsx dist/index.html dist/assets
git commit -m "fix: address hover preview acceptance issue"
```

Expected:
- Commit contains only the reproduced bug fix and necessary build assets.

---

### Task 5: If Manual Acceptance Passes, Mark The Task Accepted Without Code Changes

**Files:**
- No code changes expected.
- Optional create only if the project wants a local acceptance note: `docs/plans/2026-07-04-hover-preview-manual-acceptance-result.md`

**Step 1: Re-check status**

Run:

```bash
git status --short --branch
```

Expected:
- No current-task source changes.
- Existing unrelated local generated/cache changes may remain.

**Step 2: Do not create a commit if no code changed**

Expected:
- If manual acceptance passes and no code changed, do not create a “verification-only” code commit.
- Report the manual acceptance result to the user.

**Step 3: Push only if a new fix commit exists**

If Task 4 created a commit, run:

```bash
git push origin main
```

Expected:
- Push succeeds.

If no new commit exists:
- No push is required because `69b0800` is already on `origin/main`.

**Step 4: Final user-facing report**

Report:
- Whether manual acceptance passed.
- Whether any code changed.
- Verification commands and exact pass counts.
- Current user-visible behavior:
  - Clicking Calico opens a clean list.
  - Old hover detail panels do not carry over.
  - Hover detail appears only after a fresh 1.5-second hover.
  - Clicking a prompt clears hover UI before prompt action continues.
