# Calico Motion Rhythm Hover Hit Area Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Calico feel alive and responsive by preventing animation clipping, using the existing click/drag hit area for hover attention, adding hover wake/happy responses, and replacing the current long-gap idle tiers with a smoother weighted rhythm.

**Architecture:** Separate the native transparent animation window from the interactive hit area: the Tauri window becomes larger to avoid clipping, while the centered HTML button remains the source of click, drag, and hover events. Replace hard idle tiers with a weighted motion pool and short rhythm phases; keep protected semantic motions (`react-drag`, `happy`, `working-*`, `error`, `notification`) outside random idle and hover interruption paths.

**Tech Stack:** Tauri v2 macOS transparent window, vanilla overlay HTML/CSS/JS, browser ES modules, existing Calico APNG/SVG assets, Vitest, Rust unit tests.

---

## Current Context

The floating Calico entry is currently a `132x132` native transparent Tauri window:

- `src-tauri/src/windows.rs`
  - `BUTTON_WIDTH = 132.0`
  - `BUTTON_HEIGHT = 132.0`
  - `show_prompt_button(...)` creates `overlay.html` with `.inner_size(BUTTON_WIDTH, BUTTON_HEIGHT)`
- `public/overlay.html`
  - `html, body { overflow: hidden; }`
  - `.calico-entry { width: 132px; height: 132px; }`
  - `.calico-sprite { width: 126px; height: 126px; transform: translate(...) scale(...); }`

The clipped body/feet issue is caused by the native transparent window boundary, not simply by image loading. Transparent background does not allow drawing outside the native window bounds.

The current click-to-open, drag, and right-click controls are all bound to the same DOM element:

```html
<button id="btn" class="calico-entry" aria-label="Open Prompt Picker">
  <img id="calicoSprite" class="calico-sprite" ... />
</button>
```

Therefore hover attention should use this same `btn` hit area, not the entire enlarged transparent window.

The current codebase does not yet have `public/calico/idle-director.js`, and `public/overlay.html` currently imports only `/calico/motion-runtime.js`. A previous rich-idle plan used hard tiers like this:

```js
IDLE_MOTION_TIERS = [
  { name: "light", delayRangeMs: [9_000, 16_000], states: [...] },
  { name: "settled", delayRangeMs: [12_000, 22_000], states: [...] },
  { name: "deep", delayRangeMs: [18_000, 32_000], states: [...] },
];
```

Those long hard-tier pauses would make `idle-follow` occupy roughly 76%-85% of idle time and create visible stop-start stutter. This plan must create and wire a new weighted idle director from the current code state, not assume that an old `idle-director.js` already exists.

## UX Contract

From the user's perspective:

- Calico should no longer look clipped by an invisible rectangle.
- The clickable/hoverable area should match the current prompt-list click area, not the whole transparent animation window.
- Mouse entering the effective Calico hit area should make Calico respond as if it noticed the user.
- If Calico was sleeping/dozing, hover should wake it.
- If Calico was idle/peeking, hover should use a light happy/greeting motion.
- Hover must not use `happy`; `happy` remains reserved for successful prompt send.
- Hover must not interrupt `react-drag`, `happy`, `working-*`, `error`, or `notification`.
- Plain click-to-open remains neutral; it should not trigger `thinking`, `react-poke`, hover response, or any abrupt action.
- Dragging still immediately shows `react-drag`.
- Successful prompt send still shows `happy` completely.
- Idle motion should feel continuous and alive, not frozen between long gaps.

Target rhythm:

```text
After user action: 0-7s quiet idle-follow
Early idle:        7-30s, 2.5-5s between idle flourishes
Settled idle:      30-90s, 2-4.5s between idle flourishes
Long idle:         90s+, 3-6s between idle flourishes
```

## Constants To Introduce

Use names that make the native window and the interactive hit area distinct:

```rust
pub const BUTTON_VISUAL_WIDTH: f64 = 132.0;
pub const BUTTON_VISUAL_HEIGHT: f64 = 132.0;
pub const BUTTON_WINDOW_WIDTH: f64 = 208.0;
pub const BUTTON_WINDOW_HEIGHT: f64 = 208.0;
pub const BUTTON_WINDOW_PADDING_X: f64 = (BUTTON_WINDOW_WIDTH - BUTTON_VISUAL_WIDTH) / 2.0;
pub const BUTTON_WINDOW_PADDING_Y: f64 = (BUTTON_WINDOW_HEIGHT - BUTTON_VISUAL_HEIGHT) / 2.0;
```

For HTML/CSS, use matching custom properties:

```css
:root {
  --calico-hit-area-size: 132px;
  --calico-sprite-size: 126px;
}
```

Do not make the entire `208x208` window clickable. The hit area remains the centered `#btn`.

## Risk Fixes Incorporated After Code Review

These corrections are required before implementation. Do not skip them while executing the plan.

- Do not repurpose `prompt_button_window_position(...)` for visual-to-window conversion if it is still used by popover positioning. Popover windows use ordinary logical coordinates and must not have Calico padding subtracted.
- Add separate helpers for Calico button coordinates and generic window coordinates:
  - `prompt_button_visual_to_window_position(...)`
  - `prompt_button_window_to_visual_position(...)`
  - `prompt_button_position_from_visual(...)`
  - `logical_position(...)`
- `prompt_button_position_cmd` must return the visual Calico hit-area position, not the enlarged native transparent window corner.
- `move_prompt_button_to` must accept visual coordinates from overlay JS and convert them before calling `set_position`.
- `button_relative_popover_position(...)` must convert the native button window position back to visual coordinates before anchoring the popover.
- Outside-click dismissal must treat only the visual `132x132` hit area as the button rect. The transparent padding around the enlarged native window must not keep the popover open.
- Existing visible button windows must be resized to `BUTTON_WINDOW_WIDTH` / `BUTTON_WINDOW_HEIGHT` on reuse; otherwise users running an existing session can keep the old clipped `132x132` native window.
- `public/calico/idle-director.js` does not exist in the current codebase. The implementation must create it and wire it into `public/overlay.html` after the manifest and motion runtime initialize.
- If `208x208` is still too small during visual verification, increase only the native transparent window size and padding constants. Do not increase the `132x132` click/drag/hover hit area without explicit user approval.

---

### Task 1: Add Native Window Geometry Tests

**Files:**
- Modify: `src-tauri/src/windows.rs`

**Step 1: Write failing tests for distinct window and visual sizes**

Add tests in the existing `#[cfg(test)] mod tests` block:

```rust
#[test]
fn calico_button_window_has_animation_padding() {
    assert_eq!(BUTTON_VISUAL_WIDTH, 132.0);
    assert_eq!(BUTTON_VISUAL_HEIGHT, 132.0);
    assert_eq!(BUTTON_WINDOW_WIDTH, 208.0);
    assert_eq!(BUTTON_WINDOW_HEIGHT, 208.0);
    assert_eq!(BUTTON_WINDOW_PADDING_X, 38.0);
    assert_eq!(BUTTON_WINDOW_PADDING_Y, 38.0);
}

#[test]
fn calico_button_window_uses_larger_native_transparent_size() {
    assert!(BUTTON_WINDOW_WIDTH > BUTTON_VISUAL_WIDTH);
    assert!(BUTTON_WINDOW_HEIGHT > BUTTON_VISUAL_HEIGHT);
}

#[test]
fn calico_visual_and_window_positions_round_trip() {
    let visual = (320.0, 240.0);
    let window = prompt_button_visual_to_window_position(visual.0, visual.1);

    assert_eq!(window, (282.0, 202.0));
    assert_eq!(prompt_button_window_to_visual_position(window.0, window.1), visual);
}

#[test]
fn calico_button_position_from_visual_subtracts_padding_without_affecting_generic_windows() {
    let button_position = prompt_button_position_from_visual(320.0, 240.0);
    let generic_position = logical_position(320.0, 240.0);

    match button_position {
        tauri::Position::Logical(logical) => {
            assert_eq!(logical.x, 282.0);
            assert_eq!(logical.y, 202.0);
        }
        _ => panic!("prompt button position must use logical coordinates"),
    }

    match generic_position {
        tauri::Position::Logical(logical) => {
            assert_eq!(logical.x, 320.0);
            assert_eq!(logical.y, 240.0);
        }
        _ => panic!("generic position must use logical coordinates"),
    }
}

#[test]
fn outside_click_uses_visual_button_rect_not_transparent_window_padding() {
    let native_button = WindowRect {
        x: 282.0,
        y: 202.0,
        width: BUTTON_WINDOW_WIDTH,
        height: BUTTON_WINDOW_HEIGHT,
    };
    let visual_button = visual_button_rect_from_window_rect(native_button);
    let popover = WindowRect {
        x: 180.0,
        y: 20.0,
        width: POPOVER_WIDTH,
        height: POPOVER_HEIGHT,
    };

    assert_eq!(visual_button.x, 320.0);
    assert_eq!(visual_button.y, 240.0);
    assert_eq!(visual_button.width, BUTTON_VISUAL_WIDTH);
    assert_eq!(visual_button.height, BUTTON_VISUAL_HEIGHT);
    assert!(should_dismiss_popover_for_click((300.0, 220.0), Some(visual_button), Some(popover)));
    assert!(!should_dismiss_popover_for_click((340.0, 260.0), Some(visual_button), Some(popover)));
}
```

**Step 2: Run Rust tests to verify failure**

Run:

```bash
cd src-tauri
cargo test windows::tests::calico_button_window_has_animation_padding windows::tests::calico_button_window_uses_larger_native_transparent_size windows::tests::calico_visual_and_window_positions_round_trip windows::tests::calico_button_position_from_visual_subtracts_padding_without_affecting_generic_windows windows::tests::outside_click_uses_visual_button_rect_not_transparent_window_padding
```

Expected: FAIL because these constants do not exist yet.

**Step 3: Do not commit yet**

Commit after Task 2 passes.

---

### Task 2: Enlarge Native Window While Preserving Visual Position

**Files:**
- Modify: `src-tauri/src/windows.rs`

**Step 1: Replace button size constants**

Change the current constants:

```rust
pub const BUTTON_WIDTH: f64 = 132.0;
pub const BUTTON_HEIGHT: f64 = 132.0;
```

to:

```rust
pub const BUTTON_VISUAL_WIDTH: f64 = 132.0;
pub const BUTTON_VISUAL_HEIGHT: f64 = 132.0;
pub const BUTTON_WINDOW_WIDTH: f64 = 208.0;
pub const BUTTON_WINDOW_HEIGHT: f64 = 208.0;
pub const BUTTON_WINDOW_PADDING_X: f64 = (BUTTON_WINDOW_WIDTH - BUTTON_VISUAL_WIDTH) / 2.0;
pub const BUTTON_WINDOW_PADDING_Y: f64 = (BUTTON_WINDOW_HEIGHT - BUTTON_VISUAL_HEIGHT) / 2.0;
```

**Step 2: Add conversion helpers without changing generic popover positioning**

Replace the current single-purpose-looking helper:

```rust
fn prompt_button_window_position(x: f64, y: f64) -> tauri::Position {
    tauri::Position::Logical(tauri::LogicalPosition { x, y })
}
```

with distinct helpers:

```rust
fn logical_position(x: f64, y: f64) -> tauri::Position {
    tauri::Position::Logical(tauri::LogicalPosition { x, y })
}

fn prompt_button_visual_to_window_position(x: f64, y: f64) -> (f64, f64) {
    (x - BUTTON_WINDOW_PADDING_X, y - BUTTON_WINDOW_PADDING_Y)
}

fn prompt_button_window_to_visual_position(x: f64, y: f64) -> (f64, f64) {
    (x + BUTTON_WINDOW_PADDING_X, y + BUTTON_WINDOW_PADDING_Y)
}

fn prompt_button_position_from_visual(x: f64, y: f64) -> tauri::Position {
    let (window_x, window_y) = prompt_button_visual_to_window_position(x, y);
    logical_position(window_x, window_y)
}
```

`logical_position(...)` is for ordinary windows such as the prompt popover. `prompt_button_position_from_visual(...)` is only for the enlarged Calico native window.

**Step 3: Update Calico button native positioning only**

Keep external callers passing visual coordinates. Use Calico visual-to-window conversion only in Calico button positioning paths:

- `show_prompt_button(...)` reuse branch
- `move_prompt_button_to(...)`

Do not use `prompt_button_position_from_visual(...)` in `show_popover_mode(...)`.

For existing windows that call `set_position(...)`, use:

```rust
window
    .set_position(prompt_button_position_from_visual(x, y))
    .map_err(|e| e.to_string())?;
```

For `WebviewWindowBuilder::position(...)`, do not pass `prompt_button_position_from_visual(...)` because the builder API expects two numeric coordinates, not `tauri::Position`. Convert explicitly and pass the tuple:

```rust
let (window_x, window_y) = prompt_button_visual_to_window_position(x, y);
let window = WebviewWindowBuilder::new(
    &app,
    BUTTON_WINDOW_LABEL,
    WebviewUrl::App("overlay.html".into()),
)
.title("Prompt Button")
.inner_size(BUTTON_WINDOW_WIDTH, BUTTON_WINDOW_HEIGHT)
.resizable(false)
.decorations(false)
.always_on_top(true)
.accept_first_mouse(true)
.skip_taskbar(true)
.position(window_x, window_y)
.build()
.map_err(|e| e.to_string())?;
```

**Step 4: Use larger size when creating or resizing the native window**

Change `.inner_size(BUTTON_WIDTH, BUTTON_HEIGHT)` to:

```rust
.inner_size(BUTTON_WINDOW_WIDTH, BUTTON_WINDOW_HEIGHT)
```

In any reuse/resizing path that uses `set_size`, use:

```rust
tauri::LogicalSize {
    width: BUTTON_WINDOW_WIDTH,
    height: BUTTON_WINDOW_HEIGHT,
}
```

When an existing `prompt-button` window is reused, also call `set_size(...)` with the larger native size before showing it. This prevents a running user session from keeping the old clipped `132x132` native window.

**Step 5: Update `prompt_button_position_cmd` to return visual coordinates**

When reading native window position, convert it back:

```rust
let visual = prompt_button_window_to_visual_position(position.x as f64 / scale, position.y as f64 / scale);
```

Return the visual position. This keeps overlay JS drag math stable: `start.windowX` and `start.windowY` still mean the visual Calico position, not the enlarged native window corner.

**Step 6: Move the Calico button by visual coordinates**

`move_prompt_button_to(...)` receives visual coordinates from `public/overlay.html`. After clamping with visual dimensions, convert to native window coordinates before `set_position(...)`:

```rust
let (x, y) = clamp_button_position_for_monitor(x, y, monitor.as_ref());
window
    .set_position(prompt_button_position_from_visual(x, y))
    .map_err(|e| e.to_string())?;
```

Do not set the native window directly to the visual coordinates.

**Step 7: Clamp visual position using visual dimensions**

Update clamping code so the user-visible Calico stays inside the monitor by using `BUTTON_VISUAL_WIDTH` and `BUTTON_VISUAL_HEIGHT` for visible positioning:

```rust
let (x, y) = clamp_button_position_in_bounds(x, y, Some(bounds));
```

Inside `clamp_button_position_in_bounds`, use visual dimensions for max bounds. Do not use `BUTTON_WINDOW_WIDTH` for user-visible clamping.

**Step 8: Update popover calculations to use visual position and visual size**

Calls to `button_relative_popover_position(...)` should use:

```rust
BUTTON_VISUAL_WIDTH
BUTTON_VISUAL_HEIGHT
```

Inside `button_relative_popover_position(...)`, convert the native button window position back to the visual Calico hit-area position before calling `clamp_popover_position_for_size(...)`:

```rust
let native_x = position.x as f64 / scale;
let native_y = position.y as f64 / scale;
let (button_x, button_y) = prompt_button_window_to_visual_position(native_x, native_y);
```

Popover should stay anchored to the visual/hit area, not the larger transparent window corner.

**Step 9: Keep ordinary popover window positioning generic**

In `show_popover_mode(...)`, use `logical_position(x, y)` when reusing an existing popover:

```rust
window
    .set_position(logical_position(x, y))
    .map_err(|e| e.to_string())?;
```

For fresh popover windows, keep `.position(x, y)` unchanged. Do not subtract Calico padding from popover coordinates.

**Step 10: Use the visual button rect for outside-click dismissal**

Add a helper:

```rust
fn visual_button_rect_from_window_rect(rect: WindowRect) -> WindowRect {
    let (x, y) = prompt_button_window_to_visual_position(rect.x, rect.y);
    WindowRect {
        x,
        y,
        width: BUTTON_VISUAL_WIDTH,
        height: BUTTON_VISUAL_HEIGHT,
    }
}
```

Update outside-click handling so the button rect passed to `should_dismiss_popover_for_click(...)` is the visual rect:

```rust
let button = window_rect(&app, BUTTON_WINDOW_LABEL).map(visual_button_rect_from_window_rect);
let popover = window_rect(&app, POPOVER_WINDOW_LABEL);
if should_dismiss_popover_for_click(point, button, popover) { ... }
```

Transparent padding around the enlarged Calico window must not count as an inside-button click.

**Step 11: Update existing tests referencing `BUTTON_WIDTH` / `BUTTON_HEIGHT`**

Replace with `BUTTON_VISUAL_WIDTH` / `BUTTON_VISUAL_HEIGHT` when the test is about visual placement or popover anchoring.

Replace with `BUTTON_WINDOW_WIDTH` / `BUTTON_WINDOW_HEIGHT` only when the test is about native transparent window size.

Update the old `prompt_button_set_position_uses_logical_coordinates` test so it asserts the new button-specific helper subtracts padding, and add/keep a separate test proving `logical_position(...)` does not subtract padding for popovers.

**Step 12: Run Rust tests**

Run:

```bash
cd src-tauri
cargo test windows::tests
```

Expected: PASS.

**Step 13: Commit**

```bash
git add src-tauri/src/windows.rs
git commit -m "fix: enlarge Calico transparent window without moving visual anchor"
```

---

### Task 3: Update Overlay Hit Area CSS Without Making The Whole Window Interactive

**Files:**
- Modify: `public/overlay.html`
- Modify: `src/overlay/overlayHtml.test.ts`

**Step 1: Add failing overlay tests**

Add to `src/overlay/overlayHtml.test.ts`:

```ts
it("keeps Calico click hover and drag bound to the centered entry hit area", () => {
  const html = readOverlayHtml();

  expect(html).toContain("--calico-hit-area-size: 132px");
  expect(html).toContain("width: var(--calico-hit-area-size);");
  expect(html).toContain("height: var(--calico-hit-area-size);");
  expect(html).toContain("btn.addEventListener('pointerdown'");
  expect(html).toContain("btn.addEventListener('pointerup'");
  expect(html).toContain("btn.addEventListener('pointermove'");
  expect(html).not.toContain("body.addEventListener('pointerenter'");
  expect(html).not.toContain("window.addEventListener('pointerenter'");
});
```

**Step 2: Run overlay tests to verify failure**

Run:

```bash
npm test -- src/overlay/overlayHtml.test.ts
```

Expected: FAIL because CSS variables are not defined yet.

**Step 3: Add CSS custom properties and keep hit area centered**

In `public/overlay.html`, add:

```css
:root {
  --calico-hit-area-size: 132px;
  --calico-sprite-size: 126px;
}
```

Change:

```css
.calico-entry {
  width: 132px;
  height: 132px;
}
```

to:

```css
.calico-entry {
  width: var(--calico-hit-area-size);
  height: var(--calico-hit-area-size);
}
```

Change:

```css
.calico-sprite {
  width: 126px;
  height: 126px;
}
```

to:

```css
.calico-sprite {
  width: var(--calico-sprite-size);
  height: var(--calico-sprite-size);
}
```

Keep:

```css
body {
  display: grid;
  place-items: center;
}
```

This centers the `132x132` hit area inside the enlarged native window.

**Step 4: Run overlay tests**

Run:

```bash
npm test -- src/overlay/overlayHtml.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add public/overlay.html src/overlay/overlayHtml.test.ts
git commit -m "test: preserve Calico hit area inside larger window"
```

---

### Task 4: Add Weighted Idle Rhythm Tests

**Files:**
- Create if missing, otherwise modify: `src/overlay/calicoIdleDirector.test.ts`
- Create later: `public/calico/idle-director.js`

**Step 1: Create or update the idle director test file**

If `src/overlay/calicoIdleDirector.test.ts` does not exist, create it. Use the same public-module import style as `src/overlay/calicoMotionRuntime.test.ts`:

```ts
async function loadDirectorModule() {
  // @ts-expect-error public overlay module is intentionally outside the src build graph.
  return (await import("../../public/calico/idle-director.js")) as IdleDirectorModule;
}
```

If the file already exists from a parallel task, update it in place without removing unrelated valid coverage.

**Step 2: Update test type definitions**

Replace the existing tier type:

```ts
type IdleMotionTier = {
  name: string;
  availableAfterMs: number;
  delayRangeMs: [number, number];
  states: string[];
};
```

with:

```ts
type IdleRhythmPhase = {
  name: "early" | "settled" | "longIdle";
  availableAfterMs: number;
  delayRangeMs: [number, number];
};

type IdleMotionPoolEntry = {
  state: string;
  category: "light" | "life" | "mini" | "rest" | "attention";
  weights: Record<IdleRhythmPhase["name"], number>;
};
```

Update module type:

```ts
type IdleDirectorModule = {
  IDLE_RHYTHM_PHASES: IdleRhythmPhase[];
  IDLE_MOTION_POOL: IdleMotionPoolEntry[];
  createCalicoIdleDirector(options: {
    applyMotion: (payload: { state: string; priority?: number; reason?: string; durationMs?: number }) => boolean;
    resetMotion: () => void;
    getCurrentState: () => string;
    isUserActive: () => boolean;
    random?: () => number;
    setTimeout?: typeof window.setTimeout;
    clearTimeout?: typeof window.clearTimeout;
    now?: () => number;
  }): {
    start(): void;
    stop(): void;
    pause(durationMs?: number): void;
    resetIdleClock(): void;
    resetToBaseline(): void;
  };
};
```

**Step 3: Add failing test for rhythm phases**

Add:

```ts
it("uses short rhythm delays instead of long hard-tier pauses", async () => {
  const { IDLE_RHYTHM_PHASES } = await loadDirectorModule();

  expect(IDLE_RHYTHM_PHASES).toEqual([
    { name: "early", availableAfterMs: 7_000, delayRangeMs: [2_500, 5_000] },
    { name: "settled", availableAfterMs: 30_000, delayRangeMs: [2_000, 4_500] },
    { name: "longIdle", availableAfterMs: 90_000, delayRangeMs: [3_000, 6_000] },
  ]);
});
```

**Step 4: Add failing test for protected pool**

Replace the old pool test with:

```ts
it("uses a weighted idle pool without protected semantic motions", async () => {
  const { IDLE_MOTION_POOL } = await loadDirectorModule();
  const states = IDLE_MOTION_POOL.map((entry) => entry.state);

  expect(new Set(states).size).toBe(states.length);
  expect(states).toEqual(
    expect.arrayContaining([
      "idle",
      "yawning",
      "dozing",
      "collapsing",
      "sleeping",
      "waking",
      "react-poke",
      "react-left",
      "mini-enter",
      "mini-idle",
      "mini-peek",
      "mini-alert",
      "mini-happy",
      "mini-crabwalk",
      "mini-sleep",
    ])
  );
  for (const state of protectedStates) {
    expect(states).not.toContain(state);
  }
});
```

**Step 5: Add failing tests for weight semantics**

Add:

```ts
it("does not allow sleep states during early idle", async () => {
  const { IDLE_MOTION_POOL } = await loadDirectorModule();
  const sleeping = IDLE_MOTION_POOL.find((entry) => entry.state === "sleeping");
  const miniSleep = IDLE_MOTION_POOL.find((entry) => entry.state === "mini-sleep");

  expect(sleeping?.weights.early).toBe(0);
  expect(miniSleep?.weights.early).toBe(0);
});

it("raises rest and mini weights during long idle", async () => {
  const { IDLE_MOTION_POOL } = await loadDirectorModule();
  const sleeping = IDLE_MOTION_POOL.find((entry) => entry.state === "sleeping");
  const miniSleep = IDLE_MOTION_POOL.find((entry) => entry.state === "mini-sleep");
  const yawning = IDLE_MOTION_POOL.find((entry) => entry.state === "yawning");

  expect(sleeping?.weights.longIdle).toBeGreaterThan(sleeping?.weights.settled ?? 0);
  expect(miniSleep?.weights.longIdle).toBeGreaterThan(miniSleep?.weights.settled ?? 0);
  expect(yawning?.weights.settled).toBeGreaterThan(yawning?.weights.early ?? 0);
});
```

**Step 6: Add failing test for baseline startup and low-priority scheduling**

Add or preserve this behavior test:

```ts
it("starts from idle-follow and schedules low-priority idle flourishes", async () => {
  vi.useFakeTimers();
  const { createCalicoIdleDirector } = await loadDirectorModule();
  const applied: Array<{ state: string; priority?: number; reason?: string }> = [];

  const director = createCalicoIdleDirector({
    applyMotion: (payload) => {
      applied.push(payload);
      return true;
    },
    resetMotion: vi.fn(),
    getCurrentState: () => "idle-follow",
    isUserActive: () => false,
    random: () => 0,
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    now: () => Date.now(),
  });

  director.start();
  vi.advanceTimersByTime(7_000 + 2_500);

  expect(applied).toContainEqual(
    expect.objectContaining({
      state: "idle",
      reason: "idle-director",
      priority: 1,
    })
  );
  vi.useRealTimers();
});
```

**Step 7: Run tests to verify failure**

Run:

```bash
npm test -- src/overlay/calicoIdleDirector.test.ts
```

Expected: FAIL because `public/calico/idle-director.js`, `IDLE_RHYTHM_PHASES`, and `IDLE_MOTION_POOL` do not exist yet.

**Step 8: Do not commit yet**

Commit after Task 5 passes.

---

### Task 5: Implement Weighted Idle Rhythm

**Files:**
- Create if missing, otherwise modify: `public/calico/idle-director.js`
- Modify: `src/overlay/calicoIdleDirector.test.ts`
- Modify: `src/overlay/calicoManifest.test.ts`

**Step 1: Create the idle director module if it does not exist**

Create `public/calico/idle-director.js` as a small scheduler module next to `motion-runtime.js`. It must not touch DOM directly; it receives callbacks from `overlay.html`:

```js
export function createCalicoIdleDirector({
  applyMotion,
  resetMotion,
  getCurrentState,
  isUserActive,
  random = Math.random,
  setTimeout: setTimer = window.setTimeout.bind(window),
  clearTimeout: clearTimer = window.clearTimeout.bind(window),
  now = () => Date.now(),
  motionDurations = {},
} = {}) {
  // implemented in later steps
}
```

If a parallel task already created this file, update it conservatively instead of replacing unrelated valid logic.

**Step 2: Add rhythm phases and weighted pool**

In `public/calico/idle-director.js`, add:

```js
export const IDLE_RHYTHM_PHASES = [
  { name: "early", availableAfterMs: 7_000, delayRangeMs: [2_500, 5_000] },
  { name: "settled", availableAfterMs: 30_000, delayRangeMs: [2_000, 4_500] },
  { name: "longIdle", availableAfterMs: 90_000, delayRangeMs: [3_000, 6_000] },
];

export const IDLE_MOTION_POOL = [
  { state: "idle", category: "light", weights: { early: 8, settled: 5, longIdle: 3 } },
  { state: "react-left", category: "light", weights: { early: 6, settled: 4, longIdle: 3 } },
  { state: "mini-peek", category: "mini", weights: { early: 5, settled: 5, longIdle: 4 } },
  { state: "yawning", category: "life", weights: { early: 1, settled: 6, longIdle: 4 } },
  { state: "dozing", category: "rest", weights: { early: 0, settled: 4, longIdle: 5 } },
  { state: "react-poke", category: "attention", weights: { early: 1, settled: 2, longIdle: 1 } },
  { state: "mini-enter", category: "mini", weights: { early: 1, settled: 3, longIdle: 3 } },
  { state: "mini-idle", category: "mini", weights: { early: 0, settled: 3, longIdle: 4 } },
  { state: "mini-crabwalk", category: "mini", weights: { early: 0, settled: 3, longIdle: 3 } },
  { state: "collapsing", category: "rest", weights: { early: 0, settled: 1, longIdle: 4 } },
  { state: "sleeping", category: "rest", weights: { early: 0, settled: 1, longIdle: 7 } },
  { state: "waking", category: "rest", weights: { early: 0, settled: 2, longIdle: 5 } },
  { state: "mini-happy", category: "mini", weights: { early: 2, settled: 4, longIdle: 5 } },
  { state: "mini-sleep", category: "rest", weights: { early: 0, settled: 1, longIdle: 7 } },
  { state: "mini-alert", category: "attention", weights: { early: 0, settled: 1, longIdle: 2 } },
];
```

**Step 3: Add scheduler state and constants**

Use low priority so idle flourishes never block semantic motions:

```js
const BASELINE_STATE = "idle-follow";
const IDLE_PRIORITY = 1;
const QUIET_START_MS = 7_000;

let running = false;
let timer = 0;
let idleStartedAt = now();
let pausedUntil = 0;
let lastState = "";
```

Provide `displayMsFor(state)` with a small fallback so finite APNG motions return to baseline:

```js
function displayMsFor(state) {
  const duration = motionDurations[state];
  if (Number.isFinite(duration) && duration > 0) return duration;
  return 2600;
}
```

When overlay wires the director later, pass manifest durations so longer motions such as `yawning` and `waking` can finish cleanly.

**Step 4: Add phase selector**

Add the phase selector. If an older idle director exists from a parallel task, replace its `eligibleTiers()` logic with this:

```js
function currentPhase() {
  const elapsed = clampElapsed(now() - idleStartedAt);
  const phases = IDLE_RHYTHM_PHASES.filter((phase) => elapsed >= phase.availableAfterMs);
  return phases[phases.length - 1] ?? null;
}
```

**Step 5: Add weighted picker**

Add:

```js
function weightedEntriesForPhase(phaseName) {
  return IDLE_MOTION_POOL.filter((entry) => (entry.weights[phaseName] ?? 0) > 0);
}

function pickWeighted(entries, phaseName, random) {
  const total = entries.reduce((sum, entry) => sum + (entry.weights[phaseName] ?? 0), 0);
  if (total <= 0) return null;
  let threshold = random() * total;
  for (const entry of entries) {
    threshold -= entry.weights[phaseName] ?? 0;
    if (threshold <= 0) return entry.state;
  }
  return entries[entries.length - 1]?.state ?? null;
}
```

**Step 6: Update delay selection**

Replace `nextDelay()` with:

```js
function nextDelay() {
  const phase = currentPhase() ?? IDLE_RHYTHM_PHASES[0];
  return randomDelay(phase.delayRangeMs, random);
}
```

**Step 7: Update playable states**

Replace `playableStates()` with:

```js
function playableEntries(phaseName) {
  return weightedEntriesForPhase(phaseName).filter((entry) => entry.state !== lastState);
}
```

**Step 8: Implement start/stop/pause/reset controls**

The returned object must include:

```js
function start() {
  if (running) return;
  running = true;
  resetIdleClock();
  scheduleNext(QUIET_START_MS);
}

function stop() {
  running = false;
  clearTimer(timer);
}

function pause(durationMs = 0) {
  pausedUntil = Math.max(pausedUntil, now() + durationMs);
  scheduleNext(durationMs);
}

function resetIdleClock() {
  idleStartedAt = now();
}

function resetToBaseline() {
  resetIdleClock();
  resetMotion?.();
}
```

`scheduleNext(...)` must clear the old timer before setting a new one to avoid stacked timers.

Implement scheduling so a long animation can finish before the next idle flourish starts. The delay between flourishes is the user-visible rest gap after the current animation, not the total time from one start to the next:

```js
function scheduleNext(delayMs) {
  clearTimer(timer);
  if (!running) return;
  timer = setTimer(playNext, Math.max(0, delayMs));
}
```

After a motion is successfully applied, schedule the next idle check with:

```js
const durationMs = displayMsFor(state);
const applied = applyMotion({ state, reason: "idle-director", priority: IDLE_PRIORITY, durationMs });
if (applied) {
  lastState = state;
  scheduleNext(durationMs + nextDelay());
  return;
}
scheduleNext(nextDelay());
```

Do not schedule the next flourish with only `nextDelay()` after applying a motion. States such as `waking` and `collapsing` are around 5-6 seconds; interrupting them early would recreate the stutter this plan is meant to remove.

**Step 9: Update playNext**

In `playNext()`, after checking current state, add:

```js
const phase = currentPhase();
if (!phase) {
  scheduleNext(1_000);
  return;
}

const state = pickWeighted(playableEntries(phase.name), phase.name, random);
```

Keep:

```js
applyMotion({ state, reason: "idle-director", priority: IDLE_PRIORITY, durationMs });
```

If `applyMotion(...)` returns false because a protected/higher-priority motion is active, schedule the next check without resetting to baseline.

**Step 10: Update manifest guard test**

In `src/overlay/calicoManifest.test.ts`, replace references to `IDLE_MOTION_TIERS` with `IDLE_MOTION_POOL`:

```ts
type IdleDirectorModule = {
  IDLE_MOTION_POOL: Array<{ state: string }>;
};

const idleStates = IDLE_MOTION_POOL.map((entry) => entry.state);
```

**Step 11: Run idle and manifest tests**

Run:

```bash
npm test -- src/overlay/calicoIdleDirector.test.ts src/overlay/calicoManifest.test.ts
```

Expected: PASS.

**Step 12: Commit**

```bash
git add public/calico/idle-director.js src/overlay/calicoIdleDirector.test.ts src/overlay/calicoManifest.test.ts
git commit -m "feat: smooth Calico idle rhythm with weighted motions"
```

---

### Task 6: Add Hover Attention API Tests

**Files:**
- Modify: `src/overlay/calicoIdleDirector.test.ts`
- Modify: `public/calico/idle-director.js`

By this task, `public/calico/idle-director.js` must already exist from Task 5. If it does not, stop and complete Task 5 first.

**Step 1: Extend director return type in tests**

Add methods:

```ts
handleAttention(): boolean;
```

**Step 2: Add test for waking from sleep**

Add:

```ts
it("wakes Calico on hover attention when resting", async () => {
  const { createCalicoIdleDirector } = await loadDirectorModule();
  const applied: Array<{ state: string; priority?: number; reason?: string }> = [];

  const director = createCalicoIdleDirector({
    applyMotion: (payload) => {
      applied.push(payload);
      return true;
    },
    resetMotion: vi.fn(),
    getCurrentState: () => "sleeping",
    isUserActive: () => false,
    random: () => 0,
    now: () => Date.now(),
  });

  expect(director.handleAttention()).toBe(true);
  expect(applied[0]).toMatchObject({
    state: "waking",
    reason: "hover-attention",
    priority: 2,
  });
});
```

**Step 3: Add test for cheerful idle greeting**

Add:

```ts
it("uses mini-happy on hover attention from neutral idle states", async () => {
  const { createCalicoIdleDirector } = await loadDirectorModule();
  const applied: Array<{ state: string; reason?: string }> = [];

  const director = createCalicoIdleDirector({
    applyMotion: (payload) => {
      applied.push(payload);
      return true;
    },
    resetMotion: vi.fn(),
    getCurrentState: () => "idle-follow",
    isUserActive: () => false,
    random: () => 0,
    now: () => Date.now(),
  });

  expect(director.handleAttention()).toBe(true);
  expect(applied[0]).toMatchObject({
    state: "mini-happy",
    reason: "hover-attention",
  });
});
```

**Step 4: Add test for protected state non-interruption**

Add:

```ts
it("does not interrupt protected semantic states on hover attention", async () => {
  const { createCalicoIdleDirector } = await loadDirectorModule();
  const applied: Array<{ state: string }> = [];

  for (const protectedState of ["happy", "react-drag", "error", "notification", "working-typing"]) {
    const director = createCalicoIdleDirector({
      applyMotion: (payload) => {
        applied.push(payload);
        return true;
      },
      resetMotion: vi.fn(),
      getCurrentState: () => protectedState,
      isUserActive: () => false,
      random: () => 0,
      now: () => Date.now(),
    });

    expect(director.handleAttention()).toBe(false);
  }
  expect(applied).toEqual([]);
});
```

**Step 5: Add test for hover cooldown**

Add:

```ts
it("throttles hover attention with a cooldown", async () => {
  const { createCalicoIdleDirector } = await loadDirectorModule();
  const applied: Array<{ state: string }> = [];
  let now = 0;

  const director = createCalicoIdleDirector({
    applyMotion: (payload) => {
      applied.push(payload);
      return true;
    },
    resetMotion: vi.fn(),
    getCurrentState: () => "idle-follow",
    isUserActive: () => false,
    random: () => 0,
    now: () => now,
  });

  expect(director.handleAttention()).toBe(true);
  now = 5_000;
  expect(director.handleAttention()).toBe(false);
  now = 10_001;
  expect(director.handleAttention()).toBe(true);
  expect(applied).toHaveLength(2);
});
```

**Step 6: Run tests to verify failure**

Run:

```bash
npm test -- src/overlay/calicoIdleDirector.test.ts
```

Expected: FAIL because `handleAttention()` does not exist.

---

### Task 7: Implement Hover Attention API

**Files:**
- Modify: `public/calico/idle-director.js`
- Modify: `src/overlay/calicoIdleDirector.test.ts`

**Step 1: Add hover constants**

In `public/calico/idle-director.js`, add:

```js
const HOVER_PRIORITY = 2;
const HOVER_COOLDOWN_MS = 10_000;
const HOVER_IDLE_PAUSE_MS = 6_000;
const RESTING_STATES = new Set(["sleeping", "dozing", "mini-sleep"]);
const NEUTRAL_ATTENTION_STATES = new Set(["idle-follow", "idle", "mini-idle", "mini-peek"]);
const PROTECTED_ATTENTION_STATES = new Set([
  "happy",
  "react-drag",
  "error",
  "notification",
  "thinking",
  "working-typing",
  "working-conducting",
  "working-juggling",
  "working-building",
  "working-carrying",
  "working-sweeping",
]);
```

**Step 2: Track hover cooldown**

Add local state:

```js
let attentionCooldownUntil = 0;
```

**Step 3: Add response selector**

Add:

```js
function attentionStateFor(currentState) {
  if (PROTECTED_ATTENTION_STATES.has(currentState)) return null;
  if (RESTING_STATES.has(currentState)) return "waking";
  if (NEUTRAL_ATTENTION_STATES.has(currentState)) return "mini-happy";
  return "mini-happy";
}
```

**Step 4: Implement `handleAttention()`**

Add:

```js
function handleAttention() {
  if (!running) return false;
  if (isUserActive?.()) return false;
  if (now() < attentionCooldownUntil) return false;

  const currentState = getCurrentState?.() ?? BASELINE_STATE;
  const state = attentionStateFor(currentState);
  if (!state) return false;

  const durationMs = displayMsFor(state);
  const applied = applyMotion({
    state,
    reason: "hover-attention",
    priority: HOVER_PRIORITY,
    durationMs,
  });
  if (!applied) return false;

  attentionCooldownUntil = now() + HOVER_COOLDOWN_MS;
  resetIdleClock();
  pause(HOVER_IDLE_PAUSE_MS);
  return true;
}
```

**Step 5: Return the new method**

Add to returned object:

```js
handleAttention,
```

**Step 6: Run tests**

Run:

```bash
npm test -- src/overlay/calicoIdleDirector.test.ts
```

Expected: PASS.

**Step 7: Commit**

```bash
git add public/calico/idle-director.js src/overlay/calicoIdleDirector.test.ts
git commit -m "feat: add Calico hover attention response"
```

---

### Task 8: Wire Hover Attention To Existing Click Hit Area

**Files:**
- Modify: `public/overlay.html`
- Modify: `src/overlay/overlayHtml.test.ts`

**Step 1: Add failing overlay tests**

Add:

```ts
it("uses the existing Calico entry hit area for hover attention", () => {
  const html = readOverlayHtml();

  expect(html).toContain("/calico/idle-director.js");
  expect(html).toContain("createCalicoIdleDirector");
  expect(html).toContain("let calicoIdleDirector = null;");
  expect(html).toContain("initializeCalicoMotion");
  expect(html).toContain("calicoIdleDirector.start();");
  expect(html).toContain("btn.addEventListener('pointerenter'");
  expect(html).toContain("handleCalicoPointerEnter");
  expect(html).toContain("calicoIdleDirector?.handleAttention();");
  expect(html).not.toContain("body.addEventListener('pointerenter'");
  expect(html).not.toContain("window.addEventListener('pointerenter'");
});

it("pauses idle scheduling during drag and semantic motion events", () => {
  const html = readOverlayHtml();

  expect(html).toContain("calicoIdleDirector?.pause");
  expect(html).toContain("calicoIdleDirector?.resetIdleClock");
  expect(html).toContain("calicoIdleDirector?.resetToBaseline");
  expect(html).toContain("applyCalicoMotion(event.payload)");
});

it("keeps click-to-open neutral and separate from hover attention", () => {
  const html = readOverlayHtml();
  const clickBlock = html.slice(
    html.indexOf("const sessionId = ++promptPickSessionId;"),
    html.indexOf("start = null;", html.indexOf("const sessionId = ++promptPickSessionId;"))
  );

  expect(clickBlock).not.toContain("handleAttention");
  expect(clickBlock).not.toContain("hover-attention");
  expect(clickBlock).not.toContain("applyCalicoMotion");
});
```

**Step 2: Run tests to verify failure**

Run:

```bash
npm test -- src/overlay/overlayHtml.test.ts
```

Expected: FAIL because pointerenter is not wired yet.

**Step 3: Import and store the idle director**

In `public/overlay.html`, update the module imports:

```js
import { createCalicoMotionRuntime } from '/calico/motion-runtime.js';
import { createCalicoIdleDirector } from '/calico/idle-director.js';
```

Add local state:

```js
let calicoMotion = null;
let calicoIdleDirector = null;
```

Do not import the idle director from React code. The overlay is a standalone HTML module.

**Step 4: Initialize the idle director after manifest load**

Inside `initializeCalicoMotion()`, after `calicoMotion = createCalicoMotionRuntime(...)`, create and start the director:

```js
const motionDurations = Object.fromEntries(
  Object.entries(manifest.states).map(([state, entry]) => [state, entry.durationMs])
);
calicoIdleDirector = createCalicoIdleDirector({
  applyMotion: applyCalicoMotion,
  resetMotion: resetCalicoMotion,
  getCurrentState: () => btn.dataset.motionState || manifest.defaultState,
  isUserActive: () => Boolean(start || dragging || contextMenuOpened),
  motionDurations,
});
resetCalicoMotion();
calicoIdleDirector.start();
```

If manifest loading fails, leave `calicoIdleDirector` as `null`; fallback motion should continue to work.

**Step 5: Prevent recursion when reset callbacks run**

Because `resetMotion` points to `resetCalicoMotion`, make sure `resetCalicoMotion()` does not call `calicoIdleDirector.resetToBaseline()`. The direction should be:

```text
idle director -> resetCalicoMotion -> runtime.reset
popover dismissed -> calicoIdleDirector.resetToBaseline
```

Avoid circular reset calls.

**Step 6: Add pointerenter handler**

In `public/overlay.html`, add:

```js
function handleCalicoPointerEnter() {
  calicoIdleDirector?.handleAttention();
}
```

Do not call `applyCalicoMotion` directly in overlay. The director owns hover response gating.

**Step 7: Bind handler to `btn` only**

Add near other button listeners:

```js
btn.addEventListener('pointerenter', handleCalicoPointerEnter);
```

Do not add pointerenter listeners to `body`, `document`, or `window`.

**Step 8: Pause or reset idle scheduling for existing user events**

Update existing event paths without changing UX:

- On `pointerdown`, call `calicoIdleDirector?.pause(1200);` so idle motion does not fire during a click or pending drag.
- On drag start, call `calicoIdleDirector?.pause(4000);` before applying `react-drag`.
- On `pointerup`, call `calicoIdleDirector?.resetIdleClock();` after click or drag completes.
- In `listenForCalicoMotion()`, after applying semantic payloads such as `happy`, `error`, `working-*`, call `calicoIdleDirector?.pause(event.payload?.durationMs ?? 3000);` and `calicoIdleDirector?.resetIdleClock();`.
- In `listenForPromptPopoverDismissed()`, call `calicoIdleDirector?.resetToBaseline();` instead of only `resetCalicoMotion();`.

Keep plain click-to-open neutral: do not call `handleAttention()` or `applyCalicoMotion(...)` in the click-open branch.

**Step 9: Run overlay tests**

Run:

```bash
npm test -- src/overlay/overlayHtml.test.ts
```

Expected: PASS.

**Step 10: Commit**

```bash
git add public/overlay.html src/overlay/overlayHtml.test.ts
git commit -m "feat: trigger Calico attention from entry hover"
```

---

### Task 9: Update Manifest Guard For New Pool Export

**Files:**
- Modify: `src/overlay/calicoManifest.test.ts`

**Step 1: Ensure manifest guard reads `IDLE_MOTION_POOL`**

The manifest test should import:

```ts
const { IDLE_MOTION_POOL } = await loadIdleDirector();
const idleStates = IDLE_MOTION_POOL.map((entry) => entry.state);
```

**Step 2: Add hover response asset checks**

Add assertions:

```ts
expect(manifest.states.waking).toBeDefined();
expect(manifest.states["mini-happy"]).toBeDefined();
expect(existsSync(`public${manifest.states.waking.file}`)).toBe(true);
expect(existsSync(`public${manifest.states["mini-happy"].file}`)).toBe(true);
```

**Step 3: Run manifest tests**

Run:

```bash
npm test -- src/overlay/calicoManifest.test.ts
```

Expected: PASS.

**Step 4: Commit**

```bash
git add src/overlay/calicoManifest.test.ts
git commit -m "test: guard Calico hover response assets"
```

---

### Task 10: Focused Verification

**Files:**
- Verify: `src-tauri/src/windows.rs`
- Verify: `public/overlay.html`
- Verify: `public/calico/idle-director.js`
- Verify: `public/calico/manifest.json`

**Step 1: Run focused frontend tests**

Run:

```bash
npm test -- \
  src/overlay/calicoIdleDirector.test.ts \
  src/overlay/overlayHtml.test.ts \
  src/overlay/calicoMotionRuntime.test.ts \
  src/overlay/calicoManifest.test.ts \
  src/app/App.test.tsx
```

Expected: PASS.

**Step 2: Run Rust window tests**

Run:

```bash
cd src-tauri
cargo test windows::tests
```

Expected: PASS.

**Step 3: Confirm coordinate safety with targeted source checks**

Before broader build verification, inspect the changed Rust source and confirm:

- `show_popover_mode(...)` uses `logical_position(...)` or raw `.position(x, y)` for popover windows.
- `show_popover_mode(...)` does not call `prompt_button_position_from_visual(...)`.
- `show_prompt_button(...)` new-window builder calls `.position(window_x, window_y)` after `prompt_button_visual_to_window_position(...)`; it does not try to pass a `tauri::Position` to `WebviewWindowBuilder::position(...)`.
- `move_prompt_button_to(...)` calls `prompt_button_position_from_visual(...)` after clamping.
- `prompt_button_position_cmd(...)` converts native window coordinates back to visual coordinates.
- `button_relative_popover_position(...)` converts native button coordinates back to visual coordinates.
- outside-click handling maps `BUTTON_WINDOW_LABEL` through `visual_button_rect_from_window_rect(...)`.
- `public/calico/idle-director.js` schedules the next idle check with `displayMsFor(state) + nextDelay()` after a successful idle motion, so long animations are not cut off by the next flourish.

If any item is false, stop and fix before continuing.

**Step 4: Typecheck and build frontend**

Run:

```bash
npx tsc --noEmit
npx vite build --outDir /tmp/prompt-picker-calico-motion-rhythm-build --emptyOutDir
```

Expected: PASS.

**Step 5: Commit only if a verification doc is added**

No commit required if no files changed.

---

### Task 11: Browser Visual Verification

**Files:**
- Optional create/modify: `docs/qa/calico-motion-rhythm-hover-hit-area.md`

**Step 1: Start dev server**

Run:

```bash
npm run dev -- --host 127.0.0.1
```

Expected: Vite serves `http://127.0.0.1:1420/`.

**Step 2: Open overlay**

Open:

```text
http://127.0.0.1:1420/overlay.html
```

Expected:

- Calico renders centered.
- Native app verification later confirms no clipping in the real Tauri window.
- `#btn` remains the centered hit area.

**Step 3: Verify hover hit area in browser**

Use browser automation or console:

```js
const btn = document.getElementById("btn");
btn.getBoundingClientRect();
```

Expected:

- Button rect is around `132x132`.
- It is centered inside the larger page/window.
- Pointerenter is attached to `btn`, not `body`.

**Step 4: Verify idle rhythm in browser**

Temporarily use deterministic `Math.random = () => 0` before load if using automation.

Observe:

```js
document.getElementById("btn").dataset.motionState
```

Expected:

- No idle flourish before the quiet period.
- After quiet period, idle flourishes occur with shorter gaps than the old 9-32 second pauses.
- `idle-follow` appears as transition, not long frozen default.

**Step 5: Verify hover response**

Use pointer movement into `#btn` or dispatch a real pointerenter in browser automation.

Expected:

- Pointer entering `#btn` triggers `hover-attention`.
- Pointer entering the enlarged page outside `#btn` does not trigger `hover-attention`.
- Clicking `#btn` still opens the prompt list without applying a hover or thinking motion in the click branch.

**Step 6: Verify real Tauri clipping behavior**

Browser verification cannot prove native transparent-window clipping. Run the Tauri app or packaged app and inspect these states in the actual floating button window:

```text
sleeping
waking
mini-enter
mini-idle
mini-peek
mini-happy
mini-crabwalk
mini-sleep
mini-alert
react-drag
happy
```

Expected:

- No body, feet, or large movement is cut by an invisible rectangle.
- The clickable/drag/hover area still feels like the centered Calico entry, not the whole transparent window.
- The prompt list anchors to the visible Calico hit area, not to the enlarged transparent window corner.

If any motion is still clipped, increase only `BUTTON_WINDOW_WIDTH`, `BUTTON_WINDOW_HEIGHT`, and matching padding constants. Do not change `--calico-hit-area-size` without explicit approval.

Expected:

- From `idle-follow`, hover triggers `mini-happy`.
- From `sleeping` / `dozing` / `mini-sleep`, hover triggers `waking`.
- Hover does not trigger repeatedly inside the cooldown.
- Hover does not interrupt `happy` or `react-drag`.

**Step 6: Verify visual clipping states in native Tauri app**

Run the Tauri app after building locally:

```bash
npm run tauri -- build
```

or run the dev app if appropriate:

```bash
npm run tauri -- dev
```

Manually or with automation force these states and inspect:

```js
["sleeping", "waking", "mini-enter", "mini-idle", "mini-peek", "mini-happy", "mini-crabwalk", "mini-sleep", "mini-alert", "react-drag"]
```

Expected:

- No obvious horizontal clipping of the body, feet, or lower motion.
- The visible Calico position does not jump compared with the old anchor.
- The prompt list still appears close to the visual Calico, not the enlarged transparent window edge.

**Step 7: Record QA**

If screenshots or notes are captured, add:

```text
docs/qa/calico-motion-rhythm-hover-hit-area.md
```

Keep it short:

- Commit SHA
- Browser URL
- States inspected
- Hover behavior observed
- Native clipping result
- Any known limitation

**Step 8: Stop dev server**

Use `Ctrl-C`.

**Step 9: Commit QA doc if added**

```bash
git add docs/qa/calico-motion-rhythm-hover-hit-area.md
git commit -m "docs: record Calico motion rhythm QA"
```

---

### Task 12: Final Verification And Packaging Readiness

**Files:**
- Verify all touched files.

**Step 1: Run full frontend tests**

Run:

```bash
npm test
```

Expected: PASS.

**Step 2: Run TypeScript check**

Run:

```bash
npx tsc --noEmit
```

Expected: PASS.

**Step 3: Run Rust tests**

Run:

```bash
cd src-tauri
cargo test
```

Expected: PASS.

**Step 4: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

**Step 5: Check git status**

Run:

```bash
git status --short
```

Expected:

- No `dist`
- No `node_modules`
- No `src-tauri/target`
- No release bundles
- Only intended source, test, plan, and optional QA docs committed.

**Step 6: Prepare user-facing summary**

Summarize:

- Transparent animation window is larger; visual anchor is preserved.
- Hover uses the same effective hit area as click-to-open.
- Hover response wakes/cheers Calico without interrupting protected actions.
- Idle rhythm uses short weighted gaps instead of long hard-tier pauses.
- Drag and send-success behaviors are preserved.

**Step 7: Stop**

Do not package or push unless the user explicitly requests execution.
