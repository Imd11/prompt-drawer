# Prompt Popover List Layout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Calico prompt popover taller, show group prompt containers with two complete preview rows, and render hover details as a floating preview instead of adding content below the list.

**Architecture:** Keep the prompt selection behavior unchanged. Increase the native Tauri popover window height, update the quick-list CSS for separate single/group card heights, and convert the hover preview from normal document flow into an absolutely positioned tooltip inside the popover shell.

**Tech Stack:** React, TypeScript, CSS, Tauri v2, Rust unit tests, Vitest.

---

### Task 1: Lock The Desired Quick List Structure In Tests

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/ui/PromptQuickList.test.tsx`

**Step 1: Add a test that group cards expose two preview rows**

Add a focused assertion to the existing group preview test:

```tsx
const groupOption = screen.getByRole("option", { name: /修复流程/i });
expect(groupOption.textContent).toContain("1. 分析根本原因。");
expect(groupOption.textContent).toContain("2. 执行修复。");
expect(groupOption.textContent).not.toContain("3. 完成验证。");
```

Expected behavior:
- Single prompt cards show one preview line.
- Group prompt cards show exactly the first two ordered prompt lines.

**Step 2: Add a test that hover preview is a floating tooltip outside the listbox**

Add:

```tsx
it("renders hover preview as a floating tooltip outside the listbox", () => {
  render(<PromptQuickList prompts={prompts} onSelect={() => {}} />);

  const listbox = screen.getByRole("listbox", { name: "Prompts" });
  fireEvent.mouseEnter(screen.getByRole("option", { name: /修复流程/i }));

  const tooltip = screen.getByRole("tooltip");
  expect(listbox.contains(tooltip)).toBe(false);
  expect(tooltip.className).toContain("prompt-hover-preview");
  expect(tooltip.className).toContain("prompt-hover-preview-floating");
});
```

This test does not validate exact pixels; it protects the important UI contract: hover details must be a tooltip layer, not another row inside the list.

**Step 3: Run the test and verify it fails**

Run:

```bash
npm test -- --run src/ui/PromptQuickList.test.tsx
```

Expected:
- The new floating tooltip class assertion fails before implementation.

---

### Task 2: Increase The Native Popover Window Height

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs`

**Step 1: Add a Rust regression test for popover height**

In the existing `windows::tests` module, add:

```rust
#[test]
fn prompt_popover_height_supports_group_prompt_previews() {
    assert!(POPOVER_HEIGHT >= 320.0);
}
```

**Step 2: Run the focused Rust test and verify it fails**

Run:

```bash
cargo test prompt_popover_height_supports_group_prompt_previews --manifest-path src-tauri/Cargo.toml
```

Expected:
- FAIL while `POPOVER_HEIGHT` is still `240.0`.

**Step 3: Increase the height constant**

Change:

```rust
pub const POPOVER_HEIGHT: f64 = 240.0;
```

to:

```rust
pub const POPOVER_HEIGHT: f64 = 340.0;
```

Do not change `POPOVER_WIDTH` unless a visual check later proves the current width is insufficient. This task is about vertical capacity.

**Step 4: Run the focused Rust test and verify it passes**

Run:

```bash
cargo test prompt_popover_height_supports_group_prompt_previews --manifest-path src-tauri/Cargo.toml
```

Expected:
- PASS.

---

### Task 3: Give Single And Group Cards Separate Visual Heights

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/styles.css`

**Step 1: Increase list capacity**

Change `.prompt-quick-list` from:

```css
.prompt-quick-list {
  max-height: 216px;
}
```

to:

```css
.prompt-quick-list {
  max-height: 312px;
}
```

This matches the larger native window and keeps scrolling for long prompt libraries.

**Step 2: Keep single cards compact**

Set single card height explicitly:

```css
.prompt-quick-item {
  min-height: 64px;
  padding: 10px 12px;
}
```

**Step 3: Give group cards enough room for two preview rows**

Add to `.prompt-quick-item-group`:

```css
.prompt-quick-item-group {
  min-height: 88px;
  padding-top: 12px;
  padding-bottom: 12px;
}
```

**Step 4: Ensure preview rows never wrap into extra layout height**

Keep this behavior:

```css
.prompt-quick-preview-line {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

Do not allow group preview text to wrap. The target is two complete rows visually, with each row clipped by ellipsis if its content is too long.

**Step 5: Run the quick-list test**

Run:

```bash
npm test -- --run src/ui/PromptQuickList.test.tsx
```

Expected:
- PASS.

---

### Task 4: Convert Hover Preview Into A Floating Tooltip

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/ui/PromptQuickList.tsx`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/styles.css`
- Test: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/ui/PromptQuickList.test.tsx`

**Step 1: Replace hovered id state with hover preview state**

In `PromptQuickList.tsx`, replace:

```tsx
const [hoveredPromptId, setHoveredPromptId] = useState<string | null>(null);
const hoveredPrompt = prompts.find((prompt) => prompt.id === hoveredPromptId) ?? null;
```

with:

```tsx
type HoverPreviewState = {
  promptId: string;
  top: number;
  placement: "above" | "below";
};

const [hoverPreview, setHoverPreview] = useState<HoverPreviewState | null>(null);
const hoveredPrompt = prompts.find((prompt) => prompt.id === hoverPreview?.promptId) ?? null;
```

**Step 2: Add a helper that anchors the tooltip near the hovered card**

Add near the top of `PromptQuickList.tsx`, outside the component:

```tsx
const HOVER_PREVIEW_MAX_HEIGHT = 180;
const HOVER_PREVIEW_MIN_USEFUL_SPACE = 120;
const HOVER_PREVIEW_GAP = 8;
const HOVER_PREVIEW_MARGIN = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
```

Add inside the component:

```tsx
function showHoverPreview(prompt: PromptContainer, target: HTMLElement) {
  const shell = target.closest(".prompt-quick-shell") as HTMLElement | null;
  const targetRect = target.getBoundingClientRect();
  const shellRect = shell?.getBoundingClientRect();
  const shellHeight = Math.max(
    shellRect?.height ?? 0,
    shell?.clientHeight ?? 0,
    320
  );
  const localTop = shellRect ? targetRect.top - shellRect.top : target.offsetTop;
  const targetBottom = localTop + targetRect.height;
  const availableBelow = shellHeight - targetBottom - HOVER_PREVIEW_GAP - HOVER_PREVIEW_MARGIN;
  const availableAbove = localTop - HOVER_PREVIEW_GAP - HOVER_PREVIEW_MARGIN;
  const placement =
    availableBelow >= HOVER_PREVIEW_MIN_USEFUL_SPACE || availableBelow >= availableAbove
      ? "below"
      : "above";
  const idealTop = placement === "below"
    ? targetBottom + HOVER_PREVIEW_GAP
    : localTop - HOVER_PREVIEW_GAP - HOVER_PREVIEW_MAX_HEIGHT;
  const maxTop = Math.max(
    HOVER_PREVIEW_MARGIN,
    shellHeight - HOVER_PREVIEW_MAX_HEIGHT - HOVER_PREVIEW_MARGIN
  );

  setHoverPreview({
    promptId: prompt.id,
    top: clamp(idealTop, HOVER_PREVIEW_MARGIN, maxTop),
    placement,
  });
}
```

This must not use a fixed threshold like `220`. The tooltip position is based on available space inside the prompt shell, then clamped so it stays inside the visible popover area. This avoids the hover preview being clipped by `.popover-window { overflow: hidden; }` when the Calico popover is near the top or bottom of the screen.

**Step 3: Wire mouse and focus events to the helper**

Replace the current `onMouseEnter`, `onMouseLeave`, `onFocus`, and `onBlur` handlers with:

```tsx
onMouseEnter={(event) => showHoverPreview(prompt, event.currentTarget)}
onMouseLeave={() => setHoverPreview(null)}
onFocus={(event) => showHoverPreview(prompt, event.currentTarget)}
onBlur={() => setHoverPreview(null)}
```

**Step 4: Pass placement and top into `PromptHoverPreview`**

Change:

```tsx
{hoveredPrompt ? <PromptHoverPreview prompt={hoveredPrompt} /> : null}
```

to:

```tsx
{hoveredPrompt && hoverPreview ? (
  <PromptHoverPreview
    prompt={hoveredPrompt}
    top={hoverPreview.top}
    placement={hoverPreview.placement}
  />
) : null}
```

Update the component signature:

```tsx
function PromptHoverPreview({
  prompt,
  top,
  placement,
}: {
  prompt: PromptContainer;
  top: number;
  placement: "above" | "below";
}) {
```

Set the class and inline top:

```tsx
<aside
  className={`prompt-hover-preview prompt-hover-preview-floating ${
    placement === "above" ? "is-above" : "is-below"
  }`}
  role="tooltip"
  style={{ top }}
>
```

**Step 5: Change hover preview CSS to absolute positioning**

Replace the current `.prompt-hover-preview` layout rules with:

```css
.prompt-hover-preview {
  position: absolute;
  right: 10px;
  left: 10px;
  z-index: 20;
  max-height: 180px;
  overflow: auto;
  padding: 12px;
  color: var(--pp-text);
  background: rgba(255, 255, 255, 0.98);
  border: 1px solid var(--pp-border);
  border-radius: var(--pp-radius-lg);
  box-shadow: var(--pp-shadow-popover);
  pointer-events: none;
}

.prompt-hover-preview-floating.is-above,
.prompt-hover-preview-floating.is-below {
  transform: none;
}
```

Keep `.prompt-quick-shell { position: relative; }`. Do not use `transform: translateY(-100%)` for the above placement; the TypeScript helper already calculates a clamped `top` value. Keeping the final rendered box controlled by `top` prevents accidental clipping and makes the behavior easier to reason about.

**Step 6: Run quick-list tests**

Run:

```bash
npm test -- --run src/ui/PromptQuickList.test.tsx
```

Expected:
- PASS.

---

### Task 5: Validate Window Positioning Still Works With The Larger Popover

**Files:**
- Test only: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs`

**Step 1: Run existing popover positioning tests**

Run:

```bash
cargo test popover --manifest-path src-tauri/Cargo.toml
```

Expected:
- Existing tests pass.
- The tests that compute above/below positions should continue using `POPOVER_HEIGHT`, so the new height is automatically covered.

**Step 2: Run all window tests**

Run:

```bash
cargo test windows::tests --manifest-path src-tauri/Cargo.toml
```

Expected:
- PASS.

---

### Task 6: Full Verification

**Files:**
- No code changes unless tests reveal a regression.

**Step 1: Run focused frontend tests**

Run:

```bash
npm test -- --run src/ui/PromptQuickList.test.tsx
```

Expected:
- PASS.

**Step 2: Run frontend build**

Run:

```bash
npm run build
```

Expected:
- TypeScript passes.
- Vite build succeeds.

**Step 3: Run Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected:
- PASS.

**Step 4: Inspect changed files**

Run:

```bash
git diff -- src/ui/PromptQuickList.tsx src/styles.css src-tauri/src/windows.rs src/ui/PromptQuickList.test.tsx
```

Expected:
- Changes are limited to popover list layout, hover preview behavior, window height, and tests.
- No prompt sending behavior changes.
- No settings behavior changes.

---

### Task 7: User-Facing Result To Confirm

After implementation, the expected user-visible behavior is:

```text
Click Calico:

┌────────────────────────────────────┐
│ Single prompt                      │
│ one-line preview...                │
│                                    │
│ Group prompt   Group · 8 prompts   │
│ 1. first preview line...           │
│ 2. second preview line...          │
│                                    │
│ Another prompt                     │
│ one-line preview...                │
└────────────────────────────────────┘

Hover a card:

┌────────────────────────────────────┐
│ prompt list remains the same       │
│                                    │
│  ┌──── floating detail preview ──┐ │
│  │ complete prompt content        │ │
│  │ scrolls internally if long     │ │
│  └───────────────────────────────┘ │
└────────────────────────────────────┘
```

The hover detail no longer pushes the list downward or consumes list height.
