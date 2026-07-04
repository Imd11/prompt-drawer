# Calico Full Motion System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 分阶段接入 Calico 全套动作资源，移除纸飞机素材，并让小猫动作按 Prompt Picker 的真实使用场景自然切换。

**Architecture:** Phase 1 只做低风险核心动作：资源 manifest、paper-plane 移除、overlay motion runtime、prompt 发送/管理动作事件，不改变现有单击打开、拖动移动、popover 生命周期。高风险交互如双击 poke、睡眠序列、mini mode、真实 eye tracking 单独作为后续 gated phase，必须在 Phase 1 稳定后再执行。

**Tech Stack:** Tauri 2, React 19, TypeScript, vanilla overlay HTML/JS, Vitest, Rust Tauri commands.

---

## Execution Decision

Do **not** execute the old all-in-one plan. Execute this revised plan in phases.

- Phase 0 and Phase 1 are allowed after the asset authorization/worktree gates pass.
- Phase 2 is allowed after Phase 1 passes full tests and manual QA.
- Phase 3 and Phase 4 require separate approval because they can change core interaction behavior.

## Non-Negotiable Gates

### Gate A: Artwork Authorization

The upstream Clawd on Desk repository states Calico artwork is all rights reserved. Do not copy upstream `themes/calico/assets/*` into this repo unless written permission exists.

If permission does not exist, use an approved in-house Calico-compatible asset pack with the same state names and filenames. Do not continue with copied upstream assets.

### Gate B: Dirty Worktree Isolation

Before implementation, inspect:

```bash
git status --short
```

Current repo has unrelated dirty files such as `src-tauri/src/windows.rs`, `src-tauri/Cargo.toml`, icons, `node_modules/.package-lock.json`, and `src-tauri/target/...`. Do not overwrite or stage unrelated changes.

Preferred setup:

```bash
git worktree add .worktrees/calico-full-motion main
cd .worktrees/calico-full-motion
```

If staying in the current worktree, stage only files listed by each task.

### Gate C: Keep Core Interaction Stable

Phase 1 must preserve:

- Single click opens/closes the prompt popover.
- Drag starts only after pointer movement exceeds `10px`.
- Drag still hides the popover and persists position.
- Prompt autosend is never blocked by animation completion.
- Status bubbles still render and remain clickable for Accessibility actions.

## Phase Map

| Phase | Scope | Risk |
|---|---|---|
| Phase 0 | Authorization, worktree safety, baseline tests | Low |
| Phase 1 | Remove paper plane, add assets/manifest, core motion runtime, prompt send/manager events | Medium |
| Phase 2 | Visual QA, scale/offset tuning, APNG replay hardening | Medium |
| Phase 3 | Poke, react-left, sleep sequence | High |
| Phase 4 | Mini mode and edge positioning | High |
| Phase 5 | True SVG eye/head tracking for `idle-follow` | High |

## Phase 1 Motion Contract

Only Phase 1 states:

```ts
type CalicoMotionState =
  | "idle-follow"
  | "idle"
  | "thinking"
  | "working-typing"
  | "working-conducting"
  | "working-juggling"
  | "working-building"
  | "working-carrying"
  | "working-sweeping"
  | "notification"
  | "error"
  | "happy"
  | "react-drag";
```

Reserved for later phases, declared in manifest but not wired to risky triggers in Phase 1:

```ts
type LaterCalicoMotionState =
  | "yawning"
  | "dozing"
  | "collapsing"
  | "sleeping"
  | "waking"
  | "react-poke"
  | "react-left"
  | "mini-enter"
  | "mini-idle"
  | "mini-peek"
  | "mini-alert"
  | "mini-happy"
  | "mini-crabwalk"
  | "mini-sleep";
```

Motion payload:

```ts
type CalicoMotionPayload = {
  state: CalicoMotionState;
  durationMs?: number;
  priority?: number;
  reason?: string;
};
```

## Manifest Requirements

`public/calico/manifest.json` must contain rendering metadata, not just filenames. Upstream Calico APNGs have different visual bounds.

Each state entry:

```json
{
  "file": "/calico/calico-happy.apng",
  "priority": 50,
  "durationMs": 3000,
  "minMs": 800,
  "replay": true,
  "scale": 1.2,
  "offsetX": 8,
  "offsetY": 6
}
```

Rules:

- `replay: true` means a one-shot APNG should restart even if the same file is already displayed.
- `scale`, `offsetX`, `offsetY` are required for APNG states copied from the upstream `objectScale.fileScales` and `objectScale.fileOffsets` data or from our approved asset pack equivalent.
- `idle-follow.svg` may be displayed as a static SVG in Phase 1. True internal eye/head tracking is Phase 5.

## Final Trigger Table

| Phase | Motion State | Asset | Trigger | Risk Control |
|---|---|---|---|---|
| 1 | `idle-follow` | `calico-idle-follow.svg` | Default active idle | Static in Phase 1; no eye tracking claim |
| 1 | `idle` | `calico-idle.apng` | Optional idle flourish after no high-priority state | Only if no pending action |
| 1 | `thinking` | `calico-thinking.apng` | Popover opens, prompt list refresh starts | Short duration; must not delay popover |
| 1 | `working-typing` | `calico-working-typing.apng` | Sending one prompt or creating one prompt | Fire-and-forget event |
| 1 | `working-conducting` | `calico-working-conducting.apng` | Sending grouped prompts sequentially | Keep during sequence |
| 1 | `working-juggling` | `calico-working-juggling.apng` | Hover/focus a group prompt preview | Throttled; not emitted on every mousemove |
| 1 | `working-building` | `calico-working-building.apng` | Create group, bulk import | Fire before async operation |
| 1 | `working-carrying` | `calico-working-carrying.apng` | Import, export, reorder | Short duration |
| 1 | `working-sweeping` | `calico-working-sweeping.apng` | Delete/cleanup | Short duration |
| 1 | `notification` | `calico-notification.apng` | Missing Accessibility, no target, user action needed | Maps from existing status actions |
| 1 | `error` | `calico-error.apng` | Copy/paste/submit/import/export failure | Minimum display time |
| 1 | `happy` | `calico-happy.apng` | Send/insert/add/edit/import/export success | Replay enabled |
| 1 | `react-drag` | `calico-react-drag.apng` | Existing drag threshold >10px | Do not change pointer threshold |
| 3 | `react-poke` | `calico-react-poke.apng` | Double click or long press | Requires click arbiter first |
| 3 | `react-left` | `calico-react-left.apng` | Left-side poke/approach | Easter egg only |
| 3 | `yawning/dozing/collapsing/sleeping/waking` | Sleep assets | Idle sequence | Requires timer audit |
| 4 | `mini-*` | Mini assets | Edge/mini mode | Requires multi-monitor positioning QA |

---

### Task 0: Preflight Authorization And Worktree Safety

**Files:**
- Read only: `/Users/yang/Desktop/GitHub-pre/prompt-picker/docs/plans/2026-07-04-calico-full-motion-system.md`

**Step 1: Check worktree**

Run:

```bash
git status --short
```

Expected: Either a clean dedicated worktree, or known unrelated changes clearly identified.

**Step 2: Confirm asset authorization**

Record one of these outcomes in implementation notes:

```text
Calico asset source: authorized upstream / in-house replacement / blocked
```

Expected: Do not continue if outcome is `blocked`.

**Step 3: Run baseline tests**

Run:

```bash
npm test
npm run build
```

Expected: PASS before touching implementation. Existing Vite warnings are acceptable.

**Step 4: Commit**

No commit. This task is a gate.

---

### Task 1: Remove Paper Plane Tests First

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/overlay/overlayHtml.test.ts`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/app/tauriCapabilities.test.ts`

**Step 1: Write failing paper-plane removal tests**

In `src/overlay/overlayHtml.test.ts`, replace the existing paper-flight capability expectation with:

```ts
it("does not keep paper-plane flight integration", () => {
  const html = readFileSync("public/overlay.html", "utf8");

  expect(html).not.toContain("paper-plane");
  expect(html).not.toContain("show_paper_plane_flight_from_button");
});
```

In `src/app/tauriCapabilities.test.ts`, update imports:

```ts
import { existsSync, readFileSync } from "fs";
```

Add:

```ts
it("does not register a paper-plane flight capability", () => {
  const defaultCapability = JSON.parse(
    readFileSync("src-tauri/capabilities/default.json", "utf8")
  ) as { windows?: string[] };

  expect(defaultCapability.windows).not.toContain("paper-plane-flight");
  expect(existsSync("src-tauri/capabilities/paper-flight.json")).toBe(false);
});
```

**Step 2: Run tests to verify failure**

Run:

```bash
npm test -- src/overlay/overlayHtml.test.ts src/app/tauriCapabilities.test.ts
```

Expected: FAIL because paper-flight integration still exists.

**Step 3: Do not commit red tests**

Continue to Task 2 before committing.

---

### Task 2: Remove Paper Plane Implementation

**Files:**
- Delete: `/Users/yang/Desktop/GitHub-pre/prompt-picker/public/paper-flight.html`
- Delete: `/Users/yang/Desktop/GitHub-pre/prompt-picker/public/calico/paper-plane.svg`
- Delete: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/capabilities/paper-flight.json`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/windows.rs`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/overlay/overlayHtml.test.ts`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/app/tauriCapabilities.test.ts`

**Step 1: Delete paper-plane files**

Run:

```bash
rm public/paper-flight.html public/calico/paper-plane.svg src-tauri/capabilities/paper-flight.json
```

**Step 2: Remove Rust paper-flight code**

In `src-tauri/src/windows.rs`, remove:

```rust
pub const PAPER_FLIGHT_WINDOW_LABEL: &str = "paper-plane-flight";
fn paper_flight_points(...)
pub fn show_paper_plane_flight_from_button(...)
pub fn hide_paper_plane_flight(...)
```

Remove tests whose names include:

```text
paper_flight_points_move_left_and_up_when_space_allows
paper_flight_points_stay_inside_monitor_bounds
paper_flight_window_has_backend_close_fallback
paper_flight_window_is_configured_before_showing
```

Do not remove unrelated dirty code in `windows.rs`, especially outside-click dismissal changes if present.

**Step 3: Remove Rust exports and invoke handlers**

In `src-tauri/src/lib.rs`, remove imports and handlers:

```rust
hide_paper_plane_flight,
show_paper_plane_flight_from_button,
```

Remove from `tauri::generate_handler!`:

```rust
show_paper_plane_flight_from_button,
hide_paper_plane_flight,
```

**Step 4: Run targeted tests**

Run:

```bash
npm test -- src/overlay/overlayHtml.test.ts src/app/tauriCapabilities.test.ts
npm run build
```

Expected: PASS.

**Step 5: Commit**

```bash
git add public/paper-flight.html public/calico/paper-plane.svg src-tauri/capabilities/paper-flight.json src-tauri/src/windows.rs src-tauri/src/lib.rs src/overlay/overlayHtml.test.ts src/app/tauriCapabilities.test.ts
git commit -m "refactor: remove paper plane flight integration"
```

---

### Task 3: Add Full Calico Manifest And Asset Validation

**Files:**
- Create: `/Users/yang/Desktop/GitHub-pre/prompt-picker/public/calico/manifest.json`
- Create: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/overlay/calicoManifest.test.ts`
- Add authorized assets under: `/Users/yang/Desktop/GitHub-pre/prompt-picker/public/calico/`

**Step 1: Add authorized assets**

Copy only authorized assets:

```text
calico-collapsing.apng
calico-dozing.apng
calico-error.apng
calico-happy.apng
calico-idle-follow.svg
calico-idle.apng
calico-mini-alert.apng
calico-mini-crabwalk.apng
calico-mini-enter.apng
calico-mini-happy.apng
calico-mini-idle.apng
calico-mini-peek.apng
calico-mini-sleep.apng
calico-notification.apng
calico-react-drag.apng
calico-react-left.apng
calico-react-poke.apng
calico-sleeping.apng
calico-thinking.apng
calico-waking.apng
calico-working-building.apng
calico-working-carrying.apng
calico-working-conducting.apng
calico-working-juggling.apng
calico-working-sweeping.apng
calico-working-typing.apng
calico-yawning.apng
```

**Step 2: Write manifest**

Create `public/calico/manifest.json`. It must include all states, including later-phase reserved states, but Phase 1 code only triggers Phase 1 states.

Use this shape for every state:

```json
{
  "file": "/calico/calico-working-typing.apng",
  "priority": 65,
  "minMs": 1000,
  "durationMs": 0,
  "replay": false,
  "scale": 1.2,
  "offsetX": -3,
  "offsetY": -5
}
```

For one-shot success/error states use:

```json
{
  "file": "/calico/calico-happy.apng",
  "priority": 50,
  "durationMs": 3000,
  "replay": true,
  "scale": 1.2,
  "offsetX": 8,
  "offsetY": 6
}
```

**Step 3: Write manifest tests**

Create `src/overlay/calicoManifest.test.ts`:

```ts
import { existsSync, readFileSync } from "fs";
import { describe, expect, it } from "vitest";

describe("calico motion manifest", () => {
  const manifest = JSON.parse(readFileSync("public/calico/manifest.json", "utf8"));

  it("declares every Calico motion state without paper plane assets", () => {
    const expectedStates = [
      "idle-follow", "idle", "thinking", "working-typing", "working-conducting",
      "working-juggling", "working-building", "working-carrying", "working-sweeping",
      "notification", "error", "happy", "yawning", "dozing", "collapsing",
      "sleeping", "waking", "react-drag", "react-poke", "react-left",
      "mini-enter", "mini-idle", "mini-peek", "mini-alert", "mini-happy",
      "mini-crabwalk", "mini-sleep"
    ];

    expect(Object.keys(manifest.states).sort()).toEqual(expectedStates.sort());
    expect(JSON.stringify(manifest)).not.toContain("paper-plane");
  });

  it("points every state at an existing asset and declares render metadata", () => {
    for (const [state, entry] of Object.entries(manifest.states)) {
      const motion = entry as {
        file: string;
        priority: number;
        scale: number;
        offsetX: number;
        offsetY: number;
      };

      expect(existsSync(`public${motion.file}`), state).toBe(true);
      expect(Number.isFinite(motion.priority), state).toBe(true);
      expect(Number.isFinite(motion.scale), state).toBe(true);
      expect(Number.isFinite(motion.offsetX), state).toBe(true);
      expect(Number.isFinite(motion.offsetY), state).toBe(true);
    }
  });
});
```

**Step 4: Run tests**

Run:

```bash
npm test -- src/overlay/calicoManifest.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add public/calico src/overlay/calicoManifest.test.ts
git commit -m "feat: add full calico motion manifest"
```

---

### Task 4: Extract Testable Motion Runtime

**Files:**
- Create: `/Users/yang/Desktop/GitHub-pre/prompt-picker/public/calico/motion-runtime.js`
- Create: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/overlay/calicoMotionRuntime.test.ts`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/public/overlay.html`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/overlay/overlayHtml.test.ts`

**Step 1: Write runtime unit tests**

Create `src/overlay/calicoMotionRuntime.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createCalicoMotionRuntime } from "../../public/calico/motion-runtime";

const manifest = {
  defaultState: "idle-follow",
  states: {
    "idle-follow": { file: "/calico/calico-idle-follow.svg", priority: 1, scale: 1, offsetX: 0, offsetY: 0 },
    happy: { file: "/calico/calico-happy.apng", priority: 50, durationMs: 3000, replay: true, scale: 1.2, offsetX: 8, offsetY: 6 },
    error: { file: "/calico/calico-error.apng", priority: 90, minMs: 5000, scale: 1.25, offsetX: 0, offsetY: 7 },
    "working-typing": { file: "/calico/calico-working-typing.apng", priority: 65, scale: 1.2, offsetX: -3, offsetY: -5 },
  },
};

describe("Calico motion runtime", () => {
  it("applies file, state, scale, and offsets", () => {
    const image = document.createElement("img");
    const host = document.createElement("button");
    const runtime = createCalicoMotionRuntime({ image, host, manifest });

    runtime.apply({ state: "working-typing" });

    expect(host.dataset.motionState).toBe("working-typing");
    expect(image.getAttribute("src")).toBe("/calico/calico-working-typing.apng");
    expect(image.style.getPropertyValue("--calico-scale")).toBe("1.2");
    expect(image.style.getPropertyValue("--calico-offset-x")).toBe("-3px");
  });

  it("does not allow lower priority motion to interrupt min display time", () => {
    vi.useFakeTimers();
    const image = document.createElement("img");
    const host = document.createElement("button");
    const runtime = createCalicoMotionRuntime({ image, host, manifest, now: () => Date.now() });

    runtime.apply({ state: "error" });
    runtime.apply({ state: "happy" });

    expect(host.dataset.motionState).toBe("error");
    vi.useRealTimers();
  });

  it("replays one-shot animations by replacing the image src", () => {
    const image = document.createElement("img");
    const host = document.createElement("button");
    const runtime = createCalicoMotionRuntime({ image, host, manifest });

    runtime.apply({ state: "happy" });
    const firstSrc = image.getAttribute("src");
    runtime.apply({ state: "happy" });

    expect(image.getAttribute("src")).not.toBe(firstSrc);
  });
});
```

**Step 2: Run tests to verify failure**

Run:

```bash
npm test -- src/overlay/calicoMotionRuntime.test.ts
```

Expected: FAIL because runtime module does not exist.

**Step 3: Implement runtime**

Create `public/calico/motion-runtime.js`:

```js
export function createCalicoMotionRuntime({ image, host, manifest, now = () => Date.now() }) {
  let currentPriority = 1;
  let minUntil = 0;
  let autoReturnTimer = 0;
  let replayCounter = 0;

  function entryFor(state) {
    return manifest.states[state] || manifest.states[manifest.defaultState];
  }

  function setImageSource(entry) {
    const source = entry.file;
    if (entry.replay) {
      replayCounter += 1;
      image.setAttribute("src", `${source}?replay=${replayCounter}`);
      return;
    }
    image.setAttribute("src", source);
  }

  function applyRenderMetadata(entry) {
    image.style.setProperty("--calico-scale", String(entry.scale ?? 1));
    image.style.setProperty("--calico-offset-x", `${entry.offsetX ?? 0}px`);
    image.style.setProperty("--calico-offset-y", `${entry.offsetY ?? 0}px`);
  }

  function reset() {
    apply({ state: manifest.defaultState, priority: 1, force: true });
  }

  function apply(payload = {}) {
    const state = payload.state || manifest.defaultState;
    const entry = entryFor(state);
    if (!entry || !entry.file) return false;

    const priority = Number.isFinite(payload.priority) ? payload.priority : entry.priority;
    if (!payload.force && now() < minUntil && priority < currentPriority) return false;

    window.clearTimeout(autoReturnTimer);
    currentPriority = priority;
    minUntil = now() + (entry.minMs || 0);
    host.dataset.motionState = state;
    setImageSource(entry);
    applyRenderMetadata(entry);

    const durationMs = payload.durationMs ?? entry.durationMs;
    if (durationMs > 0) {
      autoReturnTimer = window.setTimeout(reset, durationMs);
    }
    return true;
  }

  return { apply, reset };
}
```

**Step 4: Wire overlay to runtime**

In `public/overlay.html`, import:

```js
import { createCalicoMotionRuntime } from '/calico/motion-runtime.js';
```

Load manifest:

```js
let calicoMotion = null;

async function initializeCalicoMotion() {
  const response = await fetch('/calico/manifest.json');
  const manifest = await response.json();
  calicoMotion = createCalicoMotionRuntime({ image: sprite, host: btn, manifest });
  calicoMotion.reset();
}
```

Replace internal sprite switching with:

```js
function applyCalicoMotion(payload) {
  calicoMotion?.apply(payload);
}

function resetCalicoMotion() {
  clearMotionTimers();
  calicoMotion?.reset();
}
```

**Step 5: Update overlay string tests**

In `src/overlay/overlayHtml.test.ts`, assert:

```ts
expect(html).toContain("/calico/motion-runtime.js");
expect(html).toContain("calico-motion");
expect(html).toContain("initializeCalicoMotion");
```

Avoid brittle assertions that duplicate runtime unit tests.

**Step 6: Run tests**

Run:

```bash
npm test -- src/overlay/calicoMotionRuntime.test.ts src/overlay/overlayHtml.test.ts
```

Expected: PASS.

**Step 7: Commit**

```bash
git add public/calico/motion-runtime.js public/overlay.html src/overlay/calicoMotionRuntime.test.ts src/overlay/overlayHtml.test.ts
git commit -m "feat: add calico motion runtime"
```

---

### Task 5: Preserve Existing Drag With React-Drag Motion

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/public/overlay.html`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/overlay/overlayHtml.test.ts`

**Step 1: Add failing drag assertions**

In `src/overlay/overlayHtml.test.ts`, add:

```ts
it("keeps deliberate drag threshold and uses react-drag motion while dragging", () => {
  const html = readFileSync("public/overlay.html", "utf8");

  expect(html).toContain("const DRAG_START_DISTANCE_PX = 10;");
  expect(html).toContain("distance(start, current) < DRAG_START_DISTANCE_PX");
  expect(html).toContain("applyCalicoMotion({ state: 'react-drag'");
});
```

**Step 2: Run test to verify failure**

Run:

```bash
npm test -- src/overlay/overlayHtml.test.ts
```

Expected: FAIL until drag uses runtime state.

**Step 3: Update pointermove only**

In `public/overlay.html`, in the existing pointermove drag branch, replace previous drag sprite switching with:

```js
applyCalicoMotion({ state: 'react-drag', reason: 'drag' });
```

Do not change:

```js
const DRAG_START_DISTANCE_PX = 10;
hidePromptPopoverForDrag().catch(() => {});
emit('prompt-button-drag-started').catch(() => {});
```

**Step 4: Run tests**

Run:

```bash
npm test -- src/overlay/overlayHtml.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add public/overlay.html src/overlay/overlayHtml.test.ts
git commit -m "feat: animate calico drag with motion runtime"
```

---

### Task 6: App Motion Event Helper And Autosend Mapping

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/App.tsx`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/app/App.test.tsx`

**Step 1: Add failing tests**

In `src/app/App.test.tsx`, add tests using existing App mocks:

```ts
it("emits typing then happy Calico motion for single prompt autosend success", async () => {
  // Use the existing prompt selection setup in this file.
  // Select a single prompt and resolve pastePromptAndSubmitToLastTarget with { sent: true }.
  expect(emitMock).toHaveBeenCalledWith("calico-motion", expect.objectContaining({
    state: "working-typing"
  }));
  expect(emitMock).toHaveBeenCalledWith("calico-motion", expect.objectContaining({
    state: "happy"
  }));
});

it("emits conducting motion for grouped prompt autosend", async () => {
  expect(emitMock).toHaveBeenCalledWith("calico-motion", expect.objectContaining({
    state: "working-conducting"
  }));
});

it("emits notification motion when autosend needs user action", async () => {
  expect(emitMock).toHaveBeenCalledWith("calico-motion", expect.objectContaining({
    state: "notification"
  }));
});

it("emits error motion when autosend fails without a user action", async () => {
  expect(emitMock).toHaveBeenCalledWith("calico-motion", expect.objectContaining({
    state: "error"
  }));
});
```

**Step 2: Run test to verify failure**

Run:

```bash
npm test -- src/app/App.test.tsx
```

Expected: FAIL because no `calico-motion` events are emitted.

**Step 3: Add non-blocking helper**

In `src/App.tsx`, add:

```ts
type CalicoMotionState =
  | "thinking"
  | "working-typing"
  | "working-conducting"
  | "notification"
  | "error"
  | "happy"
  | "working-carrying"
  | "working-sweeping"
  | "working-building"
  | "working-juggling";

function emitCalicoMotion(state: CalicoMotionState, reason: string, durationMs?: number) {
  const payload = durationMs ? { state, reason, durationMs } : { state, reason };
  emit("calico-motion", payload).catch((error) => {
    console.warn("Failed to emit Calico motion:", error);
  });
}
```

Important: do not `await` this helper in autosend flow.

**Step 4: Wire autosend**

In `handleSelect`, after validating bodies and before paste:

```ts
emitCalicoMotion(
  prompt.type === "group" ? "working-conducting" : "working-typing",
  prompt.type === "group" ? "group-autosend" : "single-autosend"
);
```

After status is computed:

```ts
if (status.kind === "sent") {
  emitCalicoMotion("happy", "autosend-success", 3000);
} else {
  emitCalicoMotion(
    status.action ? "notification" : "error",
    status.action ? "autosend-action-required" : "autosend-failed",
    status.action ? 5200 : 5000
  );
}
```

In catch:

```ts
emitCalicoMotion("error", "autosend-exception", 5000);
```

**Step 5: Run tests**

Run:

```bash
npm test -- src/app/App.test.tsx
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/App.tsx src/app/App.test.tsx
git commit -m "feat: emit calico motion for prompt sending"
```

---

### Task 7: Manager Action Motion Mapping

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/App.tsx`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/app/App.test.tsx`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/ui/PromptManager.test.tsx`

**Step 1: Add failing tests**

Add App-level tests that invoke manager callbacks through rendered UI:

```ts
it("emits working-building then happy after creating a group", async () => {
  expect(emitMock).toHaveBeenCalledWith("calico-motion", expect.objectContaining({
    state: "working-building"
  }));
  expect(emitMock).toHaveBeenCalledWith("calico-motion", expect.objectContaining({
    state: "happy"
  }));
});

it("emits working-carrying for reorder/import/export", async () => {
  expect(emitMock).toHaveBeenCalledWith("calico-motion", expect.objectContaining({
    state: "working-carrying"
  }));
});

it("emits working-sweeping when deleting a prompt", async () => {
  expect(emitMock).toHaveBeenCalledWith("calico-motion", expect.objectContaining({
    state: "working-sweeping"
  }));
});
```

**Step 2: Run test to verify failure**

Run:

```bash
npm test -- src/app/App.test.tsx src/ui/PromptManager.test.tsx
```

Expected: FAIL.

**Step 3: Wire manager callbacks without changing data semantics**

In `src/App.tsx`, wrap existing callbacks:

```ts
onCreate={async (input) => {
  emitCalicoMotion("working-typing", "create-prompt");
  await storeRef.current.create(input);
  setPrompts(await storeRef.current.list());
  emitCalicoMotion("happy", "create-prompt-success", 3000);
}}
onCreateGroup={async (input) => {
  emitCalicoMotion("working-building", "create-group");
  await storeRef.current.createGroup(input);
  setPrompts(await storeRef.current.list());
  emitCalicoMotion("happy", "create-group-success", 3000);
}}
onDelete={async (id) => {
  emitCalicoMotion("working-sweeping", "delete-prompt");
  await storeRef.current.remove(id);
  setPrompts(await storeRef.current.list());
  emitCalicoMotion("happy", "delete-prompt-success", 2200);
}}
onReorder={async (ids) => {
  emitCalicoMotion("working-carrying", "reorder-prompts", 1600);
  await storeRef.current.reorder(ids);
  setPrompts(await storeRef.current.list());
}}
```

For import/export:

```ts
emitCalicoMotion("working-carrying", "import-prompts");
...
emitCalicoMotion("happy", "import-prompts-success", 3000);
```

On catch:

```ts
emitCalicoMotion("error", "import-prompts-failed", 5000);
```

**Step 4: Run tests**

Run:

```bash
npm test -- src/app/App.test.tsx src/ui/PromptManager.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/App.tsx src/app/App.test.tsx src/ui/PromptManager.test.tsx
git commit -m "feat: animate calico manager actions"
```

---

### Task 8: Popover Open And Group Preview Motion

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/App.tsx`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/ui/PromptQuickList.tsx`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/ui/PromptQuickList.test.tsx`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/app/App.test.tsx`

**Step 1: Add failing tests**

In `src/app/App.test.tsx`:

```ts
it("emits thinking motion when the prompt popover opens", async () => {
  await eventHandlers.get("prompt-popover-opened")?.({ payload: "popover" });
  expect(emitMock).toHaveBeenCalledWith("calico-motion", expect.objectContaining({
    state: "thinking"
  }));
});
```

In `src/ui/PromptQuickList.test.tsx`:

```ts
it("reports group preview once when a group item is entered", () => {
  const onGroupPreview = vi.fn();
  render(<PromptQuickList {...props} onGroupPreview={onGroupPreview} />);

  fireEvent.mouseEnter(screen.getByText("Repair Group").closest("button")!);

  expect(onGroupPreview).toHaveBeenCalledTimes(1);
});
```

**Step 2: Run tests to verify failure**

Run:

```bash
npm test -- src/app/App.test.tsx src/ui/PromptQuickList.test.tsx
```

Expected: FAIL.

**Step 3: Emit thinking on popover open**

In `prompt-popover-opened` listener:

```ts
emitCalicoMotion("thinking", "popover-open", 1200);
```

**Step 4: Add throttled group preview callback**

In `PromptQuickList.tsx`, add prop:

```ts
onGroupPreview?: () => void;
```

Use `onMouseEnter`, not `onMouseMove`, to avoid flooding:

```tsx
onMouseEnter={() => {
  if (prompt.type === "group") onGroupPreview?.();
}}
onFocus={() => {
  if (prompt.type === "group") onGroupPreview?.();
}}
```

In `App.tsx`:

```tsx
onGroupPreview={() => {
  emitCalicoMotion("working-juggling", "group-preview", 1600);
}}
```

**Step 5: Run tests**

Run:

```bash
npm test -- src/app/App.test.tsx src/ui/PromptQuickList.test.tsx
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/App.tsx src/ui/PromptQuickList.tsx src/ui/PromptQuickList.test.tsx src/app/App.test.tsx
git commit -m "feat: animate calico popover browsing"
```

---

### Task 9: Phase 1 Full Regression And Manual QA

**Files:**
- Modify only if QA finds Phase 1 issues.

**Step 1: Run full automated checks**

Run:

```bash
npm test
npm run build
```

Expected: PASS.

**Step 2: Run the app**

Run:

```bash
npm run tauri dev
```

Expected: floating Calico appears and core prompt flow still works.

**Step 3: Manual QA checklist**

Verify:

- Single click opens prompt list.
- Second click closes prompt list.
- Drag >10px moves Calico and persists position.
- Drag still hides the popover.
- `react-drag` displays while dragging.
- Opening the popover briefly shows `thinking`.
- Single prompt send shows `working-typing`, then `happy` or `error/notification`.
- Group prompt send shows `working-conducting`, then `happy` or `error/notification`.
- Add prompt toast still appears.
- Create group/import/export/reorder/delete emit appropriate motion without changing stored data.
- Accessibility status bubble remains clickable.
- No paper plane files, commands, windows, or capabilities remain.
- No `dist`, `node_modules`, or `src-tauri/target` files are staged.

**Step 4: Fix only Phase 1 bugs**

If QA finds issues, fix only files touched by Phase 1. Do not begin poke/sleep/mini work in this task.

**Step 5: Commit QA fixes**

```bash
git add <only-phase-1-fix-files>
git commit -m "fix: stabilize calico phase one motion"
```

---

## Deferred Phase 3: Poke, React-Left, Sleep

Do not execute until Phase 1 has shipped or the user explicitly approves.

Risks to solve first:

- Single click and double click conflict.
- Long press may conflict with drag threshold.
- Overlay window cannot observe global desktop mouse movement.
- Sleep timers must not hide urgent notification/error motion.

Required design before implementation:

```text
single click: delayed 180-220ms, opens popover only if no second click
double click: cancels pending single click, plays react-poke
long press: only if pointer movement < 10px and popover is not opening
sleep: based on no interaction with Calico, not global mouse idle
```

## Deferred Phase 4: Mini Mode

Do not execute until Phase 1 and Phase 3 are stable.

Risks to solve first:

- Multi-monitor negative coordinates.
- Tauri logical vs physical coordinates.
- Current window clamp may prevent edge placement.
- Edge hover region may conflict with click-through expectations.

Required design before implementation:

```text
mini mode is a persisted setting
enter mini only through explicit menu or edge drag after manual QA
mini hover uses mini-peek
mini success uses mini-happy
mini failure/action needed uses mini-alert
```

## Deferred Phase 5: True Idle Eye Tracking

`calico-idle-follow.svg` as an `<img>` is not enough for real eye/head tracking. Browser JS cannot reliably manipulate internal SVG layers through an external image element.

Implementation options:

1. Inline the SVG into overlay DOM and manipulate layer transforms.
2. Load SVG text, sanitize it, inject it into a shadow/container, then manipulate known IDs.
3. Accept static `idle-follow.svg` and use APNG idle flourishes only.

Do not claim true eye tracking until one of these is implemented and visually tested.

## Final Rollout Rule

Phase 1 is the only directly executable phase after gates pass. It should make Calico visibly richer while preserving the core app. Later phases are valuable, but they are not Pareto-safe until their specific interaction risks are solved.
