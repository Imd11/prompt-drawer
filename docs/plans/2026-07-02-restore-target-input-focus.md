# Restore Target Input Focus Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Selecting a prompt from Calico reliably restores focus to the user's previous input field, pastes the prompt, and presses Return to send it.

**Architecture:** Replace the current "activate bundle id and blindly paste" path with a target restoration path. When Calico is opened, record the previous app plus the best available input/fallback click point; when a prompt is selected, hide the popover, reactivate the target app, click the recorded input point, wait briefly for focus, paste via clipboard, and press Return. Keep the implementation macOS-only and conservative: no Ctrl+C, no global text typing, no broad refactor of prompt storage or UI management.

**Tech Stack:** Tauri 2, Rust, macOS AppleScript via `osascript`, `pbcopy`, CoreGraphics/Quartz click events, React, TypeScript, Vitest, Cargo tests.

---

## Constraints

- Do not modify generated build output under `/Users/yang/Desktop/GitHub-pre/prompt-picker/dist`.
- Do not modify generated build output under `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/target`.
- Do not commit `/Users/yang/Desktop/GitHub-pre/prompt-picker/node_modules/.package-lock.json`.
- Do not send real messages during verification unless the user explicitly asks for a physical test.
- Keep `paste_prompt_to_app` and `paste_prompt_to_last_target` available for non-autosend fallback behavior.
- Keep Calico and the prompt popover visually unchanged unless a change is directly required for focus reliability.
- Prefer deterministic unit tests for script generation and state transformation; use physical app tests only as optional final validation.

## Current Failure Summary

The current flow stores only the target app bundle id. It does not restore the specific input field.

```text
Click Calico
  -> current_input_target tries to detect focused element
  -> if detection fails, fallback stores only frontmost app
  -> prompt list opens
  -> user clicks prompt
  -> app activates bundle id
  -> app sends Cmd+V and Return
```

This is not enough because activating Codex does not guarantee the Codex input box has the cursor. The prompt list also participates in mouse interaction, so the focus chain differs from OpenWhip's simpler non-focusable overlay pattern.

## Target User Flow

```text
User clicks into Codex input box
  -> User clicks Calico
  -> Prompt Picker records Codex app + window + input/fallback click point
  -> Prompt list opens above Calico
  -> User clicks a prompt
  -> Prompt list immediately hides
  -> Prompt Picker activates Codex
  -> Prompt Picker clicks the recorded input point
  -> Prompt Picker writes prompt to clipboard
  -> Prompt Picker presses Cmd+V
  -> Prompt Picker presses Return
  -> Codex sends the prompt
```

## Text Wireframe

```text
Before:

┌──────────────────────────────────────────────┐
│ Codex conversation                            │
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ Ask for follow-up changes...   cursor | │ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
                         🐱

After clicking Calico:

┌──────────────────────────────────────────────┐
│ Codex conversation                            │
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ Ask for follow-up changes...             │ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
             ┌──────────────────────────┐
             │ 讨论方案                  │
             │ 使用 brainstorming skill...│
             └──────────────────────────┘
                         🐱

After selecting prompt:

┌──────────────────────────────────────────────┐
│ Codex conversation                            │
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ 使用 brainstorming skill，先和我讨论... | │ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

---

## Task 1: Add a Rich Last-Input Target Model

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/platform/macos.rs`

**Step 1: Write failing Rust tests for storing target metadata**

In `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`, extend the existing last input target tests with:

```rust
#[test]
fn stores_target_with_click_point() {
    let state = LastInputTargetState::default();
    state.set(LastInputTarget {
        app: FrontmostApp {
            name: "Codex".to_string(),
            bundle_id: "com.openai.codex".to_string(),
        },
        observed_at_ms: 123,
        click_point: Some(TargetClickPoint { x: 640.0, y: 720.0 }),
    });

    let target = state.get().unwrap();
    assert_eq!(target.app.bundle_id, "com.openai.codex");
    assert_eq!(target.click_point.unwrap().x, 640.0);
}
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri
cargo test stores_target_with_click_point --lib
```

Expected: FAIL because `TargetClickPoint` and `LastInputTarget.click_point` do not exist.

**Step 3: Add the minimal model**

In `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`, add:

```rust
#[derive(Clone, Debug, serde::Serialize)]
pub struct TargetClickPoint {
    pub x: f64,
    pub y: f64,
}
```

Change `LastInputTarget` to:

```rust
#[derive(Clone, Debug, serde::Serialize)]
pub struct LastInputTarget {
    pub app: FrontmostApp,
    pub observed_at_ms: u128,
    pub click_point: Option<TargetClickPoint>,
}
```

Update every test constructor of `LastInputTarget` to include `click_point: None` unless the test specifically needs a point.

**Step 4: Preserve existing target recording**

Change `record_last_app_if_valid` to set `click_point: None`.

Change `record_last_input_target_if_valid` to derive a click point from the input target:

```rust
fn record_last_input_target_if_valid(state: &LastInputTargetState, target: &platform::InputTarget) {
    let Some(app) = target.app.clone() else {
        return;
    };
    if is_prompt_picker_app(&app) {
        return;
    }
    state.set(LastInputTarget {
        app,
        observed_at_ms: now_ms(),
        click_point: Some(TargetClickPoint {
            x: target.button_position.0,
            y: target.button_position.1,
        }),
    });
}
```

**Step 5: Run target tests**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri
cargo test last_input_target_tests --lib
```

Expected: PASS.

**Step 6: Commit**

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
git add src-tauri/src/lib.rs
git commit -m "feat: store input target click point"
```

---

## Task 2: Fix Input Target Detection Fallbacks

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/platform/macos.rs`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`

**Step 1: Write tests for fallback click point calculation**

Add a pure helper in tests first:

```rust
#[test]
fn codex_fallback_click_point_uses_bottom_center_of_window() {
    let point = fallback_click_point_for_app(
        &FrontmostApp {
            name: "Codex".to_string(),
            bundle_id: "com.openai.codex".to_string(),
        },
        &CandidateInput {
            x: 100.0,
            y: 200.0,
            width: 800.0,
            height: 600.0,
        },
    );

    assert_eq!(point.x, 500.0);
    assert_eq!(point.y, 735.0);
}
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri
cargo test codex_fallback_click_point_uses_bottom_center_of_window --lib
```

Expected: FAIL because helper does not exist.

**Step 3: Add pure fallback helper**

In `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/platform/macos.rs`, add:

```rust
#[derive(Clone, Debug, Serialize)]
pub struct TargetClickPoint {
    pub x: f64,
    pub y: f64,
}

pub fn fallback_click_point_for_app(app: &FrontmostApp, window_frame: &CandidateInput) -> TargetClickPoint {
    if app.bundle_id == "com.openai.codex" || app.name == "Codex" {
        return TargetClickPoint {
            x: window_frame.x + (window_frame.width / 2.0),
            y: window_frame.y + window_frame.height - 65.0,
        };
    }

    TargetClickPoint {
        x: window_frame.x + (window_frame.width / 2.0),
        y: window_frame.y + (window_frame.height / 2.0),
    }
}
```

If duplicate struct names become confusing, keep one `TargetClickPoint` in `platform::macos` and convert into the `lib.rs` state type explicitly.

**Step 4: Record a fallback point when focused element detection fails**

In `get_focused_input_element`, if `focused UI element` lookup fails but window position and size are available, return an `InputTarget` with:

```rust
let window_frame = CandidateInput {
    x: window_pos.0,
    y: window_pos.1,
    width: window_size.0,
    height: window_size.1,
};
let fallback = fallback_click_point_for_app(&app, &window_frame);
return Some(InputTarget {
    frame: CandidateInput {
        x: fallback.x,
        y: fallback.y,
        width: 1.0,
        height: 1.0,
    },
    window_frame,
    button_position: (fallback.x, fallback.y),
    app: Some(app.clone()),
});
```

**Step 5: Run focused tests**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri
cargo test platform::macos::tests --lib
```

Expected: PASS.

**Step 6: Commit**

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
git add src-tauri/src/platform/macos.rs src-tauri/src/lib.rs
git commit -m "fix: record fallback input click point"
```

---

## Task 3: Add macOS Target Restoration Before Paste

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/platform/macos.rs`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`

**Step 1: Write tests for generated restore-and-submit script**

Add tests in `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/platform/macos.rs`:

```rust
#[test]
fn paste_and_submit_script_clicks_recorded_point_before_paste() {
    let script = paste_and_submit_to_app_at_point_script("com.openai.codex", 640.0, 720.0);

    assert!(script.contains("tell application id \"com.openai.codex\" to activate"));
    assert!(script.contains("click at {640, 720}"));
    assert!(script.contains("keystroke \"v\" using command down"));
    assert!(script.contains("key code 36"));
}
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri
cargo test paste_and_submit_script_clicks_recorded_point_before_paste --lib
```

Expected: FAIL because `paste_and_submit_to_app_at_point_script` does not exist.

**Step 3: Add a restore-and-submit backend function**

Add:

```rust
pub fn paste_prompt_and_submit_to_app_at_point(
    body: &str,
    bundle_id: &str,
    x: f64,
    y: f64,
) -> Result<(), String> {
    copy_to_clipboard(body)?;
    let script = paste_and_submit_to_app_at_point_script(bundle_id, x, y);
    let output = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(())
}

fn paste_and_submit_to_app_at_point_script(bundle_id: &str, x: f64, y: f64) -> String {
    format!(
        r#"tell application id "{}" to activate
delay 0.2
tell application "System Events"
    click at {{{:.0}, {:.0}}}
    delay 0.12
    keystroke "v" using command down
    delay 0.1
    key code 36
end tell"#,
        bundle_id, x, y
    )
}
```

**Step 4: Route autosend through click-point path**

In `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`, change `paste_prompt_and_submit_to_last_target_impl`:

```rust
fn paste_prompt_and_submit_to_last_target_impl(
    body: &str,
    state: &LastInputTargetState,
) -> Result<(), String> {
    let Some(target) = state.get() else {
        return Err("Click into a text field first, then choose a prompt.".to_string());
    };

    if let Some(point) = target.click_point {
        return platform::macos::paste_prompt_and_submit_to_app_at_point(
            body,
            &target.app.bundle_id,
            point.x,
            point.y,
        );
    }

    platform::macos::paste_prompt_and_submit_to_app(body, &target.app.bundle_id)
}
```

**Step 5: Run Rust tests**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri
cargo test --lib
```

Expected: PASS.

**Step 6: Commit**

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
git add src-tauri/src/platform/macos.rs src-tauri/src/lib.rs
git commit -m "fix: restore input focus before autosend"
```

---

## Task 4: Hide Popover Before Autosend

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/App.tsx`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/app/App.test.tsx`

**Step 1: Write failing frontend test for call order**

Add a test in `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/app/App.test.tsx`:

```ts
it("hides the prompt popover before autosending the selected prompt", async () => {
  const { invoke } = await import("@tauri-apps/api/core");
  vi.mocked(invoke).mockResolvedValue(undefined);
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  (readTextFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
    JSON.stringify({ version: 1, prompts: mockPrompts })
  );

  await act(async () => {
    render(<App />);
  });

  fireEvent.click(await screen.findByText("Test Prompt"));

  await waitFor(() => {
    const calls = vi.mocked(invoke).mock.calls.map((call) => call[0]);
    expect(calls).toContain("hide_prompt_popover");
    expect(calls).toContain("paste_prompt_and_submit_to_last_target");
    expect(calls.indexOf("hide_prompt_popover")).toBeLessThan(
      calls.indexOf("paste_prompt_and_submit_to_last_target")
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
npm test -- src/app/App.test.tsx -t "hides the prompt popover before autosending"
```

Expected: FAIL because current code hides the popover after autosend.

**Step 3: Change selection order**

In `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/App.tsx`, change `handleSelect`:

```ts
await hidePromptPopover();
await pastePromptAndSubmitToLastTarget(prompt.body);
```

Keep the `try/catch/finally` structure and `submittingPromptId` guard unchanged.

**Step 4: Run targeted frontend test**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
npm test -- src/app/App.test.tsx -t "hides the prompt popover before autosending"
```

Expected: PASS.

**Step 5: Run all frontend tests**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
npm test
```

Expected: PASS.

**Step 6: Commit**

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
git add src/App.tsx src/app/App.test.tsx
git commit -m "fix: hide prompt popover before autosend"
```

---

## Task 5: Improve User-Facing Failure Feedback

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/App.tsx`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/app/App.test.tsx`

**Step 1: Write test for clear permission failure**

Add:

```ts
it("shows a clear accessibility permission message before autosend", async () => {
  const { invoke } = await import("@tauri-apps/api/core");
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "accessibility_status_cmd") return { trusted: false };
    return undefined;
  });
  window.alert = vi.fn();
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  (readTextFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
    JSON.stringify({ version: 1, prompts: mockPrompts })
  );

  await act(async () => {
    render(<App />);
  });

  fireEvent.click(await screen.findByText("Test Prompt"));

  await waitFor(() => {
    expect(window.alert).toHaveBeenCalledWith(
      expect.stringContaining("Accessibility permission required")
    );
  });
  expect(vi.mocked(invoke)).not.toHaveBeenCalledWith(
    "paste_prompt_and_submit_to_last_target",
    expect.anything()
  );
});
```

**Step 2: Run test**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
npm test -- src/app/App.test.tsx -t "accessibility permission"
```

Expected: PASS if existing behavior is already correct; otherwise FAIL and fix message.

**Step 3: Add specific target-missing message if needed**

Keep current backend message:

```text
Click into a text field first, then choose a prompt.
```

If the current alert is hidden behind windows in physical testing, do not replace it yet. Add this note to the final verification checklist instead of adding a new UI component.

**Step 4: Commit if files changed**

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
git add src/App.tsx src/app/App.test.tsx
git commit -m "test: cover autosend permission failure"
```

If no files changed, do not commit.

---

## Task 6: Add Regression Tests for Existing Menu Bar Behavior

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/Info.plist`

**Step 1: Confirm existing tests still cover menu-bar app shape**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri
cargo test menu_bar_app_tests --lib
```

Expected: PASS.

**Step 2: Do not add new menu-bar tests unless this fails**

The autosend repair should not affect:

```text
menu bar icon
Open Prompt Picker
Show Calico
Hide Calico
Quit Prompt Picker
LSUIElement=true
```

**Step 3: Commit only if a regression test needed changes**

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
git add src-tauri/src/lib.rs src-tauri/Info.plist
git commit -m "test: preserve menu bar app behavior"
```

If no files changed, do not commit.

---

## Task 7: Full Verification and Rebuild

**Files:**
- No source file changes expected.

**Step 1: Run Rust tests**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri
cargo test --lib
```

Expected: PASS.

**Step 2: Run frontend tests**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
npm test
```

Expected: PASS.

**Step 3: Run frontend production build**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
npm run build
```

Expected: PASS.

**Step 4: Rebuild Tauri app**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
CARGO_BUILD_JOBS=1 npm run tauri -- build
```

Expected:

```text
Finished 2 bundles at:
  /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/target/release/bundle/macos/Prompt Picker.app
  /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/target/release/bundle/dmg/Prompt Picker_1.0.0_aarch64.dmg
```

**Step 5: Verify menu-bar plist survived**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
plutil -p "src-tauri/target/release/bundle/macos/Prompt Picker.app/Contents/Info.plist" | rg "LSUIElement|CFBundleIdentifier|CFBundleName"
```

Expected:

```text
"CFBundleIdentifier" => "local.promptpicker.dev"
"CFBundleName" => "Prompt Picker"
"LSUIElement" => true
```

**Step 6: Optional physical validation**

Only run if the user explicitly approves real interaction testing:

```text
1. Quit existing Prompt Picker from menu bar.
2. Open rebuilt Prompt Picker.app.
3. Click into Codex input box.
4. Click Calico.
5. Click prompt in list.
6. Confirm prompt appears in Codex input and sends.
```

Do not run this physical test automatically because it can send a real Codex message.

**Step 7: Commit any final source changes**

If previous tasks have already committed all source changes, skip this step.

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
git status --short
```

Expected: only generated build output or unrelated pre-existing files are dirty.

---

## Task 8: Push Source Changes

**Files:**
- No source file changes expected.

**Step 1: Inspect branch**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
git status --short
git rev-parse --abbrev-ref --symbolic-full-name @{u}
```

Expected: branch tracks `origin/main`; dirty files are only generated artifacts or unrelated existing files.

**Step 2: Push**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
git push
```

Expected: push succeeds.

**Step 3: Report artifact paths**

Report:

```text
App: /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/target/release/bundle/macos/Prompt Picker.app
DMG: /Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/target/release/bundle/dmg/Prompt Picker_1.0.0_aarch64.dmg
```

---

## Risk Notes

- Coordinate-click fallback is pragmatic, not perfect. It should improve Codex materially, but every macOS app exposes input controls differently.
- Physical validation can send real messages. Do not perform it without explicit user approval.
- Rebuilt ad-hoc signed apps may require macOS Accessibility permission to be re-granted.
- If `System Events click at {x, y}` is blocked by permissions on the user's machine, the next implementation path should use CoreGraphics mouse events from Rust instead of AppleScript clicks.
- If Codex changes its UI layout, the bottom-center fallback may need tuning. Keep the fallback calculation small and testable.

