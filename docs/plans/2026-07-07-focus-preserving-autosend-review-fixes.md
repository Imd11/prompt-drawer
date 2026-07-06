# Focus-Preserving Autosend Review Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the review gaps in the focus-preserving autosend pass without changing the approved main UX.

**Architecture:** Keep the current L1/L2 focus-preserving autosend path intact. Tighten only the exposed legacy activation surface, make AX repair more selective and generic, and add an explicit QA record so manual acceptance status is visible instead of implicit.

**Tech Stack:** Tauri 2, Rust, AppleScript/System Events AX fallback, React/TypeScript, Vitest, Cargo unit tests.

---

### Task 1: Remove Public Legacy Activating Paste Entrypoints

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/lib.rs`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/platform/macos.rs`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/platform/unsupported.rs`
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src/platform/platformApi.ts`

**Step 1: Add failing guard tests**

In `src-tauri/src/lib.rs`, add a source-level test that proves the Tauri invoke handler no longer exposes:

```rust
paste_prompt_to_app,
paste_prompt_to_last_target,
```

In `src-tauri/src/platform/macos.rs`, update the legacy activation tests so they no longer require `paste_to_app_script`.

**Step 2: Run the focused tests and confirm failure**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml legacy_activating --lib
```

Expected: FAIL before removing the exposed commands.

**Step 3: Remove the command/API surface**

Remove from `src-tauri/src/lib.rs`:

- `paste_prompt_to_app`
- `paste_prompt_to_last_target`
- `paste_prompt_to_last_target_impl`
- the invoke-handler entries for those commands
- tests that only cover the removed plain activating route

Remove from `src/platform/platformApi.ts`:

- `pastePromptToLastTarget`
- `pastePromptToApp`

Remove unused activating paste helper from `src-tauri/src/platform/macos.rs`:

- `paste_prompt_to_app_with_copier`
- `paste_to_app_script`
- tests that assert target activation before paste

Remove the matching unsupported-platform helper from `src-tauri/src/platform/unsupported.rs`.

Do not remove the current guarded commands:

- `paste_prompt_and_submit_to_last_target`
- `paste_prompt_sequence_and_submit_to_last_target`

**Step 4: Run focused verification**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml legacy_activating --lib
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run build
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/platform/macos.rs src-tauri/src/platform/unsupported.rs src/platform/platformApi.ts
git commit -m "fix: remove legacy activating paste entrypoints"
```

---

### Task 2: Make AX Repair Select Editable Candidates Instead Of First Match

**Files:**
- Modify: `/Users/yang/Desktop/GitHub-pre/prompt-picker/src-tauri/src/platform/macos.rs`

**Step 1: Add failing AX script tests**

In `src-tauri/src/platform/macos.rs`, strengthen `ax_repair_script_uses_generic_editable_roles_without_app_recipes` or add new tests asserting:

- current focused element is only accepted after checking its role;
- candidate scoring uses `bestScore` and `bestElem`;
- `AXSearchField` is down-ranked;
- size and lower-window placement contribute to the score;
- no app-specific strings such as `WeChat`, `Claude`, or `Codex` are present.

**Step 2: Run focused test and confirm failure**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml ax_repair --lib
```

Expected: FAIL before the script is improved.

**Step 3: Improve the generic System Events AX script**

Update `repair_focus_to_editable_element_script(pid)` so it:

- reads `AXFocusedUIElement`;
- checks the focused element role before focusing it;
- scans `entire contents of frontWin` for editable roles;
- scores candidates generically:
  - `AXTextArea` highest;
  - `AXTextField` and `AXComboBox` normal;
  - `AXSearchField` lower;
  - larger/multiline fields higher;
  - fields in the lower half of the window higher;
- focuses only the best candidate;
- returns an error if no editable candidate exists.

Keep this as fallback-only. Do not introduce app-specific recipes.

**Step 4: Run focused verification**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml ax_repair --lib
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src-tauri/src/platform/macos.rs
git commit -m "fix: score generic AX focus repair candidates"
```

---

### Task 3: Record Manual Acceptance Status Honestly

**Files:**
- Create: `/Users/yang/Desktop/GitHub-pre/prompt-picker/docs/qa/2026-07-07-focus-preserving-autosend-review-fixes.md`

**Step 1: Create a QA record**

Create a QA note with:

- automated verification commands and results;
- manual acceptance matrix from the original plan;
- a clear status for each app:
  - `Pending user/device confirmation` when the current session cannot truthfully verify that app;
  - no fabricated pass result.

**Step 2: Add exact manual steps**

For each target app, include:

- click into input field;
- click Calico;
- choose prompt;
- expected paste/submit behavior;
- expected absence of the “Switch to an input field first” warning in the normal focused-input path.

**Step 3: Commit**

```bash
git add docs/qa/2026-07-07-focus-preserving-autosend-review-fixes.md
git commit -m "docs: record focus autosend QA status"
```

---

### Task 4: Full Verification

**Files:**
- No source changes expected.

**Step 1: Run Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Expected: PASS.

**Step 2: Run frontend tests**

Run:

```bash
npm test
```

Expected: PASS.

**Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

**Step 4: Check no exposed legacy activation command remains**

Run:

```bash
rg -n "pastePromptToLastTarget|pastePromptToApp|paste_prompt_to_last_target|paste_prompt_to_app|paste_to_app_script" src src-tauri/src
```

Expected: no matches except historical plan docs if searching outside `src` and `src-tauri/src`.

**Step 5: Check git status**

Run:

```bash
git status --short
```

Expected: only known unrelated build artifacts remain outside this task.

**Step 6: Commit/push if needed**

If all verification passes and commits are local on `main`, push:

```bash
git push origin main
```
