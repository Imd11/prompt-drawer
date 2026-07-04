# Fix Language Dropdown and Segmented Controls Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the current settings language dropdown clipping and make the settings/manager segmented controls share one correct structure and selected state.

**Architecture:** Keep the existing settings and prompt manager page design intact. Apply two narrow UI fixes: the language card gets a floating-control escape hatch so its dropdown is not clipped, and segmented controls use one shared base style where selected-state color cannot be overridden by page-specific sizing rules. Add focused tests for the exact CSS regressions that caused the bugs, then verify with browser screenshots.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, CSS, Playwright or browser runtime for visual verification.

---

## Current Context

The current local worktree at `/Users/yang/Desktop/GitHub-pre/prompt-picker` is dirty and behind `origin/main` by one commit. Do not run `git reset --hard`, do not pull over the dirty worktree, and do not stage unrelated generated files.

Observed root causes in current local code:

- Language dropdown clipping:
  - `src/ui/SettingsPanel.tsx` renders the language card as `className="settings-card"`.
  - `src/styles.css` has `.settings-card { overflow: hidden; }`.
  - `src/styles.css` has `.language-dropdown-menu { position: absolute; top: calc(100% + 6px); }`.
  - The dropdown exists, but the part below the card is clipped by the card.

- Settings segmented control deformation:
  - `src/styles.css` has `.segmented-control { padding: 2px; border: 1px solid ...; overflow: hidden; }`.
  - `src/styles.css` has `.segmented-control button { min-height: 30px; }`.
  - `src/styles.css` has `.settings-segmented-control { height: 32px; }`.
  - With global `box-sizing: border-box`, the usable inner height is `32 - 2 border - 4 padding = 26px`, which is smaller than the 30px button. The selected thumb is clipped.

- Manager segmented selected text color:
  - `src/styles.css` has `.segmented-control button.is-selected { color: #ffffff; }`.
  - Later, `src/styles.css` has `.prompt-manager .segmented-control button { color: #475467; }`.
  - Both selectors have equal specificity. The later manager rule wins and turns selected text gray.

## Scope Boundaries

- Do not redesign the settings page or prompt manager page.
- Do not change the page background, card color, card spacing, typography scale, main window dimensions, or prompt behavior.
- Do not change prompt storage, `intervalMs`, import/export, autosend, Calico motion, or Tauri window behavior.
- Do not stage or commit `dist`, `node_modules`, `src-tauri/target`, release bundles, or unrelated parallel-task files.
- Only touch files required for these two UI bugs and their tests.

---

### Task 1: Lock the Language Dropdown Escape Hatch

**Files:**
- Modify: `src/ui/SettingsPanel.test.tsx`
- Modify: `src/ui/SettingsPanel.tsx`
- Modify: `src/styles.css`

**Step 1: Write the failing test**

Add this test to `src/ui/SettingsPanel.test.tsx` inside the existing `describe("settings panel", ...)` block:

```tsx
it("allows the language dropdown to escape the settings card clipping boundary", () => {
  renderPanel();

  const trigger = screen.getByRole("button", { name: /界面语言.*中文/ });
  const card = trigger.closest(".settings-card");

  expect(card).toBeTruthy();
  expect(card?.classList.contains("settings-card--floating-control")).toBe(true);
});
```

**Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- src/ui/SettingsPanel.test.tsx
```

Expected: FAIL because the current language card is only `settings-card`.

**Step 3: Add the minimal JSX class**

In `src/ui/SettingsPanel.tsx`, change the language section from:

```tsx
<section className="settings-card">
```

to:

```tsx
<section className="settings-card settings-card--floating-control">
```

Do not add this class to the prompt click behavior card.

**Step 4: Add the CSS escape hatch**

In `src/styles.css`, directly after `.settings-card { ... }`, add:

```css
.settings-card--floating-control {
  overflow: visible;
}
```

Then update `.settings-card-heading` to preserve the top corners when the card no longer clips children:

```css
.settings-card-heading {
  display: flex;
  min-height: 38px;
  align-items: center;
  padding: 0 14px;
  background: var(--pp-surface-subtle);
  border-bottom: 1px solid var(--pp-border);
  border-radius: calc(var(--pp-radius-sm) - 1px) calc(var(--pp-radius-sm) - 1px) 0 0;
}
```

**Step 5: Run focused tests**

Run:

```bash
npm test -- src/ui/SettingsPanel.test.tsx
```

Expected: PASS.

**Step 6: Commit**

Only if the user later asks to execute and commit:

```bash
git add src/ui/SettingsPanel.test.tsx src/ui/SettingsPanel.tsx src/styles.css
git commit -m "fix: keep settings language dropdown visible"
```

Do not stage generated artifacts.

---

### Task 2: Add CSS Regression Tests for Segmented Control Root Causes

**Files:**
- Create: `src/ui/SegmentedControlStyles.test.ts`
- Modify later: `src/styles.css`

**Step 1: Create the regression test file**

Create `src/ui/SegmentedControlStyles.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "m"));
  return match?.[1] ?? "";
}

describe("segmented control styles", () => {
  it("does not compress the settings segmented control below its selected thumb", () => {
    const settingsBody = ruleBody(".settings-segmented-control");

    expect(settingsBody).not.toMatch(/height\\s*:\\s*32px/);
  });

  it("does not override selected segmented button text color in prompt manager", () => {
    const managerButtonBody = ruleBody(".prompt-manager .segmented-control button");

    expect(managerButtonBody).not.toMatch(/color\\s*:/);
  });

  it("keeps selected segmented buttons white on a dark thumb", () => {
    const selectedBody = ruleBody(".segmented-control button.is-selected");

    expect(selectedBody).toMatch(/background\\s*:\\s*var\\(--pp-text\\)/);
    expect(selectedBody).toMatch(/color\\s*:\\s*#ffffff/);
  });
});
```

**Step 2: Run the new test to verify it fails**

Run:

```bash
npm test -- src/ui/SegmentedControlStyles.test.ts
```

Expected: FAIL on at least these two assertions:

- `.settings-segmented-control` still contains `height: 32px`.
- `.prompt-manager .segmented-control button` still contains `color: #475467`.

**Step 3: Keep this test narrow**

Do not test every visual property. This file exists only to prevent the two root causes from returning:

- Fixed-height compression of settings segmented control.
- Manager page overriding selected button text color.

---

### Task 3: Fix the Shared Segmented Control Structure

**Files:**
- Modify: `src/styles.css`
- Verify: `src/ui/SettingsPanel.tsx`
- Verify: `src/ui/PromptManager.tsx`

**Step 1: Keep the shared base selected state**

In `src/styles.css`, keep the selected state as the single source of truth:

```css
.segmented-control button.is-selected {
  color: #ffffff;
  background: var(--pp-text);
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
}
```

This rule must not be overridden by page-specific button color rules.

**Step 2: Remove the settings fixed height**

Change:

```css
.settings-segmented-control {
  height: 32px;
  background: var(--pp-surface);
  border-color: var(--pp-border-strong);
}
```

to:

```css
.settings-segmented-control {
  background: var(--pp-surface);
  border-color: var(--pp-border-strong);
}
```

Reason: the base segmented control already has padding, border, and button min-height. A fixed `32px` height creates only `26px` of inner height and clips the 30px button.

**Step 3: Stop the settings sizing override from touching selected color**

Change:

```css
.settings-segmented-control button {
  min-width: 78px;
  color: #475467;
}
```

to:

```css
.settings-segmented-control button {
  min-width: 78px;
}
```

If non-selected text color must be explicit, use a non-selected selector:

```css
.settings-segmented-control button:not(.is-selected) {
  color: #475467;
}
```

Use the simpler version unless visual verification proves the non-selected color changes.

**Step 4: Stop manager sizing override from touching selected color**

Change:

```css
.prompt-manager .segmented-control button {
  min-width: 78px;
  color: #475467;
}
```

to:

```css
.prompt-manager .segmented-control button {
  min-width: 78px;
}
```

If non-selected text color must be explicit, use:

```css
.prompt-manager .segmented-control button:not(.is-selected) {
  color: #475467;
}
```

Do not put `color` on `.prompt-manager .segmented-control button`, because it has the same specificity as `.segmented-control button.is-selected` and appears later in the file.

**Step 5: Verify both JSX call sites still share the same base class**

Verify `src/ui/SettingsPanel.tsx` still uses:

```tsx
className="segmented-control settings-segmented-control"
```

Verify `src/ui/PromptManager.tsx` still uses:

```tsx
className="segmented-control"
```

No JSX refactor is needed for this task unless the classes have drifted.

**Step 6: Run focused tests**

Run:

```bash
npm test -- src/ui/SegmentedControlStyles.test.ts src/ui/SettingsPanel.test.tsx src/ui/PromptManager.test.tsx
```

Expected: PASS.

**Step 7: Commit**

Only if the user later asks to execute and commit:

```bash
git add src/ui/SegmentedControlStyles.test.ts src/styles.css
git commit -m "fix: align segmented control selected states"
```

Do not stage generated artifacts.

---

### Task 4: Browser Visual Verification

**Files:**
- Verify: `src/styles.css`
- Verify: `src/ui/SettingsPanel.tsx`
- Verify: `src/ui/LanguageDropdown.tsx`
- Verify: `src/ui/PromptManager.tsx`

**Step 1: Run type check and build to a temp output**

Run:

```bash
npx tsc --noEmit
npx vite build --outDir /tmp/prompt-picker-dropdown-segmented-build --emptyOutDir
```

Expected: PASS.

Do not build to tracked `dist`.

**Step 2: Start the Vite dev server**

Run:

```bash
npm run dev -- --host 127.0.0.1
```

Expected: Vite serves at `http://127.0.0.1:1420/`.

If port `1420` is occupied, use the actual URL printed by Vite.

**Step 3: Verify settings page at desktop and small widths**

Open:

```text
http://127.0.0.1:1420/?mode=settings
```

Check these viewports:

```text
1520 x 1118
760 x 560
640 x 460
```

Expected:

- Language dropdown opens downward and is fully visible.
- Dropdown appears above the next settings card, not behind it.
- Settings click behavior segmented control has a complete selected thumb.
- Selected button text is white on dark background.
- The selected thumb has four complete rounded corners.
- No bottom clipping, flat bottom corners, or asymmetric height.
- No horizontal overflow.

**Step 4: Verify prompt manager page at desktop and small widths**

Open:

```text
http://127.0.0.1:1420/?mode=manager
```

Check these viewports:

```text
1520 x 1118
760 x 560
640 x 460
```

Expected:

- Manager `单个 / 群组` segmented control uses the same structure as settings.
- Selected button text is white on dark background.
- Unselected button text remains muted gray-blue.
- The selected thumb is not clipped.
- No color override produces black background with gray text.
- No horizontal overflow.

**Step 5: Stop the dev server**

Use `Ctrl-C`.

**Step 6: Capture visual evidence if available**

If Playwright is available, save screenshots under:

```text
docs/qa/dropdown-segmented-control-fix/
```

Suggested screenshot names:

```text
settings-1520x1118-dropdown.png
settings-640x460-dropdown.png
manager-1520x1118-segmented.png
manager-640x460-segmented.png
```

If screenshots are committed, add a short QA markdown:

```text
docs/qa/dropdown-segmented-control-fix.md
```

Do not add screenshots unless they are intentionally part of the verification record.

---

### Task 5: Final Verification and Handoff

**Files:**
- No code changes expected unless Task 4 finds a visual issue.

**Step 1: Run the focused tests**

Run:

```bash
npm test -- src/ui/SegmentedControlStyles.test.ts src/ui/SettingsPanel.test.tsx src/ui/PromptManager.test.tsx
```

Expected: PASS.

**Step 2: Run the full frontend test suite**

Run:

```bash
npm test
```

Expected: PASS.

**Step 3: Run type check and build**

Run:

```bash
npx tsc --noEmit
npx vite build --outDir /tmp/prompt-picker-dropdown-segmented-final-build --emptyOutDir
```

Expected: PASS.

**Step 4: Check git status**

Run:

```bash
git status --short --branch
```

Expected:

- Only files intentionally changed by this plan are staged/committed.
- Existing unrelated dirty files may remain, but they must not be staged.
- No `dist`, `node_modules`, `src-tauri/target`, or release bundle changes are staged.

**Step 5: Report the user-facing result**

Report:

- Language dropdown is fully visible and no longer clipped by the settings card.
- Settings and manager segmented controls now share the same structure.
- Settings selected thumb is no longer vertically clipped.
- Manager selected button now uses white text on the dark selected thumb.
- The overall settings and prompt manager visual system was preserved.
- No generated artifacts were included.

---

## Acceptance Criteria

- The language dropdown is fully visible when opened.
- The language dropdown is not rendered as a native system select.
- The language dropdown can still close by option selection, outside click, and Escape.
- The settings language card is the only settings card allowed to overflow for a floating control.
- The settings segmented control has no fixed height that clips its selected thumb.
- The manager segmented control does not override selected text color.
- Both segmented controls show selected state as dark background with white text.
- Both segmented controls have complete rounded selected-thumb corners.
- Both segmented controls remain visually consistent with the existing blue-gray, white-panel design.
- No global page redesign is introduced.
- Focus states remain neutral and keyboard-visible.
- `npm test -- src/ui/SegmentedControlStyles.test.ts src/ui/SettingsPanel.test.tsx src/ui/PromptManager.test.tsx` passes.
- `npm test` passes.
- `npx tsc --noEmit` passes.
- Vite build to `/tmp` passes.
- Visual verification passes at `1520x1118`, `760x560`, and `640x460`.
- No generated artifacts are staged or committed.
