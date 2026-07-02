# Calico Paper Plane Throw Animation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add two Calico interaction animations: a paper-plane ready pose when the user opens the prompt list, and a paper-plane throw effect when the user selects a prompt.

**Architecture:** Keep autosend behavior unchanged. Treat the new motion as a visual layer: the button overlay switches into a ready/throw state, and a short-lived transparent flight window renders the paper plane moving away from Calico. This avoids resizing the Calico button window and avoids interfering with target focus, paste, or Return.

**Tech Stack:** Tauri v2, React, TypeScript, vanilla `public/overlay.html`, Rust window commands, macOS non-activating transparent panels, Vitest, Cargo tests.

---

## Non-Goals

- Do not change the existing paste/Return backend logic.
- Do not require exact input-field coordinates for the animation.
- Do not animate once per prompt in a group. A group selection plays one throw animation.
- Do not introduce a cancel-running-group UI.
- Do not replace the existing Calico character asset set globally.

## UX Contract

User-facing sequence:

```text
Click Calico
-> Calico holds a paper plane and looks ready to send
-> prompt list appears

Click one prompt or one group
-> prompt list hides
-> Calico throws the paper plane
-> paper plane flies away in the direction of the input area
-> backend pastes and presses Return as it already does
-> Calico returns to idle
```

The animation must never decide whether autosend succeeded. Success/failure remains controlled by `prompt-autosend-status`.

## Hidden Risks And Guardrails

- **Risk: resizing the Calico button window can reintroduce jumping.** Guardrail: do not change `BUTTON_WIDTH` / `BUTTON_HEIGHT`; render long-distance flight in a separate temporary transparent window.
- **Risk: transparent flight window blocks clicks or steals focus.** Guardrail: configure it as non-activating and mouse-click-through.
- **Risk: ready state gets stuck if user opens the list but selects nothing.** Guardrail: ready state uses a long timeout, at least 30000ms, and any throw/status/context-menu/drag event forces a deterministic next state.
- **Risk: group sending becomes noisy.** Guardrail: group click emits one throw-start event only.
- **Risk: tests become string-only and miss behavior.** Guardrail: add both static overlay HTML tests and React event-order tests.
- **Risk: throw animation starts while the prompt list is still visible.** Guardrail: prompt selection must hide the popover, wait for the existing hide delay, then emit the throw animation event, then call the autosend backend.
- **Risk: the flight window remains if its HTML never loads or its close command fails.** Guardrail: Rust schedules a backend close fallback around 1200ms after creating the flight window.

---

### Task 1: Add Tests For Throw Events From Prompt Selection

**Files:**
- Modify: `src/app/App.test.tsx`
- Test: `src/app/App.test.tsx`

**Step 1: Write the failing test for single prompt throw event**

Update the existing `beforeEach` so tests that override `emitMock` do not leak implementations into later cases:

```ts
emitMock.mockReset();
emitMock.mockResolvedValue(undefined);
```

Add a test near the existing autosend selection tests:

```ts
it("hides the prompt list before emitting a paper-plane throw event for a selected single prompt", async () => {
  const { invoke } = await import("@tauri-apps/api/core");
  const callOrder: string[] = [];
  vi.mocked(invoke).mockClear();
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    callOrder.push(`invoke:${command}`);
    if (command === "paste_prompt_and_submit_to_last_target") {
      return { copied: true, sent: true, error: null };
    }
    return undefined;
  });
  emitMock.mockImplementation(async (event: string) => {
    callOrder.push(`emit:${event}`);
  });
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
      "paste_prompt_and_submit_to_last_target",
      { body: "Test body" }
    );
  });
  expect(emitMock).toHaveBeenCalledWith("prompt-throw-send", {
    kind: "single",
  });
  expect(callOrder.indexOf("invoke:hide_prompt_popover")).toBeLessThan(
    callOrder.indexOf("emit:prompt-throw-send")
  );
  expect(callOrder.indexOf("emit:prompt-throw-send")).toBeLessThan(
    callOrder.indexOf("invoke:paste_prompt_and_submit_to_last_target")
  );
});
```

**Step 2: Write the failing test for group prompt throw event**

Add:

```ts
it("emits one paper-plane throw event for a grouped prompt selection", async () => {
  const { invoke } = await import("@tauri-apps/api/core");
  vi.mocked(invoke).mockClear();
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    if (command === "paste_prompt_sequence_and_submit_to_last_target") {
      return {
        copied: true,
        sent: true,
        sent_count: 2,
        failed_index: null,
        error: null,
        reason: null,
      };
    }
    return undefined;
  });
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  (readTextFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
    JSON.stringify({
      version: 2,
      containers: [
        {
          id: "group-1",
          title: "Repair Group",
          type: "group",
          prompts: [
            { id: "entry-1", body: "First prompt", order: 0 },
            { id: "entry-2", body: "Second prompt", order: 1 },
          ],
          intervalMs: 700,
          order: 0,
          createdAt: "2026-07-03T00:00:00.000Z",
          updatedAt: "2026-07-03T00:00:00.000Z",
        },
      ],
    })
  );

  await act(async () => {
    render(<App />);
  });

  fireEvent.click(await screen.findByText("Repair Group"));

  await waitFor(() => {
    expect(emitMock).toHaveBeenCalledWith("prompt-throw-send", {
      kind: "group",
    });
  });
  const throwCalls = emitMock.mock.calls.filter(([event]) => event === "prompt-throw-send");
  expect(throwCalls).toHaveLength(1);
});
```

**Step 3: Run tests to verify they fail**

Run:

```bash
npm test -- src/app/App.test.tsx
```

Expected: FAIL because `prompt-throw-send` is not emitted.

**Step 4: Commit tests**

Do not commit yet if implementation immediately follows in this same task. If committing separately:

```bash
git add src/app/App.test.tsx
git commit -m "test: expect paper plane throw event on prompt select"
```

---

### Task 2: Emit Throw Event From Prompt Selection

**Files:**
- Modify: `src/App.tsx`
- Test: `src/app/App.test.tsx`

**Step 1: Add event helper**

Add near `emitAutosendStatus`:

```ts
async function emitPromptThrowSend(kind: "single" | "group") {
  try {
    await emit("prompt-throw-send", { kind });
  } catch (error) {
    console.warn("Failed to emit prompt throw animation:", error);
  }
}
```

**Step 2: Call helper in `handleSelect` after the prompt list is hidden**

Inside `handleSelect`, keep `hidePromptPopover()` and `waitForWindowHide()` first, then emit the throw animation, then continue to autosend:

```ts
await hidePromptPopover();
await waitForWindowHide();
await emitPromptThrowSend(prompt.type === "group" ? "group" : "single");
```

Do not emit `prompt-throw-send` before `hidePromptPopover()`. The throw should start only after the list has disappeared, so the paper plane is not visually hidden behind the popover.

**Step 3: Run test**

Run:

```bash
npm test -- src/app/App.test.tsx
```

Expected: PASS for the new throw-event tests and existing autosend tests.

**Step 4: Commit**

```bash
git add src/App.tsx src/app/App.test.tsx
git commit -m "feat: emit paper plane throw event"
```

---

### Task 3: Add Overlay Tests For Ready And Throw States

**Files:**
- Modify: `src/overlay/overlayHtml.test.ts`
- Test: `src/overlay/overlayHtml.test.ts`

**Step 1: Write failing tests**

Add:

```ts
it("switches Calico into a paper-plane ready state before opening prompts", () => {
  const html = readFileSync("public/overlay.html", "utf8");

  expect(html).toContain("throwReady");
  expect(html).toContain("calico-plane");
  expect(html).toContain("setSprite('throwReady'");
  expect(html.indexOf("setSprite('throwReady'")).toBeLessThan(
    html.indexOf("begin_prompt_pick_session")
  );
});
```

Add:

```ts
it("listens for paper-plane throw events and starts the flight animation", () => {
  const html = readFileSync("public/overlay.html", "utf8");

  expect(html).toContain("prompt-throw-send");
  expect(html).toContain("playPaperPlaneThrow");
  expect(html).toContain("show_paper_plane_flight_from_button");
  expect(html).toContain("setSprite('throwSend'");
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- src/overlay/overlayHtml.test.ts
```

Expected: FAIL because overlay states/events do not exist yet.

---

### Task 4: Add Paper Plane Asset And Local Button Animation

**Files:**
- Create: `public/calico/paper-plane.svg`
- Modify: `public/overlay.html`
- Test: `src/overlay/overlayHtml.test.ts`

**Step 1: Create paper plane SVG**

Create `public/calico/paper-plane.svg`:

```xml
<svg width="36" height="28" viewBox="0 0 36 28" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M2.5 13.8L33.3 2.4L24.4 25.7L17.5 17.9L9.8 22.2L12.2 15.8L2.5 13.8Z" fill="#F8FAFC"/>
  <path d="M33.3 2.4L17.5 17.9M33.3 2.4L12.2 15.8M17.5 17.9L24.4 25.7M17.5 17.9L9.8 22.2L12.2 15.8M12.2 15.8L2.5 13.8L33.3 2.4Z" stroke="#4B5563" stroke-width="2" stroke-linejoin="round"/>
  <path d="M17.4 17.9L13.2 25.5L9.8 22.2L17.4 17.9Z" fill="#E5E7EB" stroke="#4B5563" stroke-width="1.5" stroke-linejoin="round"/>
</svg>
```

**Step 2: Add paper plane DOM**

In `public/overlay.html`, inside the button after the image:

```html
<img id="paperPlane" class="calico-plane" src="/calico/paper-plane.svg" alt="" draggable="false" />
```

**Step 3: Refactor sprite state mapping**

Replace:

```js
const sprites = {
  idle: '/calico/calico-idle.apng',
  poke: '/calico/calico-react-poke.apng',
  drag: '/calico/calico-react-drag.apng',
  thinking: '/calico/calico-thinking.apng'
};
```

with:

```js
const sprites = {
  idle: '/calico/calico-idle.apng',
  poke: '/calico/calico-react-poke.apng',
  drag: '/calico/calico-react-drag.apng',
  thinking: '/calico/calico-thinking.apng',
  throwReady: '/calico/calico-idle.apng',
  throwSend: '/calico/calico-react-poke.apng'
};
```

Update `setSprite` to also store the state:

```js
function setSprite(state, resetMs = 0) {
  if (!sprite || !sprites[state]) return;
  window.clearTimeout(spriteResetTimer);
  btn.dataset.spriteState = state;
  if (!sprite.src.endsWith(sprites[state])) {
    sprite.src = sprites[state];
  }
  if (resetMs > 0) {
    spriteResetTimer = window.setTimeout(() => setSprite('idle'), resetMs);
  }
}
```

**Step 4: Add CSS for ready and local throw**

Add near existing `.calico-sprite` rules:

```css
.calico-plane {
  position: absolute;
  left: 66px;
  top: 50px;
  width: 30px;
  height: 24px;
  opacity: 0;
  transform: translate(-50%, -50%) rotate(-18deg) scale(0.72);
  transform-origin: 50% 50%;
  pointer-events: none;
  filter: drop-shadow(0 4px 8px rgba(15, 23, 42, 0.16));
}

.calico-entry[data-sprite-state="throwReady"] .calico-sprite {
  transform: translateY(-1px) rotate(-4deg) scale(1.02);
}

.calico-entry[data-sprite-state="throwReady"] .calico-plane {
  opacity: 1;
  animation: paper-ready-bob 900ms ease-in-out infinite alternate;
}

.calico-entry[data-sprite-state="throwSend"] .calico-sprite {
  transform: translateX(-2px) rotate(-8deg) scale(1.04);
}

.calico-entry[data-sprite-state="throwSend"] .calico-plane {
  opacity: 1;
  animation: paper-local-throw 680ms cubic-bezier(0.2, 0.85, 0.25, 1) forwards;
}

@keyframes paper-ready-bob {
  from { transform: translate(-50%, -50%) rotate(-18deg) scale(0.72); }
  to { transform: translate(-48%, -55%) rotate(-12deg) scale(0.76); }
}

@keyframes paper-local-throw {
  0% { opacity: 1; transform: translate(-50%, -50%) rotate(-18deg) scale(0.72); }
  45% { opacity: 1; transform: translate(-86px, -86px) rotate(-32deg) scale(0.82); }
  100% { opacity: 0; transform: translate(-124px, -118px) rotate(-46deg) scale(0.7); }
}
```

**Step 5: Change click behavior to ready**

In `pointerup` non-drag branch, replace:

```js
setSprite('thinking', 900);
```

with:

```js
setSprite('throwReady', 30000);
```

Do not remove `thinking` yet; tests still expect Calico thinking asset can exist and future code may use it. The ready state timeout must stay long enough that a user can read the list without Calico immediately dropping the paper plane.

**Step 6: Add throw event listener**

Add after `listenForAutosendStatus()`:

```js
function playPaperPlaneThrow() {
  setSprite('throwSend', 900);
  invoke('show_paper_plane_flight_from_button').catch(() => {});
}

function listenForPaperPlaneThrow() {
  if (!tauri?.event?.listen) return;
  tauri.event.listen('prompt-throw-send', () => {
    playPaperPlaneThrow();
  }).catch((error) => {
    console.error('Tauri event listen failed: prompt-throw-send', error);
  });
}

listenForPaperPlaneThrow();
```

**Step 7: Run tests**

Run:

```bash
npm test -- src/overlay/overlayHtml.test.ts
```

Expected: PASS.

**Step 8: Commit**

```bash
git add public/calico/paper-plane.svg public/overlay.html src/overlay/overlayHtml.test.ts
git commit -m "feat: add Calico paper plane ready state"
```

---

### Task 5: Add Temporary Paper Flight Window

**Files:**
- Create: `public/paper-flight.html`
- Modify: `src-tauri/src/windows.rs`
- Modify: `src-tauri/src/macos_panels.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/windows.rs`
- Test: `src-tauri/src/macos_panels.rs` if practical, otherwise static Rust coverage through command use.

**Step 1: Add click-through panel helper**

In `src-tauri/src/macos_panels.rs`, add:

```rust
#[cfg(target_os = "macos")]
pub fn configure_ignores_mouse_events(
    window: &tauri::WebviewWindow,
    ignores: bool,
) -> Result<(), String> {
    let ns_window_ptr = window.ns_window().map_err(|e| e.to_string())?;
    if ns_window_ptr.is_null() {
        return Err("ns_window returned null".to_string());
    }

    unsafe {
        let ns_window = &*(ns_window_ptr.cast::<NSWindow>());
        ns_window.setIgnoresMouseEvents(ignores);
    }

    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn configure_ignores_mouse_events(
    _window: &tauri::WebviewWindow,
    _ignores: bool,
) -> Result<(), String> {
    Ok(())
}
```

**Step 2: Create flight HTML**

Create `public/paper-flight.html`:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: transparent;
      pointer-events: none;
    }

    .paper {
      position: absolute;
      width: 38px;
      height: 30px;
      left: var(--start-x);
      top: var(--start-y);
      transform: translate(-50%, -50%) rotate(-18deg) scale(0.8);
      opacity: 0;
      filter: drop-shadow(0 10px 18px rgba(15, 23, 42, 0.22));
      animation: fly 720ms cubic-bezier(0.18, 0.82, 0.22, 1) forwards;
    }

    @keyframes fly {
      0% {
        opacity: 0;
        transform: translate(-50%, -50%) rotate(-18deg) scale(0.74);
      }
      12% {
        opacity: 1;
      }
      58% {
        opacity: 1;
        transform:
          translate(calc(var(--mid-x) - var(--start-x) - 50%), calc(var(--mid-y) - var(--start-y) - 50%))
          rotate(-32deg)
          scale(0.92);
      }
      100% {
        opacity: 0;
        transform:
          translate(calc(var(--end-x) - var(--start-x) - 50%), calc(var(--end-y) - var(--start-y) - 50%))
          rotate(-45deg)
          scale(0.62);
      }
    }
  </style>
</head>
<body>
  <img class="paper" src="/calico/paper-plane.svg" alt="" />
  <script type="module">
    const params = new URLSearchParams(window.location.search);
    const startX = Number(params.get("startX") || 0);
    const startY = Number(params.get("startY") || 0);
    const endX = Number(params.get("endX") || 0);
    const endY = Number(params.get("endY") || 0);
    const midX = (startX + endX) / 2;
    const midY = Math.min(startY, endY) - 96;

    document.documentElement.style.setProperty("--start-x", `${startX}px`);
    document.documentElement.style.setProperty("--start-y", `${startY}px`);
    document.documentElement.style.setProperty("--mid-x", `${midX}px`);
    document.documentElement.style.setProperty("--mid-y", `${midY}px`);
    document.documentElement.style.setProperty("--end-x", `${endX}px`);
    document.documentElement.style.setProperty("--end-y", `${endY}px`);

    window.setTimeout(async () => {
      try {
        await window.__TAURI__?.core?.invoke?.("hide_paper_plane_flight");
      } catch {}
    }, 820);
  </script>
</body>
</html>
```

**Step 3: Add window constants and command**

In `src-tauri/src/windows.rs`, add:

```rust
pub const PAPER_FLIGHT_WINDOW_LABEL: &str = "paper-plane-flight";
```

Add command:

```rust
#[tauri::command]
pub fn show_paper_plane_flight_from_button(app: tauri::AppHandle) -> Result<(), String> {
    let Some(button) = app.get_webview_window(BUTTON_WINDOW_LABEL) else {
        return Ok(());
    };
    let monitor = button
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or(app.primary_monitor().map_err(|e| e.to_string())?);
    let Some(monitor) = monitor else {
        return Ok(());
    };

    let scale = monitor.scale_factor();
    let monitor_x = monitor.position().x as f64 / scale;
    let monitor_y = monitor.position().y as f64 / scale;
    let monitor_w = monitor.size().width as f64 / scale;
    let monitor_h = monitor.size().height as f64 / scale;

    let position = button.outer_position().map_err(|e| e.to_string())?;
    let button_scale = button.scale_factor().unwrap_or(1.0);
    let button_x = position.x as f64 / button_scale;
    let button_y = position.y as f64 / button_scale;

    let start_x = button_x + 72.0 - monitor_x;
    let start_y = button_y + 56.0 - monitor_y;
    let end_x = (start_x - 460.0).clamp(48.0, monitor_w - 48.0);
    let end_y = (start_y - 120.0).clamp(48.0, monitor_h - 48.0);

    if let Some(window) = app.get_webview_window(PAPER_FLIGHT_WINDOW_LABEL) {
        let _ = window.close();
    }

    let url = format!(
        "paper-flight.html?startX={:.0}&startY={:.0}&endX={:.0}&endY={:.0}",
        start_x, start_y, end_x, end_y
    );
    let window = WebviewWindowBuilder::new(
        &app,
        PAPER_FLIGHT_WINDOW_LABEL,
        WebviewUrl::App(url.into()),
    )
    .title("Paper Plane")
    .inner_size(monitor_w, monitor_h)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .position(monitor_x, monitor_y)
    .build()
    .map_err(|e| e.to_string())?;

    crate::macos_panels::configure_transparent_webview_window(&window)?;
    crate::macos_panels::configure_non_activating_panel(&window)?;
    crate::macos_panels::configure_ignores_mouse_events(&window, true)?;

    let app_for_close = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1200));
        if let Some(window) = app_for_close.get_webview_window(PAPER_FLIGHT_WINDOW_LABEL) {
            let _ = window.close();
        }
    });

    Ok(())
}
```

Add:

```rust
#[tauri::command]
pub fn hide_paper_plane_flight(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(PAPER_FLIGHT_WINDOW_LABEL) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

**Step 4: Export and register commands**

In `src-tauri/src/lib.rs`, update the `pub use windows::{ ... }` list:

```rust
hide_paper_plane_flight, show_paper_plane_flight_from_button,
```

Add both commands to the Tauri invoke handler:

```rust
show_paper_plane_flight_from_button,
hide_paper_plane_flight,
```

**Step 5: Add simple Rust unit tests for flight math**

Extract target calculation into a pure helper:

```rust
fn paper_flight_points(
    monitor_width: f64,
    monitor_height: f64,
    button_x: f64,
    button_y: f64,
    monitor_x: f64,
    monitor_y: f64,
) -> (f64, f64, f64, f64) {
    let start_x = button_x + 72.0 - monitor_x;
    let start_y = button_y + 56.0 - monitor_y;
    let end_x = (start_x - 460.0).clamp(48.0, monitor_width - 48.0);
    let end_y = (start_y - 120.0).clamp(48.0, monitor_height - 48.0);
    (start_x, start_y, end_x, end_y)
}
```

Add tests:

```rust
#[test]
fn paper_flight_points_move_left_and_up_when_space_allows() {
    let (sx, sy, ex, ey) = paper_flight_points(1440.0, 900.0, 1000.0, 600.0, 0.0, 0.0);
    assert_eq!(sx, 1072.0);
    assert_eq!(sy, 656.0);
    assert!(ex < sx);
    assert!(ey < sy);
}

#[test]
fn paper_flight_points_stay_inside_monitor_bounds() {
    let (_sx, _sy, ex, ey) = paper_flight_points(500.0, 320.0, 40.0, 30.0, 0.0, 0.0);
    assert!((48.0..=452.0).contains(&ex));
    assert!((48.0..=272.0).contains(&ey));
}
```

**Step 6: Run tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml paper_flight_points
```

Expected: PASS.

**Step 7: Add static check for backend close fallback**

Add a Rust unit or static test that verifies `show_paper_plane_flight_from_button` contains a fallback close delay. If using a static test is simpler, add a test that reads `src-tauri/src/windows.rs` and asserts it contains both `PAPER_FLIGHT_WINDOW_LABEL` and `Duration::from_millis(1200)`.

**Step 8: Commit**

```bash
git add public/paper-flight.html src-tauri/src/windows.rs src-tauri/src/macos_panels.rs src-tauri/src/lib.rs
git commit -m "feat: render paper plane flight overlay"
```

---

### Task 6: Connect Overlay Throw Event To Flight Command

**Files:**
- Modify: `public/overlay.html`
- Test: `src/overlay/overlayHtml.test.ts`

**Step 1: Ensure `playPaperPlaneThrow` invokes backend command**

Confirm this exists from Task 4:

```js
function playPaperPlaneThrow() {
  setSprite('throwSend', 900);
  invoke('show_paper_plane_flight_from_button').catch(() => {});
}
```

**Step 2: Ensure event listener is registered after Tauri event availability check**

Confirm:

```js
function listenForPaperPlaneThrow() {
  if (!tauri?.event?.listen) return;
  tauri.event.listen('prompt-throw-send', () => {
    playPaperPlaneThrow();
  }).catch((error) => {
    console.error('Tauri event listen failed: prompt-throw-send', error);
  });
}

listenForPaperPlaneThrow();
```

**Step 3: Run overlay tests**

Run:

```bash
npm test -- src/overlay/overlayHtml.test.ts
```

Expected: PASS.

**Step 4: Commit**

If Task 4 already committed this exact code, skip this commit. Otherwise:

```bash
git add public/overlay.html src/overlay/overlayHtml.test.ts
git commit -m "feat: play paper plane throw from overlay"
```

---

### Task 7: Add Integration-Focused Assertions For Autosend Status Compatibility

**Files:**
- Modify: `src/app/App.test.tsx`
- Test: `src/app/App.test.tsx`

**Step 1: Add assertion to existing sent-status test**

In `"emits a sent status when autosend reports keyboard success"`, add:

```ts
expect(emitMock).toHaveBeenCalledWith("prompt-throw-send", {
  kind: "single",
});
```

Keep existing:

```ts
expect(emitMock).toHaveBeenCalledWith("prompt-autosend-status", {
  kind: "sent",
  message: "已粘贴并回车",
});
```

**Step 2: Add assertion to permission failure test**

In `"emits an actionable permission status when autosend lacks accessibility permission"`, add:

```ts
expect(emitMock).toHaveBeenCalledWith("prompt-throw-send", {
  kind: "single",
});
```

This confirms the animation is not falsely tied to successful autosend.

**Step 3: Run tests**

Run:

```bash
npm test -- src/app/App.test.tsx
```

Expected: PASS.

**Step 4: Commit**

```bash
git add src/app/App.test.tsx
git commit -m "test: preserve autosend status with throw animation"
```

---

### Task 8: Full Verification

**Files:**
- No code changes.

**Step 1: Run frontend tests**

Run:

```bash
npm test -- src/app/App.test.tsx src/overlay/overlayHtml.test.ts
```

Expected: PASS.

**Step 2: Run frontend build**

Run:

```bash
npm run build
```

Expected: Vite/TypeScript build passes.

**Step 3: Run targeted Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml paper_flight_points
```

Expected: PASS.

**Step 4: Run broader Rust test suite if time permits**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

**Step 5: Manual smoke test checklist**

Use the local app build or dev run:

```text
1. Click Calico without dragging.
   Expected: paper-plane ready pose appears before prompt list opens.

2. Click a single prompt.
   Expected: list hides first, then Calico throws, paper plane flies away, prompt autosends.

3. Click a group prompt.
   Expected: exactly one throw animation, backend sends group sequence.

4. Drag Calico.
   Expected: drag animation still works and no paper plane flight triggers.

5. Right-click Calico.
   Expected: controls menu opens; no throw animation triggers.

6. Click Accessibility bubble if permission is missing.
   Expected: existing permission flow still works.
```

**Step 6: Commit verification-only changes**

No commit unless tests or docs changed.

---

### Task 9: Package Readiness Check

**Files:**
- No code changes unless verification finds issues.

**Step 1: Review diff**

Run:

```bash
git status --short
git diff --stat
git diff -- public/overlay.html src/App.tsx src-tauri/src/windows.rs src-tauri/src/macos_panels.rs src-tauri/src/lib.rs
```

Expected:

```text
Only paper-plane animation, event wiring, tests, and assets changed.
No autosend backend behavior changes except registering the new flight command.
```

**Step 2: Optional package**

Only package after user approval:

```bash
npm run tauri build
```

Expected:

```text
App and DMG are generated under src-tauri/target/release/bundle/
```

**Step 3: Final commit**

If previous tasks were not committed separately:

```bash
git add public/calico/paper-plane.svg public/paper-flight.html public/overlay.html src/App.tsx src/app/App.test.tsx src/overlay/overlayHtml.test.ts src-tauri/src/windows.rs src-tauri/src/macos_panels.rs src-tauri/src/lib.rs
git commit -m "feat: add Calico paper plane throw animation"
```

---

## Acceptance Criteria

- Clicking Calico shows a paper-plane ready state before the quick list appears.
- Selecting a single prompt hides the prompt list first, then plays one throw animation, then keeps existing autosend behavior.
- Selecting a group prompt hides the prompt list first, then plays one throw animation, then keeps existing sequence autosend behavior.
- Dragging Calico still shows drag behavior and does not trigger prompt selection animation.
- Right-click controls still open normally.
- The temporary flight animation window is transparent, non-activating, always-on-top, click-through, and has both frontend and backend close paths.
- Existing status bubbles still display success/failure/permission messages.
- Tests pass: `npm test -- src/app/App.test.tsx src/overlay/overlayHtml.test.ts`.
- Targeted Rust tests pass: `cargo test --manifest-path src-tauri/Cargo.toml paper_flight_points`.
