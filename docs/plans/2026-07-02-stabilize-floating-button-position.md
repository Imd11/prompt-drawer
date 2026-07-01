# Stabilize Floating Button Position Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop the blue `Prompts` floating button from jumping between positions when the prompt popover is open.

**Architecture:** Make the main Tauri window the only owner of input-target polling and floating-button positioning. Prompt popover and button-controls windows must render UI only; they must never start input-target polling or call `show_prompt_button` indirectly. After ownership is fixed, normalize button window coordinates so read, write, drag, and popover placement use one coordinate system.

**Tech Stack:** Tauri v2, React 19, Vite, Vitest, macOS Accessibility/System Events, Rust unit tests.

---

## Root Cause Summary

The current `App` calls `useInputTargetPolling(...)` unconditionally in `src/App.tsx`. Since `prompt-popover` and `button-controls` are also rendered by the same React `App`, each WebView creates an independent polling loop. Every polling loop can call `showPromptButton(...)`, and `show_prompt_button` moves the same global `prompt-button` window. Last caller wins, so the button appears to jump.

There is also a secondary coordinate risk: `show_prompt_button` updates existing windows with `Position::Physical`, while drag movement uses `Position::Logical` and position reads divide by `scale_factor`. On Retina displays, this can amplify visible jumps.

## Product Rules

- Do not change prompt list contents, prompt manager behavior, import/export, or paste behavior.
- Do not add broader desktop-wide input scanning in this pass.
- Do not let `prompt-popover` or `button-controls` control button placement.
- Do not hide the floating button just because a non-main window is mounted.
- Preserve user drag offset behavior.
- Keep the fix small and test-driven.

---

### Task 1: Capture That Popover Windows Must Not Start Button Polling

**Files:**
- Modify: `src/app/App.test.tsx`

**Step 1: Mock the polling hook**

At the top of `src/app/App.test.tsx`, add a hoisted mock before importing behavior depends on `App`:

```ts
const inputTargetPollingMock = vi.hoisted(() => vi.fn());

vi.mock("../overlay/useInputTargetPolling", () => ({
  useInputTargetPolling: inputTargetPollingMock,
}));
```

In the existing `beforeEach`, reset route state and the mock:

```ts
beforeEach(() => {
  currentWindowLabel = "prompt-popover";
  window.history.pushState({}, "", "/");
  inputTargetPollingMock.mockClear();
});
```

**Step 2: Write the failing popover test**

Add:

```ts
it("does not start input target polling in prompt popover windows", async () => {
  currentWindowLabel = "prompt-popover";
  window.history.pushState({}, "", "/?mode=popover");
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  (readTextFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
    JSON.stringify({ version: 1, prompts: mockPrompts })
  );

  await act(async () => {
    render(<App />);
  });

  await screen.findByText("Test Prompt");
  expect(inputTargetPollingMock).not.toHaveBeenCalled();
});
```

**Step 3: Write the failing button-controls test**

Add:

```ts
it("does not start input target polling in button controls windows", async () => {
  currentWindowLabel = "prompt-popover";
  window.history.pushState({}, "", "/?mode=button-controls");
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  (readTextFile as ReturnType<typeof vi.fn>).mockImplementation(
    async (path: string) => {
      if (path.includes("prompts")) {
        return JSON.stringify({ version: 1, prompts: mockPrompts });
      }
      if (path.includes("settings")) {
        return JSON.stringify({
          version: 1,
          blacklistedApps: [],
          overlayPlacement: { buttonOffset: null },
          floatingButton: { visible: true },
        });
      }
      throw new Error("unexpected path: " + path);
    }
  );

  await act(async () => {
    render(<App />);
  });

  await screen.findByRole("button", { name: "Hide Button" });
  expect(inputTargetPollingMock).not.toHaveBeenCalled();
});
```

**Step 4: Run the test to verify failure**

Run:

```bash
./node_modules/.bin/vitest run src/app/App.test.tsx --reporter=verbose
```

Expected: FAIL because `App` currently calls `useInputTargetPolling(...)` even in popover and button-controls windows.

**Step 5: Commit**

Do not commit yet. This task intentionally leaves failing tests for Task 2.

---

### Task 2: Move Polling Ownership To Main Window Only

**Files:**
- Modify: `src/App.tsx`
- Test: `src/app/App.test.tsx`

**Step 1: Create a small polling controller component**

In `src/App.tsx`, add this component near `DEFAULT_SETTINGS`:

```tsx
interface InputTargetPollingControllerProps {
  settings: Settings;
  onButtonDragEnd: (
    position: { x: number; y: number },
    basePosition: [number, number] | null
  ) => void;
}

function InputTargetPollingController({
  settings,
  onButtonDragEnd,
}: InputTargetPollingControllerProps) {
  useInputTargetPolling(
    settings.blacklistedApps.map((app) => app.bundleId),
    settings.overlayPlacement,
    { onButtonDragEnd },
    settings.floatingButton.visible
  );

  return null;
}
```

**Step 2: Remove the unconditional hook call**

Delete the current unconditional call:

```tsx
// eslint-disable-next-line react-hooks/rules-of-hooks
useInputTargetPolling(
  activeSettings.blacklistedApps.map((app) => app.bundleId),
  activeSettings.overlayPlacement,
  { onButtonDragEnd: handleButtonDragEnd },
  activeSettings.floatingButton.visible
);
```

**Step 3: Add a render helper for the owner-only controller**

Inside `App`, after `removeBlacklistedApp`, add:

```tsx
const pollingController =
  windowLabel === "main" ? (
    <InputTargetPollingController
      settings={activeSettings}
      onButtonDragEnd={handleButtonDragEnd}
    />
  ) : null;
```

**Step 4: Render the controller only in main-window branches**

For the main window branch, wrap the returned UI:

```tsx
return (
  <>
    {pollingController}
    <MainWindow
      floatingButtonVisible={activeSettings.floatingButton.visible}
      ...
    />
  </>
);
```

For `manager` and `settings` branches, include `{pollingController}` inside a fragment before the page content:

```tsx
return (
  <>
    {pollingController}
    <div className="app-window app-window-main">
      ...
    </div>
  </>
);
```

For `button-controls` and default popover branches, also use the same fragment pattern. Because `pollingController` is `null` when `windowLabel !== "main"`, these windows render UI only and do not poll.

**Step 5: Add a passing main-window ownership test**

In `src/app/App.test.tsx`, add:

```ts
it("starts input target polling in the main window", async () => {
  currentWindowLabel = "main";
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  (readTextFile as ReturnType<typeof vi.fn>).mockResolvedValue(
    JSON.stringify({ version: 1, prompts: mockPrompts })
  );

  await act(async () => {
    render(<App />);
  });

  await screen.findByText("Prompt Picker");
  expect(inputTargetPollingMock).toHaveBeenCalledTimes(1);
});
```

**Step 6: Run the App tests**

Run:

```bash
./node_modules/.bin/vitest run src/app/App.test.tsx --reporter=verbose
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src/App.tsx src/app/App.test.tsx
git commit -m "fix: keep floating button polling in main window"
```

---

### Task 3: Add Regression Coverage For Prompt List Clicks Not Moving The Button

**Files:**
- Modify: `src/app/App.test.tsx`

**Step 1: Write the test**

Add:

```ts
it("does not move the floating button when selecting a prompt from the popover", async () => {
  const { invoke } = await import("@tauri-apps/api/core");
  vi.mocked(invoke).mockResolvedValue(undefined);
  currentWindowLabel = "prompt-popover";
  window.history.pushState({}, "", "/?mode=popover");
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  (readTextFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
    JSON.stringify({ version: 1, prompts: mockPrompts })
  );

  await act(async () => {
    render(<App />);
  });

  fireEvent.click(await screen.findByText("Test Prompt"));

  await waitFor(() => {
    expect(vi.mocked(invoke)).toHaveBeenCalledWith(
      "paste_prompt_to_last_target",
      { body: "Test body" }
    );
  });

  expect(vi.mocked(invoke)).not.toHaveBeenCalledWith(
    "show_prompt_button",
    expect.anything()
  );
  expect(inputTargetPollingMock).not.toHaveBeenCalled();
});
```

**Step 2: Run test**

Run:

```bash
./node_modules/.bin/vitest run src/app/App.test.tsx --reporter=verbose
```

Expected: PASS after Task 2.

**Step 3: Commit**

```bash
git add src/app/App.test.tsx
git commit -m "test: prevent popover from moving floating button"
```

---

### Task 4: Capture Coordinate Unit Consistency In Rust

**Files:**
- Modify: `src-tauri/src/windows.rs`

**Step 1: Write the failing unit test**

In `src-tauri/src/windows.rs`, inside the existing `#[cfg(test)] mod tests`, add:

```rust
#[test]
fn prompt_button_set_position_uses_logical_coordinates() {
    let position = prompt_button_window_position(320.0, 240.0);

    match position {
        tauri::Position::Logical(logical) => {
            assert_eq!(logical.x, 320.0);
            assert_eq!(logical.y, 240.0);
        }
        _ => panic!("prompt button position must use logical coordinates"),
    }
}
```

**Step 2: Run the test to verify failure**

Run:

```bash
cd src-tauri
cargo test --lib prompt_button_set_position_uses_logical_coordinates
```

Expected: FAIL because `prompt_button_window_position` does not exist yet.

**Step 3: Do not fix in this task**

Stop after confirming the failing test.

**Step 4: Commit**

Do not commit yet. This task intentionally leaves a failing test for Task 5.

---

### Task 5: Use Logical Coordinates For Button Window Positioning

**Files:**
- Modify: `src-tauri/src/windows.rs`

**Step 1: Add the helper**

In `src-tauri/src/windows.rs`, add near the constants:

```rust
fn prompt_button_window_position(x: f64, y: f64) -> tauri::Position {
    tauri::Position::Logical(tauri::LogicalPosition { x, y })
}
```

**Step 2: Update existing-window positioning**

Change:

```rust
window
    .set_position(tauri::Position::Physical(tauri::PhysicalPosition {
        x: x as i32,
        y: y as i32,
    }))
    .map_err(|e| e.to_string())?;
```

to:

```rust
window
    .set_position(prompt_button_window_position(x, y))
    .map_err(|e| e.to_string())?;
```

**Step 3: Keep new-window creation unchanged**

Do not change this builder call in the same task:

```rust
.position(x, y)
```

This keeps the first pass focused on the update path that causes repeated jumps.

**Step 4: Run the Rust test**

Run:

```bash
cd src-tauri
cargo test --lib prompt_button_set_position_uses_logical_coordinates
```

Expected: PASS.

**Step 5: Run all Rust lib tests**

Run:

```bash
cd src-tauri
cargo test --lib
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src-tauri/src/windows.rs
git commit -m "fix: use logical coordinates for floating button updates"
```

---

### Task 6: Verify Existing Drag Offset Behavior Still Works

**Files:**
- Test only: `src/overlay/useInputTargetPolling.test.ts`
- Test only: `src/shared/settingsStore.test.ts`

**Step 1: Run targeted frontend tests**

Run:

```bash
./node_modules/.bin/vitest run src/overlay/useInputTargetPolling.test.ts src/shared/settingsStore.test.ts --reporter=verbose
```

Expected: PASS.

**Step 2: If a test fails, stop and inspect**

Do not update snapshots or weaken assertions. The expected behavior is:

- Dragging emits a saved offset relative to the current target base.
- Fallback drag position does not snap back.
- Settings store persists `overlayPlacement.buttonOffset`.

**Step 3: Commit**

If no code changed, do not commit. If a small test-only repair is required, commit:

```bash
git add src/overlay/useInputTargetPolling.test.ts src/shared/settingsStore.test.ts
git commit -m "test: preserve floating button drag behavior"
```

---

### Task 7: Full Verification

**Files:**
- No source changes expected

**Step 1: Run frontend tests**

Run:

```bash
npm test
```

Expected: all Vitest tests pass.

**Step 2: Run Rust tests**

Run:

```bash
cd src-tauri
cargo test --lib
```

Expected: all Rust lib tests pass.

**Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: TypeScript and Vite build complete successfully.

**Step 4: Optional package build**

Only run this if the user asks to repackage:

```bash
npm run tauri build
```

Expected: `.app` and `.dmg` build successfully.

**Step 5: Check Git status**

Run:

```bash
git status --short
```

Expected: no unintended files are staged. Existing unrelated `node_modules/.package-lock.json` may remain dirty and must not be committed.

---

### Task 8: Final Report

**Files:**
- No source changes

**Step 1: Summarize root-cause fix**

Report:

- `main` window is now the only owner of floating-button polling.
- `prompt-popover` and `button-controls` no longer move the button.
- Button update positioning uses logical coordinates consistently.

**Step 2: Summarize user-visible behavior**

Report:

- The blue `Prompts` button should no longer jump left/right when the prompt list opens.
- The prompt list should open beside the current button position.
- Dragged button position should remain respected.

**Step 3: Include verification commands**

List the exact commands run and whether they passed:

```bash
./node_modules/.bin/vitest run src/app/App.test.tsx --reporter=verbose
./node_modules/.bin/vitest run src/overlay/useInputTargetPolling.test.ts src/shared/settingsStore.test.ts --reporter=verbose
npm test
cd src-tauri && cargo test --lib
npm run build
```

---

## Execution Notes

- This plan intentionally avoids physical UI testing unless the user asks for it.
- Do not modify prompt paste behavior in this plan.
- Do not modify prompt library storage or manager UI.
- Do not commit `node_modules/.package-lock.json`.
- If `npm run tauri build` is run later, generated `dist/` and `target/` artifacts may need explicit staging because the repository tracks some ignored build output.
