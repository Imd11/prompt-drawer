# Calico Original IP Throw Actions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add two distinct Calico throw actions, throw-ready and throw-send, while preserving the original Calico image identity and never reusing the drag animation as a fake throw action.

**Architecture:** Keep `public/calico/calico-idle.apng` as the only cat body source for the new actions. Create two new animated SVG action assets that reference the original Calico bitmap and `paper-plane.svg`, then wire the overlay state machine so `ready`, `dragging`, and `throwing` each use separate assets. Tests must lock this separation so `ready` and `throwing` cannot regress to `calico-react-drag.apng`.

**Tech Stack:** Tauri v2, vanilla HTML/CSS/JS overlay, SVG image composition using original bitmap assets, Vitest, Tauri build.

---

## Product Contract

From the user's point of view:

```text
Idle:
  original Calico idle image

Click Calico:
  prompt list opens above Calico
  Calico changes into a new throw-ready action
  this action is not the drag/flying animation
  paper plane is visibly held near the front/paw side

Click a prompt:
  prompt list hides
  Calico changes into a new throw-send action
  paper plane releases from the same visual side
  external transparent flight window continues the long-distance paper-plane flight
  Calico returns to original idle

Drag Calico:
  drag continues to use calico-react-drag.apng
  drag must not look identical to click-ready state
```

## Non-Negotiable Constraints

- Do not hand-draw a new cat body with SVG paths.
- Do not use `calico-react-drag.apng` for `ready`.
- Do not use `calico-react-drag.apng` for `throwing`.
- Do not change autosend, permissions, prompt storage, menu bar, group sending, or clipboard behavior.
- Do not enlarge the `132px` floating button window.
- The new action assets must preserve the original Calico face, patches, colors, and outline by embedding the existing `calico-idle.apng` bitmap.

## Files To Touch

- Create: `public/calico/calico-throw-ready.svg`
- Create: `public/calico/calico-throw-send.svg`
- Modify: `public/overlay.html`
- Modify: `src/overlay/overlayHtml.test.ts`

## Files To Avoid

- Avoid: `src-tauri/src/platform/macos.rs`
- Avoid: `src-tauri/src/lib.rs`
- Avoid: `src-tauri/src/windows.rs` unless release-point tests prove a geometry mismatch
- Avoid: prompt store files
- Avoid: React prompt manager files

---

### Task 1: Lock The Asset Separation Contract In Tests

**Files:**
- Modify: `src/overlay/overlayHtml.test.ts`
- Test: `src/overlay/overlayHtml.test.ts`

**Step 1: Update the floating Calico identity test**

In the test named:

```ts
it("renders the floating entry as an animated Calico character", () => {
```

Keep the assertions that require:

```ts
expect(html).toContain("calico-idle.apng");
expect(html).not.toContain("calico-rig");
expect(html).not.toContain("calico-body");
expect(html).not.toContain("calico-head");
expect(html).not.toContain('class="calico-svg"');
```

Add assertions that the new action assets are referenced:

```ts
expect(html).toContain("calico-throw-ready.svg");
expect(html).toContain("calico-throw-send.svg");
```

**Step 2: Replace the current ready-action expectations**

In the test named:

```ts
it("switches Calico into a real throw-ready character pose before opening prompts", () => {
```

Replace the current incorrect drag-asset expectations:

```ts
expect(html).toContain("ready: '/calico/calico-react-drag.apng'");
expect(html).toContain("setSpriteSource(sprites.ready)");
```

With:

```ts
expect(html).toContain("ready: '/calico/calico-throw-ready.svg'");
expect(html).toContain("setSpriteSource(sprites.ready)");
expect(html).not.toContain("ready: '/calico/calico-react-drag.apng'");
```

Keep:

```ts
expect(html).toContain("setMotionState('ready'");
expect(html.indexOf("setMotionState('ready'")).toBeLessThan(
  html.indexOf("begin_prompt_pick_session")
);
```

**Step 3: Strengthen the throw-action test**

In the test named:

```ts
it("listens for paper-plane throw events and starts the flight animation", () => {
```

Add:

```ts
expect(html).toContain("throw: '/calico/calico-throw-send.svg'");
expect(html).not.toContain("throw: '/calico/calico-react-drag.apng'");
```

**Step 4: Add a new test for distinct drag/ready/throw assets**

Add:

```ts
it("does not reuse the drag animation for ready or throw actions", () => {
  const html = readFileSync("public/overlay.html", "utf8");

  expect(html).toContain("drag: '/calico/calico-react-drag.apng'");
  expect(html).toContain("ready: '/calico/calico-throw-ready.svg'");
  expect(html).toContain("throw: '/calico/calico-throw-send.svg'");
  expect(html).not.toContain("ready: '/calico/calico-react-drag.apng'");
  expect(html).not.toContain("throw: '/calico/calico-react-drag.apng'");
});
```

**Step 5: Add tests for the new SVG assets**

Add:

```ts
it("defines throw action assets from the original Calico bitmap", () => {
  const ready = readFileSync("public/calico/calico-throw-ready.svg", "utf8");
  const send = readFileSync("public/calico/calico-throw-send.svg", "utf8");

  for (const svg of [ready, send]) {
    expect(svg).toContain("/calico/calico-idle.apng");
    expect(svg).toContain("/calico/paper-plane.svg");
    expect(svg).not.toContain("calico-body");
    expect(svg).not.toContain("calico-head");
    expect(svg).not.toContain("calico-tail");
  }
});
```

**Step 6: Run tests and verify they fail**

Run:

```bash
npm test -- --run src/overlay/overlayHtml.test.ts
```

Expected: FAIL because `calico-throw-ready.svg` and `calico-throw-send.svg` do not exist yet, and `overlay.html` still maps `ready` and `throw` to `calico-react-drag.apng`.

**Step 7: Commit**

```bash
git add src/overlay/overlayHtml.test.ts
git commit -m "test: require distinct calico throw action assets"
```

---

### Task 2: Create The Throw-Ready Action Asset

**Files:**
- Create: `public/calico/calico-throw-ready.svg`
- Test: `src/overlay/overlayHtml.test.ts`

**Step 1: Create the SVG asset**

Create `public/calico/calico-throw-ready.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="266" height="200" viewBox="0 0 266 200">
  <style>
    .cat {
      transform-origin: 118px 146px;
      animation: readyCat 820ms ease-in-out infinite alternate;
    }

    .plane {
      transform-origin: 164px 70px;
      animation: readyPlane 820ms ease-in-out infinite alternate;
      filter: drop-shadow(0 5px 8px rgba(15, 23, 42, 0.2));
    }

    @keyframes readyCat {
      from { transform: translate(-10px, 10px) rotate(-12deg) scale(1.02); }
      to { transform: translate(-16px, 13px) rotate(-18deg) scale(1.045); }
    }

    @keyframes readyPlane {
      from { transform: translate(148px, 54px) rotate(-34deg) scale(0.82); opacity: 1; }
      to { transform: translate(157px, 45px) rotate(-24deg) scale(0.9); opacity: 1; }
    }
  </style>
  <image class="cat" href="/calico/calico-idle.apng" x="0" y="0" width="266" height="200" preserveAspectRatio="xMidYMid meet" />
  <image class="plane" href="/calico/paper-plane.svg" x="0" y="0" width="54" height="42" preserveAspectRatio="xMidYMid meet" />
</svg>
```

**Step 2: Verify visual intent before wiring**

Expected visual intent:

```text
The cat remains the original Calico bitmap.
The whole cat leans back enough to be visibly different from idle.
The plane sits near the front/paw side, not over the eyes or mouth.
The image does not look like the drag/flying pose.
```

**Step 3: Run the asset test and verify partial progress**

Run:

```bash
npm test -- --run src/overlay/overlayHtml.test.ts
```

Expected: still FAIL because `calico-throw-send.svg` and overlay wiring are not done yet.

**Step 4: Commit**

```bash
git add public/calico/calico-throw-ready.svg
git commit -m "feat: add original calico throw-ready asset"
```

---

### Task 3: Create The Throw-Send Action Asset

**Files:**
- Create: `public/calico/calico-throw-send.svg`
- Test: `src/overlay/overlayHtml.test.ts`

**Step 1: Create the SVG asset**

Create `public/calico/calico-throw-send.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="266" height="200" viewBox="0 0 266 200">
  <style>
    .cat {
      transform-origin: 118px 146px;
      animation: sendCat 620ms cubic-bezier(0.2, 0.85, 0.22, 1) both;
    }

    .plane {
      transform-origin: 172px 58px;
      animation: sendPlane 620ms cubic-bezier(0.16, 0.9, 0.22, 1) both;
      filter: drop-shadow(0 5px 8px rgba(15, 23, 42, 0.2));
    }

    @keyframes sendCat {
      0% { transform: translate(-16px, 13px) rotate(-18deg) scale(1.045); }
      30% { transform: translate(-20px, 16px) rotate(-24deg) scale(1.05); }
      52% { transform: translate(16px, -9px) rotate(18deg) scale(1.06); }
      100% { transform: translate(0, 0) rotate(0deg) scale(1); }
    }

    @keyframes sendPlane {
      0% { transform: translate(157px, 45px) rotate(-24deg) scale(0.9); opacity: 1; }
      32% { transform: translate(174px, 35px) rotate(-38deg) scale(0.94); opacity: 1; }
      46% { transform: translate(196px, 24px) rotate(-18deg) scale(0.8); opacity: 0; }
      100% { transform: translate(196px, 24px) rotate(-18deg) scale(0.8); opacity: 0; }
    }
  </style>
  <image class="cat" href="/calico/calico-idle.apng" x="0" y="0" width="266" height="200" preserveAspectRatio="xMidYMid meet" />
  <image class="plane" href="/calico/paper-plane.svg" x="0" y="0" width="54" height="42" preserveAspectRatio="xMidYMid meet" />
</svg>
```

**Step 2: Verify visual intent before wiring**

Expected visual intent:

```text
The cat remains the original Calico bitmap.
The cat starts from the same wind-up pose as ready.
The cat snaps forward.
The plane leaves the visible local asset quickly, so the separate flight window can take over.
```

**Step 3: Run the asset test and verify partial progress**

Run:

```bash
npm test -- --run src/overlay/overlayHtml.test.ts
```

Expected: still FAIL until overlay mapping is changed.

**Step 4: Commit**

```bash
git add public/calico/calico-throw-send.svg
git commit -m "feat: add original calico throw-send asset"
```

---

### Task 4: Wire Ready And Throw To The New Assets

**Files:**
- Modify: `public/overlay.html`
- Test: `src/overlay/overlayHtml.test.ts`

**Step 1: Change the `sprites` map**

Replace:

```js
const sprites = {
  idle: '/calico/calico-idle.apng',
  ready: '/calico/calico-react-drag.apng',
  drag: '/calico/calico-react-drag.apng',
  throw: '/calico/calico-react-drag.apng'
};
```

With:

```js
const sprites = {
  idle: '/calico/calico-idle.apng',
  ready: '/calico/calico-throw-ready.svg',
  drag: '/calico/calico-react-drag.apng',
  throw: '/calico/calico-throw-send.svg'
};
```

**Step 2: Simplify overlay CSS for ready and throw**

The new SVG assets contain their own local cat/plane animation. Keep only minimal overlay-level sizing and state behavior.

Remove or neutralize these overlay-level keyframes:

```css
@keyframes calico-ready-windup
@keyframes calico-ready-projectile
@keyframes calico-throw-snap
@keyframes calico-throw-projectile-release
```

Keep `calico-idle-breath`, `calico-recover`, and existing `calico-projectile` only if the external paper-plane flight still needs the local release cue. If the SVG asset already contains the local release plane, hide `.calico-projectile` during `ready` and `throwing` to avoid duplicate planes:

```css
.calico-entry[data-motion-state="ready"] .calico-projectile,
.calico-entry[data-motion-state="throwing"] .calico-projectile {
  opacity: 0;
}
```

**Step 3: Preserve drag behavior**

Ensure this still uses the drag asset:

```js
if (state === 'dragging') {
  setSpriteSource(sprites.drag);
}
```

Do not change drag command behavior.

**Step 4: Preserve click behavior**

Ensure click still enters ready before opening prompts:

```js
setMotionState('ready', READY_TIMEOUT_MS);
await invoke('begin_prompt_pick_session');
await invoke('show_prompt_popover_from_button');
```

**Step 5: Preserve prompt selection behavior**

Ensure prompt selection still emits:

```ts
emit("prompt-throw-send", { kind });
```

Do not change autosend order.

**Step 6: Run overlay tests**

Run:

```bash
npm test -- --run src/overlay/overlayHtml.test.ts
```

Expected: PASS.

**Step 7: Commit**

```bash
git add public/overlay.html src/overlay/overlayHtml.test.ts
git commit -m "fix: use distinct calico throw action assets"
```

---

### Task 5: Align The External Flight Release Point If Needed

**Files:**
- Modify only if needed: `src-tauri/src/windows.rs`
- Test only if needed: `src-tauri/src/windows.rs`

**Step 1: Compare release point**

The current Rust release point is:

```rust
let start_x = button_x + 102.0 - monitor_x;
let start_y = button_y + 45.0 - monitor_y;
```

The new local throw asset hides the local plane around:

```text
SVG plane x around 196 / 266, y around 24 / 200
Scaled into 126px display:
  x ≈ 93px
  y ≈ 15px
```

This may visually start too high compared with current `button_y + 45`.

**Step 2: Adjust only if visual/source review proves mismatch**

If the long-distance paper plane appears to start from the wrong place, update `paper_flight_points` and the corresponding test:

```rust
let start_x = button_x + 96.0 - monitor_x;
let start_y = button_y + 36.0 - monitor_y;
```

Update expected test:

```rust
assert_eq!((sx, sy), (1096.0, 636.0));
```

**Step 3: Run Rust window tests only if changed**

Run:

```bash
cd src-tauri && cargo test windows::tests
```

Expected: PASS.

**Step 4: Commit only if changed**

```bash
git add src-tauri/src/windows.rs
git commit -m "fix: align paper flight with new calico throw asset"
```

---

### Task 6: Full Verification And Packaging

**Files:**
- No source changes unless verification reveals a defect.

**Step 1: Run frontend tests**

Run:

```bash
npm test -- --run
```

Expected:

```text
Test Files 13 passed
Tests 117+ passed
```

**Step 2: Run Rust tests**

Run:

```bash
cd src-tauri && cargo test
```

Expected:

```text
test result: ok
```

**Step 3: Build the app**

Run:

```bash
npm run tauri build
```

Expected:

```text
Finished 2 bundles at:
  /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/target/release/bundle/macos/Prompt Picker.app
  /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/target/release/bundle/dmg/Prompt Picker_1.0.0_aarch64.dmg
```

**Step 4: Open the packaged app**

Run:

```bash
osascript -e 'tell application "Prompt Picker" to quit' >/dev/null 2>&1 || true
sleep 1
open "/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/target/release/bundle/macos/Prompt Picker.app"
```

Expected:

```text
App opens from the latest packaged bundle.
```

**Step 5: User-facing manual check**

Check:

```text
Click Calico:
  New throw-ready asset appears.
  It is not the drag/flying animation.
  It still uses the original Calico face and body bitmap.
  Prompt list appears above Calico.

Drag Calico:
  Drag still uses calico-react-drag.apng.

Click prompt:
  New throw-send asset plays.
  Paper plane releases.
  Autosend behavior remains unchanged.
```

**Step 6: Commit any final fixes**

If fixes were needed:

```bash
git add <changed-files>
git commit -m "fix: polish calico throw action assets"
```

---

## Acceptance Criteria

- `ready` maps to `/calico/calico-throw-ready.svg`.
- `throw` maps to `/calico/calico-throw-send.svg`.
- `drag` remains `/calico/calico-react-drag.apng`.
- `ready` does not map to `/calico/calico-react-drag.apng`.
- `throw` does not map to `/calico/calico-react-drag.apng`.
- The new SVG action assets reference `/calico/calico-idle.apng`.
- The new SVG action assets reference `/calico/paper-plane.svg`.
- The new SVG action assets do not draw a new cat body/head/tail with vector paths.
- Clicking Calico visibly changes to a distinct throw-ready action.
- Clicking a prompt visibly changes to a distinct throw-send action.
- Existing autosend, group prompt, drag, right-click, and menu behavior remains unchanged.
- Frontend tests pass.
- Rust tests pass.
- Tauri build succeeds.

## Non-Acceptable Outcomes

- Ready state still looks identical to drag/flying.
- Ready state still uses `calico-react-drag.apng`.
- Throw state still uses `calico-react-drag.apng`.
- The cat is redrawn as a different SVG character.
- The paper plane covers the cat's face.
- The floating button window grows beyond `132px` by `132px`.
- Autosend or clipboard code is modified as part of this animation task.
