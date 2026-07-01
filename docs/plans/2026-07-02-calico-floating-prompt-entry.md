# Calico Floating Prompt Entry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current blue floating `P Prompts` button with an animated Calico cat desktop entry that stays draggable and opens the prompt list above the cat.

**Architecture:** The floating entry is currently a vanilla Tauri overlay page at `public/overlay.html`, rendered inside the `prompt-button` WebviewWindow created by `src-tauri/src/windows.rs`. This plan keeps that architecture, swaps the overlay UI to a Calico asset-driven button, increases the overlay window size, and changes popover placement to anchor above the Calico window with monitor-edge fallback.

**Tech Stack:** Tauri 2, Rust, vanilla HTML/CSS/JS overlay, Vitest, React app for the prompt list, macOS non-activating panels.

---

## Scope

- Do replace the blue `P Prompts` floating button with a Calico cat visual.
- Do support animation states: idle, hover, pressed/opening, dragging.
- Do keep click-to-open, right-click controls, drag persistence, and first-click behavior.
- Do place the prompt list above the Calico entry by default.
- Do clamp the list inside the active monitor and fall back below the cat if there is not enough space above.
- Do keep prompt paste behavior based on the existing last input target.
- Do not rebuild the whole app as a full desktop pet.
- Do not change prompt manager, prompt storage, or paste logic except tests proving they still work.

## Desired User Experience

```text
Before click:

                         [animated Calico]
                    draggable / always on top

After click:

              +--------------------------+
              | Prompt A                 |
              | Prompt B                 |
              | Prompt C                 |
              | Manage Prompts           |
              +--------------------------+
                          ^
                          |
                    [animated Calico]
```

## Asset Choices

Use the minimum Calico assets first:

- `public/calico/calico-idle.apng`
- `public/calico/calico-react-poke.apng`
- `public/calico/calico-react-drag.apng`
- `public/calico/calico-thinking.apng`

Optional later asset:

- `public/calico/calico-idle-follow.svg`

Keep the first implementation APNG-first to avoid adding SVG eye-tracking behavior in the same change.

---

### Task 1: Add Calico Overlay Asset References And Tests

**Files:**
- Modify: `src/overlay/overlayHtml.test.ts`
- Later create assets: `public/calico/calico-idle.apng`
- Later create assets: `public/calico/calico-react-poke.apng`
- Later create assets: `public/calico/calico-react-drag.apng`
- Later create assets: `public/calico/calico-thinking.apng`

**Step 1: Write the failing test**

Add a test that confirms the overlay HTML references Calico assets and no longer exposes the old text label as the primary visual.

```ts
it("renders the floating entry as an animated Calico character", () => {
  const html = readFileSync("public/overlay.html", "utf8");

  expect(html).toContain("calico-entry");
  expect(html).toContain("calico-idle.apng");
  expect(html).toContain("calico-react-poke.apng");
  expect(html).toContain("calico-react-drag.apng");
  expect(html).toContain("aria-label=\"Open Prompt Picker\"");
  expect(html).not.toContain("<span>Prompts</span>");
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- --run src/overlay/overlayHtml.test.ts
```

Expected: FAIL because `public/overlay.html` still contains the blue button markup and does not reference Calico assets.

**Step 3: Add the assets**

Create the asset directory:

```bash
mkdir -p public/calico
```

Download/copy these files from the Calico theme source:

```bash
curl -L -o public/calico/calico-idle.apng https://raw.githubusercontent.com/rullerzhou-afk/clawd-on-desk/main/themes/calico/assets/calico-idle.apng
curl -L -o public/calico/calico-react-poke.apng https://raw.githubusercontent.com/rullerzhou-afk/clawd-on-desk/main/themes/calico/assets/calico-react-poke.apng
curl -L -o public/calico/calico-react-drag.apng https://raw.githubusercontent.com/rullerzhou-afk/clawd-on-desk/main/themes/calico/assets/calico-react-drag.apng
curl -L -o public/calico/calico-thinking.apng https://raw.githubusercontent.com/rullerzhou-afk/clawd-on-desk/main/themes/calico/assets/calico-thinking.apng
```

**Step 4: Run test to verify it still fails**

Run:

```bash
npm test -- --run src/overlay/overlayHtml.test.ts
```

Expected: FAIL until `public/overlay.html` is updated.

**Step 5: Commit**

```bash
git add src/overlay/overlayHtml.test.ts public/calico
git commit -m "test: expect calico floating entry assets"
```

---

### Task 2: Replace The Blue Overlay Button With Calico UI

**Files:**
- Modify: `public/overlay.html`
- Test: `src/overlay/overlayHtml.test.ts`

**Step 1: Replace the overlay markup**

Replace the current button body:

```html
<button id="btn" title="Open Prompt Picker" aria-label="Open Prompt Picker">
  <span class="icon">P</span><span>Prompts</span>
</button>
```

with:

```html
<button id="btn" class="calico-entry" title="Open Prompt Picker" aria-label="Open Prompt Picker">
  <img id="calicoSprite" class="calico-sprite" src="/calico/calico-idle.apng" alt="" draggable="false" />
</button>
```

**Step 2: Replace the old button CSS**

Replace the compact blue-button styles with:

```css
html,
body {
  width: 100%;
  height: 100%;
  margin: 0;
  background: transparent;
  overflow: hidden;
}

body {
  display: grid;
  place-items: center;
}

.calico-entry {
  width: 132px;
  height: 132px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: grab;
  display: grid;
  place-items: center;
  -webkit-user-select: none;
  user-select: none;
}

.calico-entry:active {
  cursor: grabbing;
}

.calico-entry:focus-visible {
  outline: 2px solid rgba(74, 144, 217, 0.9);
  outline-offset: -10px;
  border-radius: 20px;
}

.calico-sprite {
  width: 126px;
  height: 126px;
  object-fit: contain;
  pointer-events: none;
  filter: drop-shadow(0 8px 12px rgba(0, 0, 0, 0.24));
  transform-origin: 50% 72%;
  transition: transform 140ms ease, filter 140ms ease;
}

.calico-entry:hover .calico-sprite {
  transform: translateY(-2px) scale(1.04);
  filter: drop-shadow(0 10px 16px rgba(0, 0, 0, 0.28));
}

.calico-entry.is-pressing .calico-sprite {
  transform: translateY(1px) scale(0.98);
}

.calico-entry.is-dragging .calico-sprite {
  transform: rotate(-2deg) scale(1.03);
}
```

**Step 3: Add sprite state helpers**

At the top of the script after `const btn = ...`, add:

```js
const sprite = document.getElementById('calicoSprite');
const sprites = {
  idle: '/calico/calico-idle.apng',
  poke: '/calico/calico-react-poke.apng',
  drag: '/calico/calico-react-drag.apng',
  thinking: '/calico/calico-thinking.apng'
};
let spriteResetTimer = 0;

function setSprite(state, resetMs = 0) {
  if (!sprite || !sprites[state]) return;
  window.clearTimeout(spriteResetTimer);
  if (!sprite.src.endsWith(sprites[state])) {
    sprite.src = sprites[state];
  }
  if (resetMs > 0) {
    spriteResetTimer = window.setTimeout(() => setSprite('idle'), resetMs);
  }
}
```

**Step 4: Wire pointer state classes**

In `pointerdown`, after state initialization, add:

```js
btn.classList.add('is-pressing');
setSprite('poke', 1200);
```

When drag begins, add:

```js
btn.classList.remove('is-pressing');
btn.classList.add('is-dragging');
setSprite('drag');
```

At the end of `pointerup`, add:

```js
btn.classList.remove('is-pressing', 'is-dragging');
setSprite('idle');
```

In the non-dragging click branch, before invoking `show_prompt_popover_from_button`, add:

```js
setSprite('thinking', 900);
```

**Step 5: Run test to verify it passes**

Run:

```bash
npm test -- --run src/overlay/overlayHtml.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add public/overlay.html src/overlay/overlayHtml.test.ts
git commit -m "feat: render calico floating entry"
```

---

### Task 3: Resize The Floating Window For Calico

**Files:**
- Modify: `src-tauri/src/windows.rs`
- Test: `src-tauri/src/windows.rs`
- Test: `src/overlay/overlayHtml.test.ts`

**Step 1: Write the failing Rust tests**

Replace the old width-specific test expectations with Calico dimensions:

```rust
#[test]
fn calico_button_window_uses_square_character_size() {
    assert_eq!(BUTTON_WIDTH, 132.0);
    assert_eq!(BUTTON_HEIGHT, 132.0);
}
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd src-tauri
cargo test calico_button_window_uses_square_character_size
```

Expected: FAIL because `BUTTON_WIDTH` is currently `112.0` and `BUTTON_HEIGHT` is `40.0`.

**Step 3: Change constants**

Change:

```rust
pub const BUTTON_WIDTH: f64 = 112.0;
pub const BUTTON_HEIGHT: f64 = 40.0;
```

to:

```rust
pub const BUTTON_WIDTH: f64 = 132.0;
pub const BUTTON_HEIGHT: f64 = 132.0;
```

**Step 4: Confirm the Tauri builder uses both constants**

Keep this code path:

```rust
.inner_size(BUTTON_WIDTH, BUTTON_HEIGHT)
```

Do not introduce separate magic numbers in `show_prompt_button`.

**Step 5: Run tests**

Run:

```bash
cd src-tauri
cargo test calico_button_window_uses_square_character_size
cd ..
npm test -- --run src/overlay/overlayHtml.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src-tauri/src/windows.rs
git commit -m "feat: resize floating entry for calico"
```

---

### Task 4: Change Popover Positioning To Above The Cat

**Files:**
- Modify: `src-tauri/src/windows.rs`
- Test: `src-tauri/src/windows.rs`

**Step 1: Write failing tests**

Replace the old `keeps_popover_to_right_when_there_is_room` test with top-anchor tests:

```rust
#[test]
fn places_popover_above_centered_on_calico_when_there_is_room() {
    let monitor = test_monitor(0.0, 0.0, 1440.0, 900.0);
    let position = clamp_popover_position(500.0, 400.0, BUTTON_WIDTH, Some(&monitor));

    let expected_x = 500.0 + (BUTTON_WIDTH / 2.0) - (POPOVER_WIDTH / 2.0);
    let expected_y = 400.0 - POPOVER_HEIGHT - POPOVER_GAP;
    assert_eq!(position, (expected_x, expected_y));
}

#[test]
fn places_popover_below_calico_when_top_has_no_room() {
    let monitor = test_monitor(0.0, 0.0, 1440.0, 900.0);
    let position = clamp_popover_position(500.0, 20.0, BUTTON_WIDTH, Some(&monitor));

    assert_eq!(position.1, 20.0 + BUTTON_HEIGHT + POPOVER_GAP);
}

#[test]
fn clamps_popover_horizontally_inside_monitor() {
    let monitor = test_monitor(0.0, 0.0, 1440.0, 900.0);
    let left = clamp_popover_position(4.0, 400.0, BUTTON_WIDTH, Some(&monitor));
    let right = clamp_popover_position(1390.0, 400.0, BUTTON_WIDTH, Some(&monitor));

    assert_eq!(left.0, 8.0);
    assert_eq!(right.0, 1440.0 - POPOVER_WIDTH - 8.0);
}
```

Use a helper if possible. If direct `tauri::Monitor` construction is not possible, extract the math into a pure helper:

```rust
#[derive(Clone, Copy)]
struct MonitorBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn clamp_popover_position_in_bounds(
    button_x: f64,
    button_y: f64,
    button_width: f64,
    button_height: f64,
    bounds: Option<MonitorBounds>,
) -> (f64, f64) {
    // implementation goes here
}
```

Then make `clamp_popover_position` adapt `tauri::Monitor` into `MonitorBounds`.

**Step 2: Run tests to verify they fail**

Run:

```bash
cd src-tauri
cargo test popover
```

Expected: FAIL because the current implementation places the popover right/left of the button.

**Step 3: Implement above-first positioning**

Use this algorithm:

```rust
fn clamp_popover_position_in_bounds(
    button_x: f64,
    button_y: f64,
    button_width: f64,
    button_height: f64,
    bounds: Option<MonitorBounds>,
) -> (f64, f64) {
    let centered_x = button_x + (button_width / 2.0) - (POPOVER_WIDTH / 2.0);
    let above_y = button_y - POPOVER_HEIGHT - POPOVER_GAP;
    let below_y = button_y + button_height + POPOVER_GAP;

    let Some(bounds) = bounds else {
        return (centered_x, above_y);
    };

    let margin = 8.0;
    let min_x = bounds.x + margin;
    let max_x = bounds.x + bounds.width - POPOVER_WIDTH - margin;
    let min_y = bounds.y + margin;
    let max_y = bounds.y + bounds.height - POPOVER_HEIGHT - margin;

    let x = centered_x.clamp(min_x, max_x);
    let y = if above_y >= min_y {
        above_y
    } else {
        below_y.clamp(min_y, max_y)
    };

    (x, y)
}
```

Update `button_relative_popover_position` to pass both `BUTTON_WIDTH` and `BUTTON_HEIGHT`.

**Step 4: Preserve button controls behavior**

Keep `show_prompt_button_controls_from_button` using the same anchor logic, so right-click controls also appear relative to the cat.

**Step 5: Run tests**

Run:

```bash
cd src-tauri
cargo test popover
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src-tauri/src/windows.rs
git commit -m "feat: anchor prompt popover above calico"
```

---

### Task 5: Keep Dragging Stable With The Larger Window

**Files:**
- Modify: `public/overlay.html`
- Test: `src/overlay/overlayHtml.test.ts`
- Review: `src/overlay/useInputTargetPolling.ts`
- Test: `src/overlay/useInputTargetPolling.test.ts`

**Step 1: Add tests for drag event preservation**

Extend `src/overlay/overlayHtml.test.ts`:

```ts
it("keeps existing drag and click commands for the Calico entry", () => {
  const html = readFileSync("public/overlay.html", "utf8");

  expect(html).toContain("prompt_button_position_cmd");
  expect(html).toContain("move_prompt_button_to");
  expect(html).toContain("show_prompt_popover_from_button");
  expect(html).toContain("prompt-button-drag-started");
  expect(html).toContain("prompt-button-drag-ended");
  expect(html).toContain("setPointerCapture");
  expect(html).toContain("releasePointerCapture");
});
```

**Step 2: Run test**

Run:

```bash
npm test -- --run src/overlay/overlayHtml.test.ts src/overlay/useInputTargetPolling.test.ts
```

Expected: PASS after previous tasks. If it fails, fix only the overlay event wiring.

**Step 3: Review drag threshold**

Keep this threshold unchanged:

```js
if (!dragging && distance(start, current) < 4) return;
```

Do not increase it unless actual testing shows click/drag ambiguity, because a larger visual does not require a larger movement threshold.

**Step 4: Ensure drag state resets on context menu**

In `openButtonControls`, ensure Calico class and sprite state reset:

```js
btn.classList.remove('is-pressing', 'is-dragging');
setSprite('idle');
```

**Step 5: Run tests**

Run:

```bash
npm test -- --run src/overlay/overlayHtml.test.ts src/overlay/useInputTargetPolling.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add public/overlay.html src/overlay/overlayHtml.test.ts
git commit -m "fix: preserve calico drag interactions"
```

---

### Task 6: Add Popover Visual Pointer Toward Calico

**Files:**
- Modify: `src/styles.css`
- Modify: `src/App.tsx` only if a class hook is needed
- Test: `src/ui/PromptQuickList.test.tsx`

**Step 1: Decide whether a CSS-only pointer is enough**

Prefer CSS-only. The existing popover content is:

```tsx
<div className="popover-window">
  <PromptQuickList prompts={prompts} onSelect={handleSelect} />
</div>
```

Add an `::after` on `.popover-window`:

```css
.popover-window::after {
  content: "";
  position: absolute;
  left: 50%;
  bottom: -8px;
  width: 14px;
  height: 14px;
  background: inherit;
  border-right: 1px solid rgba(148, 163, 184, 0.28);
  border-bottom: 1px solid rgba(148, 163, 184, 0.28);
  transform: translateX(-50%) rotate(45deg);
}
```

Only use this if `.popover-window` already has a solid background and `position: relative`. If not, add:

```css
.popover-window {
  position: relative;
}
```

**Step 2: Check top-edge fallback**

If the popover falls below the cat, the pointer should not point downward. Defer dynamic pointer direction unless the first manual pass makes it visually confusing. YAGNI for first version.

**Step 3: Run UI tests**

Run:

```bash
npm test -- --run src/ui/PromptQuickList.test.tsx src/app/App.test.tsx
```

Expected: PASS.

**Step 4: Commit**

```bash
git add src/styles.css
git commit -m "style: point prompt list toward calico"
```

---

### Task 7: Build And Package

**Files:**
- Read: `package.json`
- Generated: `dist/`
- Generated: `src-tauri/target/release/bundle/macos/Prompt Picker.app`
- Generated: `src-tauri/target/release/bundle/dmg/Prompt Picker_1.0.0_aarch64.dmg`

**Step 1: Run full frontend tests**

Run:

```bash
npm test -- --run
```

Expected: all test files pass.

**Step 2: Run frontend production build**

Run:

```bash
npm run build
```

Expected: TypeScript and Vite build complete without errors.

**Step 3: Run Rust release check**

Run:

```bash
cd src-tauri
cargo check --lib --release
cd ..
```

Expected: `Finished release profile`.

**Step 4: Package the app**

Run:

```bash
npm run tauri -- build
```

Expected output includes:

```text
Finished 2 bundles at:
    /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/target/release/bundle/macos/Prompt Picker.app
    /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/target/release/bundle/dmg/Prompt Picker_1.0.0_aarch64.dmg
```

**Step 5: Commit source changes only**

Do not include generated `target/` artifacts in a normal source commit unless the project intentionally tracks them.

```bash
git add public/overlay.html public/calico src-tauri/src/windows.rs src/styles.css src/overlay/overlayHtml.test.ts
git commit -m "feat: use animated calico as floating prompt entry"
```

---

### Task 8: Manual Acceptance Checklist

**Files:**
- Read: `docs/qa/codex-app-acceptance.md`
- Optional modify: `docs/qa/codex-app-acceptance.md`

**Step 1: Quit the old app**

Run:

```bash
pkill -f "/Prompt Picker.app/Contents/MacOS/prompt-picker" || true
```

Expected: old Prompt Picker process is not running.

**Step 2: Open the packaged app**

Run:

```bash
open "/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/target/release/bundle/macos/Prompt Picker.app"
```

Expected: Calico appears instead of the blue `P Prompts` button.

**Step 3: Verify click behavior**

Manual checks:

- Click Calico once.
- Prompt list appears above Calico.
- If Calico is near the top edge, prompt list appears below Calico instead of offscreen.
- If Calico is near the left/right edge, prompt list remains inside the monitor.

**Step 4: Verify drag behavior**

Manual checks:

- Drag Calico to a new screen position.
- Calico follows the pointer without jumping.
- Release drag.
- Click Calico again.
- Prompt list anchors to the new Calico position.

**Step 5: Verify paste behavior**

Manual checks:

- Click into a text input in another app.
- Click Calico.
- Choose a prompt from the list.
- Prompt text is inserted into the original text input.

**Step 6: Verify controls**

Manual checks:

- Right-click Calico.
- Button controls open.
- Hide/Open Prompt Picker actions still work.

**Step 7: Update QA notes if needed**

If there is a QA checklist entry for the floating button, update wording from "button" to "Calico floating entry" without changing unrelated docs.

**Step 8: Commit QA docs if changed**

```bash
git add docs/qa/codex-app-acceptance.md
git commit -m "docs: update calico floating entry qa checklist"
```

---

## Risks And Mitigations

- **Large transparent window blocks desktop clicks:** Keep the first window at `132x132`, not full pet size. If blocking feels bad, add tighter hitbox handling later.
- **APNG restart flicker:** Avoid changing sprite source on every hover; only switch on click/drag states.
- **Popover offscreen:** Cover above, below, left clamp, and right clamp with Rust tests.
- **Drag position jumps:** Preserve logical coordinate path using `prompt_button_position_cmd` and `move_prompt_button_to`.
- **Input target lost after clicking Calico:** Do not change `paste_prompt_to_last_target`; keep last-target storage.
- **Asset bundle missing:** Store assets under `public/calico` so Vite/Tauri includes them in `dist`.
- **Old running app hides results:** Quit old Prompt Picker before testing the packaged app.

## Verification Commands Summary

```bash
npm test -- --run src/overlay/overlayHtml.test.ts
npm test -- --run src/overlay/useInputTargetPolling.test.ts
npm test -- --run src/ui/PromptQuickList.test.tsx src/app/App.test.tsx
npm test -- --run
npm run build
cd src-tauri && cargo test popover && cargo check --lib --release && cd ..
npm run tauri -- build
```

## Final Expected Result

The user sees an animated Calico cat instead of the blue `P Prompts` button. The cat stays always-on-top, draggable, and responsive. Clicking the cat opens the prompt list above it when possible, with monitor-edge fallback. Prompt selection still pastes into the previously captured input target.
