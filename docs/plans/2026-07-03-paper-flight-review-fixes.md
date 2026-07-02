# Paper Flight Review Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the two review issues in the Calico paper-plane flight implementation without changing autosend behavior.

**Architecture:** Keep the animation as a visual-only layer. Give the temporary paper flight window the smallest capability it needs to close itself, and create the full-screen flight window in a hidden, non-focused, non-focusable state before showing it after native panel configuration.

**Tech Stack:** Tauri v2 capabilities, Rust window commands, Vitest static tests, Cargo tests.

---

## Non-Goals

- Do not change prompt selection or autosend backend logic.
- Do not change the Calico sprite assets or animation timing.
- Do not add new UI, settings, or permissions.

## Task 1: Add Minimal Capability For Paper Flight Window

**Files:**
- Create: `src-tauri/capabilities/paper-flight.json`
- Modify: `src/overlay/overlayHtml.test.ts`

**Step 1: Add failing static test**

Add a test that reads `src-tauri/capabilities/paper-flight.json` and verifies:

```ts
expect(capability.windows).toContain("paper-plane-flight");
expect(capability.permissions).toEqual(["core:default"]);
```

Run:

```bash
npm test -- src/overlay/overlayHtml.test.ts
```

Expected: FAIL because the capability file does not exist.

**Step 2: Create minimal capability**

Create `src-tauri/capabilities/paper-flight.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2/capability",
  "identifier": "paper-flight",
  "description": "Minimal capability for the temporary paper-plane flight window",
  "windows": ["paper-plane-flight"],
  "permissions": ["core:default"]
}
```

**Step 3: Run test**

Run:

```bash
npm test -- src/overlay/overlayHtml.test.ts
```

Expected: PASS.

## Task 2: Create Flight Window Hidden And Non-Focusable Before Showing

**Files:**
- Modify: `src-tauri/src/windows.rs`

**Step 1: Add failing static test**

Add a test near `paper_flight_window_has_backend_close_fallback` that reads `windows.rs` and verifies the builder chain contains:

```rust
".visible(false)"
".focused(false)"
".focusable(false)"
".show().map_err"
```

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml paper_flight_window
```

Expected: FAIL until the builder chain is updated.

**Step 2: Update builder chain**

In `show_paper_plane_flight_from_button`, add these builder calls before `.build()`:

```rust
.visible(false)
.focused(false)
.focusable(false)
```

After:

```rust
configure_transparent_webview_window
configure_non_activating_panel
configure_ignores_mouse_events(true)
```

call:

```rust
window.show().map_err(|e| e.to_string())?;
```

This keeps the full-screen transparent window from appearing or focusing until after native configuration is applied.

**Step 3: Run Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml paper_flight_window
```

Expected: PASS.

## Task 3: Full Verification And Commit

**Files:**
- No additional code changes unless tests fail.

**Step 1: Run targeted verification**

```bash
npm test -- src/overlay/overlayHtml.test.ts
cargo test --manifest-path src-tauri/Cargo.toml paper_flight
```

Expected: PASS.

**Step 2: Run broader verification**

```bash
npm test -- src/app/App.test.tsx src/overlay/overlayHtml.test.ts
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

**Step 3: Commit**

```bash
git add docs/plans/2026-07-03-paper-flight-review-fixes.md src-tauri/capabilities/paper-flight.json src/overlay/overlayHtml.test.ts src-tauri/src/windows.rs
git commit -m "fix: harden paper flight window"
```
