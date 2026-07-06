# Calico Motion Memory Stability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep the Calico floating pet visually rich but memory-stable during long-running desktop sessions, so the prompt picking workflow stays reliable.

**Architecture:** Bound all APNG replay resource identities instead of creating infinite `?replay=N` URLs, then make idle motion progressively calmer so background decoration cannot dominate resources. Add lightweight image failure recovery in the overlay so a broken sprite returns to the default visible state instead of leaving an empty transparent window.

**Tech Stack:** Tauri 2, macOS WKWebView, React 19, Vite, Vitest, vanilla browser modules under `public/calico`.

---

## UX Contract

From the user's point of view, Calico is a stable desktop entry point, not the product's main workload.

```text
Normal use
  Calico stays visible and lightweight
  User clicks Calico
  Prompt panel opens
  User chooses a prompt
  Prompt fills / fills and sends
  Calico shows a short success or error response

Long idle
  Calico becomes quieter over time
  No continuous heavy APNG replay loop
  No memory growth that can make the sprite vanish
```

The implementation must preserve the rich interaction states already shipped, but decoration must be resource-bounded. A successful fix means the pet can run for hours without WebContent memory climbing linearly because of motion replay.

---

## Implementation Principles

This fix must not argue with the product direction. The user expectation is correct: Calico should use a fixed action library, randomly or contextually play actions, and then reuse those same resources. The implementation must not rely on WebKit eventually releasing old APNG decode/cache entries, because the app cannot control that timing reliably. The correct fix is to stop creating unbounded new resource identities.

```text
Wrong resource model
  happy?replay=1
  happy?replay=2
  happy?replay=3
  ...
  unbounded resource identities

Correct resource model
  fixed action library
  bounded replay identities
  long idle becomes quiet
  failed image returns to idle-follow
```

The prompt workflow is the product's main path and must remain untouched:

```text
Click Calico
  Open prompt panel
  Choose prompt
  Fill / fill and send
  Show short feedback
```

Allowed files for this fix:

```text
public/calico/motion-runtime.js
public/calico/idle-director.js
public/overlay.html
src/overlay/calicoMotionRuntime.test.ts
src/overlay/calicoIdleDirector.test.ts
src/overlay/calicoManifest.test.ts
src/overlay/overlayHtml.test.ts
```

Files and areas that should not change in this plan:

```text
src/App.tsx prompt selection behavior
src/shared/settingsStore.ts prompt/category storage
src-tauri/src/platform/macos.rs autosend backend
src-tauri/src/lib.rs permission/menu behavior
src-tauri/src/windows.rs native window geometry
package.json version/package metadata
release/signing scripts
```

---

## Root Cause Summary

Current code in `public/calico/motion-runtime.js` uses an unbounded counter:

```js
if (entry.replay) {
  replayCounter += 1;
  image.setAttribute("src", `${entry.file}?replay=${replayCounter}`);
  return;
}
```

That forces WKWebView to see every replay as a new image resource. System logs from the running app showed the Calico WebContent process growing from tens of MB to about 3.2 GB, which matches long-running APNG decode/resource accumulation. The native window still existed, so the visible symptom is a rendering/resource failure, not a hidden setting or lost window.

---

### Task 0: Confirm the change boundary before touching code

**Files:**
- Inspect only: `public/calico/motion-runtime.js`
- Inspect only: `public/calico/idle-director.js`
- Inspect only: `public/overlay.html`
- Inspect only: `src/overlay/calicoMotionRuntime.test.ts`
- Inspect only: `src/overlay/calicoIdleDirector.test.ts`
- Inspect only: `src/overlay/calicoManifest.test.ts`
- Inspect only: `src/overlay/overlayHtml.test.ts`

**Step 1: Check current git state**

Run:

```bash
git status --short
```

Expected: note unrelated dirty build artifacts if present, but do not revert or clean them.

**Step 2: Confirm the fix does not need prompt data or backend edits**

Run:

```bash
rg -n "calico-motion|createCalicoMotionRuntime|createCalicoIdleDirector|prompt-autosend-status" public src src-tauri/src
```

Expected:
- Calico display logic is in `public/overlay.html` and `public/calico/*`.
- Prompt success/error emits can remain in `src/App.tsx`.
- Autosend backend can remain unchanged.

**Step 3: Do not commit**

This task is a boundary check only. Continue to Task 1.

---

### Task 1: Add a failing test for bounded replay resource identities

**Files:**
- Modify: `src/overlay/calicoMotionRuntime.test.ts`
- Later modify: `public/calico/motion-runtime.js`

**Step 1: Add the failing test**

Append this test to `src/overlay/calicoMotionRuntime.test.ts` inside `describe("Calico motion runtime", () => { ... })`:

```ts
  it("keeps replay image URLs bounded during long-running motion loops", async () => {
    const { createCalicoMotionRuntime } = await loadRuntime();
    const { image, host } = elements();
    const runtime = createCalicoMotionRuntime({ image, host, manifest });
    const seenSrcs = new Set<string>();

    for (let index = 0; index < 100; index += 1) {
      runtime.apply({ state: "happy" });
      seenSrcs.add(image.getAttribute("src") ?? "");
    }

    expect(seenSrcs.size).toBeLessThanOrEqual(2);
    expect([...seenSrcs].every((src) => src.startsWith("/calico/calico-happy.apng?replay="))).toBe(
      true
    );
  });
```

**Step 2: Add a mixed replay-state guard**

Append this second test in the same `describe` block:

```ts
  it("keeps replay image URLs bounded across mixed replay states", async () => {
    const { createCalicoMotionRuntime } = await loadRuntime();
    const { image, host } = elements();
    const runtime = createCalicoMotionRuntime({ image, host, manifest });
    const seenByFile = new Map<string, Set<string>>();
    const states = ["happy", "react-left"] as const;

    for (let index = 0; index < 100; index += 1) {
      runtime.apply({ state: states[index % states.length] });
      const src = image.getAttribute("src") ?? "";
      const file = src.split("?")[0];
      if (!seenByFile.has(file)) {
        seenByFile.set(file, new Set());
      }
      seenByFile.get(file)?.add(src);
    }

    expect(seenByFile.get("/calico/calico-happy.apng")?.size).toBeLessThanOrEqual(2);
    expect(seenByFile.get("/calico/calico-react-left.apng")?.size).toBeLessThanOrEqual(2);
  });
```

This test matters because the real idle director does not replay only one animation forever. It cycles through multiple replay APNGs, so the resource-bound guarantee must hold per APNG file across mixed motion traffic.

**Step 3: Run the focused test to verify it fails**

Run:

```bash
npm test -- src/overlay/calicoMotionRuntime.test.ts
```

Expected: FAIL. The old implementation creates 100 unique replay URLs, so `seenSrcs.size` is greater than `2`.

**Step 4: Commit nothing yet**

Do not commit after a failing test alone unless execution is paused. Continue to Task 2.

---

### Task 2: Bound replay URLs in the Calico motion runtime

**Files:**
- Modify: `public/calico/motion-runtime.js`
- Test: `src/overlay/calicoMotionRuntime.test.ts`

**Step 1: Implement a fixed replay slot count**

In `public/calico/motion-runtime.js`, add a small constant above `createCalicoMotionRuntime`:

```js
const REPLAY_SLOT_COUNT = 2;
```

Replace the current unbounded replay counter logic with modulo slots:

```js
function replaySourceFor(entry) {
  replayCounter = (replayCounter + 1) % REPLAY_SLOT_COUNT;
  return `${entry.file}?replay=${replayCounter}`;
}

function setImageSource(entry) {
  if (!entry?.file) return;
  if (entry.replay) {
    image.setAttribute("src", replaySourceFor(entry));
    return;
  }
  image.setAttribute("src", entry.file);
}
```

Keep `replayCounter` local to the runtime instance. Do not introduce global state.

This intentionally uses a bounded resource model instead of trying to manually clear previous WebKit image cache entries. The app cannot reliably force WKWebView to release decoded APNG frames immediately, but it can guarantee that it does not create infinite new URLs.

**Step 2: Run the focused test**

Run:

```bash
npm test -- src/overlay/calicoMotionRuntime.test.ts
```

Expected: PASS. The test should observe at most two replay URL identities for the same APNG.

**Step 3: Commit**

```bash
git add public/calico/motion-runtime.js src/overlay/calicoMotionRuntime.test.ts
git commit -m "fix: bound Calico replay resources"
```

---

### Task 3: Add image load failure recovery for the sprite

**Files:**
- Modify: `src/overlay/calicoMotionRuntime.test.ts`
- Modify: `public/calico/motion-runtime.js`

**Step 1: Add failing tests for image error fallback**

Append these tests to `src/overlay/calicoMotionRuntime.test.ts`:

```ts
  it("resets to the default state when a replay image fails to load", async () => {
    const { createCalicoMotionRuntime } = await loadRuntime();
    const { image, host } = elements();
    const runtime = createCalicoMotionRuntime({ image, host, manifest });

    runtime.apply({ state: "happy" });
    image.dispatchEvent(new Event("error"));

    expect(host.dataset.motionState).toBe("idle-follow");
    expect(image.getAttribute("src")).toBe("/calico/calico-idle-follow.svg");
  });

  it("does not loop fallback handling when the default image errors", async () => {
    const { createCalicoMotionRuntime } = await loadRuntime();
    const { image, host } = elements();
    const runtime = createCalicoMotionRuntime({ image, host, manifest });

    runtime.reset();
    image.dispatchEvent(new Event("error"));

    expect(host.dataset.motionState).toBe("idle-follow");
    expect(image.getAttribute("src")).toBe("/calico/calico-idle-follow.svg");
  });
```

**Step 2: Run the focused test to verify it fails**

Run:

```bash
npm test -- src/overlay/calicoMotionRuntime.test.ts
```

Expected: FAIL. The current runtime does not install an `error` listener.

**Step 3: Implement fallback recovery**

In `public/calico/motion-runtime.js`, add helpers inside `createCalicoMotionRuntime`:

```js
  function defaultEntry() {
    return entryFor(manifest.defaultState);
  }

  function resetToDefaultAfterError() {
    const defaultState = manifest.defaultState;
    const entry = defaultEntry();
    if (!entry?.file) return;
    window.clearTimeout(autoReturnTimer);
    currentPriority = 0;
    minUntil = 0;
    host.dataset.motionState = defaultState;
    image.setAttribute("src", entry.file);
    applyRenderMetadata(entry);
  }

  image.addEventListener?.("error", () => {
    if (host.dataset.motionState === manifest.defaultState) return;
    resetToDefaultAfterError();
  });
```

Do not call `apply()` from the error handler. Keep it direct so priority windows and replay counters do not create another loop.

**Step 4: Run the focused test**

Run:

```bash
npm test -- src/overlay/calicoMotionRuntime.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add public/calico/motion-runtime.js src/overlay/calicoMotionRuntime.test.ts
git commit -m "fix: recover Calico sprite after image load failure"
```

---

### Task 4: Add failing tests for a calm deep-idle phase

**Files:**
- Modify: `src/overlay/calicoIdleDirector.test.ts`
- Later modify: `public/calico/idle-director.js`

**Step 1: Update test types**

In `src/overlay/calicoIdleDirector.test.ts`, extend the phase type:

```ts
type IdleRhythmPhase = {
  name: "early" | "settled" | "longIdle" | "deepIdle";
  availableAfterMs: number;
  delayRangeMs: [number, number];
};
```

**Step 2: Update the existing rhythm test**

Change the expected phase array to:

```ts
    expect(IDLE_RHYTHM_PHASES).toEqual([
      { name: "early", availableAfterMs: 7_000, delayRangeMs: [2_500, 5_000] },
      { name: "settled", availableAfterMs: 30_000, delayRangeMs: [2_000, 4_500] },
      { name: "longIdle", availableAfterMs: 90_000, delayRangeMs: [3_000, 6_000] },
      { name: "deepIdle", availableAfterMs: 10 * 60_000, delayRangeMs: [45_000, 90_000] },
    ]);
```

**Step 3: Add a test that deep idle only chooses non-replay static states**

Append this test:

```ts
  it("limits deep idle to non-replay static states", async () => {
    const { IDLE_MOTION_POOL } = await loadDirectorModule();
    const deepIdleStates = IDLE_MOTION_POOL
      .filter((entry) => (entry.weights.deepIdle ?? 0) > 0)
      .map((entry) => entry.state)
      .sort();

    expect(deepIdleStates).toEqual(["idle", "mini-idle", "mini-sleep", "sleeping"].sort());
  });
```

**Step 4: Add a deterministic test for deep-idle timing**

Append this test:

```ts
  it("uses long quiet delays when the next idle callback runs after deep idle begins", async () => {
    const { createCalicoIdleDirector } = await loadDirectorModule();
    const applied: IdleDirectorPayload[] = [];
    const scheduledCallbacks: Array<() => void> = [];
    const scheduledDelays: number[] = [];
    let now = 0;

    const setTimer = ((callback: TimerHandler, delay?: number) => {
      if (typeof callback !== "function") {
        throw new Error("Calico idle director should schedule function callbacks");
      }
      scheduledCallbacks.push(callback as () => void);
      scheduledDelays.push(delay ?? 0);
      return scheduledCallbacks.length;
    }) as unknown as typeof window.setTimeout;

    const director = createCalicoIdleDirector({
      applyMotion: (payload) => {
        applied.push(payload);
        return true;
      },
      resetMotion: vi.fn(),
      getCurrentState: () => "idle-follow",
      isUserActive: () => false,
      random: () => 0,
      setTimeout: setTimer,
      clearTimeout: vi.fn(),
      now: () => now,
      motionDurations: { idle: 5_200 },
    });

    director.start();
    expect(scheduledDelays[0]).toBe(7_000);

    now = 10 * 60_000;
    scheduledCallbacks[0]();

    expect(applied[0]).toMatchObject({
      state: "idle",
      reason: "idle-director",
      priority: 1,
    });
    expect(scheduledDelays[scheduledDelays.length - 1]).toBe(5_200 + 45_000);
  });
```

Do not write this as `vi.advanceTimersByTime(10 * 60_000 + 45_000)` and then assert the first applied state. That version can pass because of an early idle callback, without proving the deep-idle phase was selected. The custom scheduler above intentionally runs the first pending idle callback after `now` has reached 10 minutes, so the assertion is tied to the `deepIdle` phase and its 45-90 second delay range.

**Step 5: Run the focused test to verify it fails**

Run:

```bash
npm test -- src/overlay/calicoIdleDirector.test.ts
```

Expected: FAIL. `deepIdle` does not exist yet.

---

### Task 5: Implement the deep-idle policy

**Files:**
- Modify: `public/calico/idle-director.js`
- Test: `src/overlay/calicoIdleDirector.test.ts`

**Step 1: Add the deep-idle phase**

In `public/calico/idle-director.js`, update `IDLE_RHYTHM_PHASES`:

```js
export const IDLE_RHYTHM_PHASES = [
  { name: "early", availableAfterMs: 7_000, delayRangeMs: [2_500, 5_000] },
  { name: "settled", availableAfterMs: 30_000, delayRangeMs: [2_000, 4_500] },
  { name: "longIdle", availableAfterMs: 90_000, delayRangeMs: [3_000, 6_000] },
  { name: "deepIdle", availableAfterMs: 10 * 60_000, delayRangeMs: [45_000, 90_000] },
];
```

**Step 2: Add `deepIdle` weights**

Update every `IDLE_MOTION_POOL` entry to include a `deepIdle` key. Only these states should have non-zero deep-idle weights:

```js
{ state: "idle", category: "light", weights: { early: 8, settled: 5, longIdle: 3, deepIdle: 2 } },
{ state: "mini-idle", category: "mini", weights: { early: 0, settled: 3, longIdle: 4, deepIdle: 4 } },
{ state: "sleeping", category: "rest", weights: { early: 0, settled: 1, longIdle: 7, deepIdle: 5 } },
{ state: "mini-sleep", category: "rest", weights: { early: 0, settled: 1, longIdle: 7, deepIdle: 5 } },
```

All replay-heavy states should use `deepIdle: 0`.

**Step 3: Keep existing selection logic**

Do not add new branching if the phase/weight system already handles the behavior. `weightedEntriesForPhase()` and `currentPhase()` should naturally support `deepIdle` once the phase and weights exist.

**Step 4: Run the focused test**

Run:

```bash
npm test -- src/overlay/calicoIdleDirector.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add public/calico/idle-director.js src/overlay/calicoIdleDirector.test.ts
git commit -m "fix: calm Calico deep idle motion"
```

---

### Task 6: Add a lightweight overlay watchdog for invalid sprite state

**Files:**
- Modify: `src/overlay/overlayHtml.test.ts`
- Modify: `public/overlay.html`

**Step 1: Add failing overlay HTML tests**

Append this test to `src/overlay/overlayHtml.test.ts`:

```ts
  it("starts a lightweight Calico sprite health watchdog", () => {
    const html = readOverlayHtml();

    expect(html).toContain("function startCalicoSpriteHealthWatchdog()");
    expect(html).toContain("window.setInterval");
    expect(html).toContain("sprite.naturalWidth === 0");
    expect(html).toContain("resetCalicoMotion();");
    expect(html).toContain("startCalicoSpriteHealthWatchdog();");
  });
```

**Step 2: Run the focused test to verify it fails**

Run:

```bash
npm test -- src/overlay/overlayHtml.test.ts
```

Expected: FAIL. The watchdog does not exist yet.

**Step 3: Implement the watchdog**

In `public/overlay.html`, add this function near the other Calico runtime helpers:

```js
function startCalicoSpriteHealthWatchdog() {
  window.setInterval(() => {
    if (!sprite) return;
    const source = sprite.getAttribute('src') || '';
    const failedImage = sprite.complete && sprite.naturalWidth === 0;
    if (!source || failedImage) {
      resetCalicoMotion();
    }
  }, 60_000);
}
```

At the bottom of the module, after `initializeCalicoMotion();`, call:

```js
startCalicoSpriteHealthWatchdog();
```

This is intentionally conservative. It does not reload the WebView and does not touch native windows. It only returns the sprite to the known-good default state if the image element becomes invalid.

**Step 4: Run the focused test**

Run:

```bash
npm test -- src/overlay/overlayHtml.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add public/overlay.html src/overlay/overlayHtml.test.ts
git commit -m "fix: reset Calico sprite when image state is invalid"
```

---

### Task 7: Add a manifest guard that deep-idle states are low-cost

**Files:**
- Modify: `src/overlay/calicoManifest.test.ts`

**Step 1: Add a manifest/runtime guard test**

Append this test to `src/overlay/calicoManifest.test.ts`:

```ts
  it("keeps deep idle states on non-replay assets", async () => {
    const manifest = readManifest();
    const { IDLE_MOTION_POOL } = await loadIdleDirector();
    const deepIdleStates = IDLE_MOTION_POOL
      .filter((entry) => (entry.weights.deepIdle ?? 0) > 0)
      .map((entry) => entry.state);

    expect(deepIdleStates.length).toBeGreaterThan(0);
    for (const stateName of deepIdleStates) {
      expect(manifest.states[stateName].replay, stateName).toBe(false);
    }
  });
```

If the local TypeScript type in this file only exposes `{ state: string }`, update it to:

```ts
type IdleDirectorModule = {
  IDLE_MOTION_POOL: Array<{ state: string; weights: Record<string, number> }>;
};
```

**Step 2: Run the focused test**

Run:

```bash
npm test -- src/overlay/calicoManifest.test.ts
```

Expected: PASS.

**Step 3: Commit**

```bash
git add src/overlay/calicoManifest.test.ts
git commit -m "test: guard Calico deep idle assets"
```

---

### Task 8: Run full verification before completion

**Files:**
- No source edits expected.

**Step 1: Run the focused Calico tests**

Run:

```bash
npm test -- src/overlay/calicoMotionRuntime.test.ts src/overlay/calicoIdleDirector.test.ts src/overlay/calicoManifest.test.ts src/overlay/overlayHtml.test.ts
```

Expected: PASS.

**Step 2: Run prompt workflow regression tests**

Run:

```bash
npm test -- src/app/App.test.tsx src/overlay/useInputTargetPolling.test.ts
```

Expected: PASS. This guards the user-facing prompt panel, prompt selection feedback, and floating button polling behavior.

**Step 3: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS.

**Step 4: Run the production build**

Run:

```bash
npm run build
```

Expected: PASS.

**Step 5: Optional local long-run diagnostic**

This is optional and should not block code completion if the user asks to skip physical testing. If run, start the app and inspect WebContent memory after at least 20 minutes. The expected result is that the Calico WebContent process does not show the previous linear climb toward GB-scale memory.

Useful command:

```bash
/usr/bin/log show --style compact --predicate 'process == "prompt-picker" AND eventMessage CONTAINS "Current memory footprint"' --last 30m
```

Expected: no steady unbounded growth pattern like `37 MB -> 3242 MB`.

**Step 6: Commit any verification-only test adjustments**

Only commit if verification required small test-only corrections:

```bash
git status --short
git add <changed-files>
git commit -m "test: verify Calico motion stability"
```

---

### Task 9: Final review and push

**Files:**
- No source edits expected unless review finds an issue.

**Step 1: Review the diff**

Run:

```bash
git status --short
git diff --stat HEAD~5..HEAD
git diff HEAD~5..HEAD -- public/calico/motion-runtime.js public/calico/idle-director.js public/overlay.html src/overlay
```

Expected:
- Only Calico motion runtime, idle director, overlay watchdog, and their tests changed.
- No prompt storage, prompt selection, autosend backend, signing, release, or package metadata changes.

**Step 2: Confirm no forbidden files changed**

Run:

```bash
git diff --name-only HEAD~5..HEAD | rg '^(src/App.tsx|src/shared/settingsStore.ts|src-tauri/src/platform/macos.rs|src-tauri/src/lib.rs|src-tauri/src/windows.rs|package.json|scripts/)' || true
```

Expected: no output. If there is output, inspect carefully and revert only the agent's own unrelated edits.

**Step 3: Confirm branch**

Run:

```bash
git branch --show-current
```

Expected: `main`.

**Step 4: Push**

Run:

```bash
git push origin main
```

Expected: push succeeds.

---

## Acceptance Criteria

- Replay animation URLs are bounded to a fixed small number of identities per runtime instance.
- The implementation does not depend on WebKit immediately clearing old APNG cache entries.
- Long-running idle no longer schedules replay-heavy APNG states forever every few seconds.
- Deep idle uses only non-replay states.
- Sprite image load errors recover to `idle-follow`.
- Existing click, drag, prompt popover, prompt selection, autosend feedback, and right-click close-pet behavior remain unchanged.
- No prompt data, prompt category, autosend backend, permission flow, release, or signing files are changed.
- Focused Calico tests pass.
- Prompt workflow regression tests pass.
- Full `npm test` passes.
- `npm run build` passes.

---

## Non-Goals

- Do not redesign the pet visuals.
- Do not remove rich Calico actions.
- Do not change prompt category UI.
- Do not change autosend behavior.
- Do not change macOS permissions flow.
- Do not package or release the app as part of this fix unless explicitly requested after implementation.
