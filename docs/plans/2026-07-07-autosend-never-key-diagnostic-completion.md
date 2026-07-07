# Autosend Never-Key Diagnostic Completion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the remaining autosend never-key review finding by completing the real diagnostic matrix, or by preserving a truthful blocked status if the matrix cannot be run safely.

**Architecture:** Do not change autosend behavior unless diagnostics produce concrete trigger evidence. The fix is primarily QA completion: run the same diagnostic path against Codex, Claude, WeChat, and focus-break safety with a paste-only diagnostic prompt. Only update acceptance to PASS when all rows have real evidence.

**Tech Stack:** Tauri 2, macOS Accessibility, Prompt Picker diagnostics, Git, Markdown QA records.

---

## Non-Negotiable Rules

- Do not fake a PASS for Codex, Claude, WeChat, or focus-break safety.
- Do not send text into live third-party chats or AI sessions.
- Use a paste-only diagnostic prompt so successful autosend inserts text but does not submit.
- Back up and restore the user's `local.promptpicker.dev` app config before and after testing.
- Do not modify Tao/Wry guard behavior unless diagnostics show one of the Task 4 trigger conditions from the previous plan.
- Do not make source changes for a pure QA tooling limitation.

---

### Task 1: Reconfirm Current Review Gap

**Files:**
- Read: `/Users/yang/Desktop/GitHub-pre/prompt-picker/docs/qa/2026-07-07-autosend-never-key-recovery.md`
- Read: `/Users/yang/Desktop/GitHub-pre/prompt-picker/docs/plans/2026-07-07-autosend-never-key-review-fixes.md`

**Step 1: Inspect QA status**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
sed -n '61,92p' docs/qa/2026-07-07-autosend-never-key-recovery.md
```

Expected: QA still says manual diagnostic matrix is `FAIL / NOT READY`.

**Step 2: Inspect required matrix criteria**

Run:

```bash
sed -n '224,352p' docs/plans/2026-07-07-autosend-never-key-review-fixes.md
```

Expected: plan requires Codex, Claude, WeChat, and focus-break safety rows before acceptance.

**Step 3: Commit**

No commit for this task.

---

### Task 2: Prepare A Safe Diagnostic App State

**Files:**
- Read/write only app data under: `/Users/yang/Library/Application Support/local.promptpicker.dev`

**Step 1: Create a timestamped backup**

Run:

```bash
APP_DIR="$HOME/Library/Application Support/local.promptpicker.dev"
BACKUP_DIR="$APP_DIR/diagnostic-backup-$(date +%Y%m%d%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp "$APP_DIR/settings.json" "$BACKUP_DIR/settings.json"
cp "$APP_DIR/prompts.json" "$BACKUP_DIR/prompts.json"
printf '%s\n' "$BACKUP_DIR"
```

Expected: command prints the backup directory path.

**Step 2: Install paste-only diagnostic config**

Replace the app config with:

```json
{
  "promptInsertion": {
    "mode": "paste_only"
  },
  "floatingButton": {
    "visible": true
  }
}
```

Replace the prompt library with one category and one prompt:

```json
{
  "categories": [
    {
      "id": "diagnostic",
      "name": "Diagnostic",
      "createdAt": "2026-07-07T00:00:00.000Z",
      "updatedAt": "2026-07-07T00:00:00.000Z"
    }
  ],
  "prompts": [
    {
      "id": "diagnostic-test",
      "categoryId": "diagnostic",
      "title": "Diagnostic Test",
      "type": "single",
      "body": "PROMPT_PICKER_DIAGNOSTIC_TEST",
      "sendBehavior": "paste_only"
    }
  ]
}
```

**Step 3: Restore config on every exit path**

Before ending the task or if testing is blocked, run:

```bash
cp "$BACKUP_DIR/settings.json" "$APP_DIR/settings.json"
cp "$BACKUP_DIR/prompts.json" "$APP_DIR/prompts.json"
```

Expected: user's original app data is restored.

**Step 4: Commit**

No commit for this task because it changes only app data.

---

### Task 3: Run The Diagnostic Matrix

**Files:**
- Modify only if real results change: `/Users/yang/Desktop/GitHub-pre/prompt-picker/docs/qa/2026-07-07-autosend-never-key-recovery.md`

**Step 1: Start Prompt Picker diagnostics**

Run:

```bash
cd /Users/yang/Desktop/GitHub-pre/prompt-picker
PROMPT_PICKER_FOCUS_DIAGNOSTICS=1 npm run tauri -- dev
```

Expected: app starts and prints `prompt-picker-panel` diagnostics when the pet or popover opens.

**Step 2: Run Codex row only if safe tooling can operate Codex**

Required row fields:

```text
prompt-button key?
prompt-popover key?
classification
recovery used
outcome
notes
```

If the available automation refuses `com.openai.codex`, record `NOT RUN` and do not claim pass.

**Step 3: Run Claude row**

Focus a Claude input, click the pet, select the diagnostic prompt, and verify:

- inserted text is `PROMPT_PICKER_DIAGNOSTIC_TEST`;
- no submit occurs;
- diagnostics record popover key behavior and autosend classification.

If prompt row selection cannot be triggered by automation, record `NOT OBSERVED` and do not claim pass.

**Step 4: Run WeChat row only in a safe scratch chat**

Focus a safe WeChat input, click the pet, select the diagnostic prompt, and verify:

- inserted text is `PROMPT_PICKER_DIAGNOSTIC_TEST`;
- no submit occurs;
- diagnostics record popover key behavior and autosend classification.

If there is no safe scratch chat or prompt row selection cannot be triggered, record `NOT RUN`.

**Step 5: Run focus-break safety**

Focus a safe input, open the pet popover, switch to another app, select the diagnostic prompt, and verify no wrong-app send occurs.

If prompt row selection cannot be triggered, record `NOT RUN`.

**Step 6: Decide Task 4**

Execute the Tao/Wry guard fix only if any diagnostic row shows:

- `can_become_key=true` for prompt overlays;
- Prompt Picker becomes frontmost during normal prompt selection;
- autosend enters recovery because the overlay stole focus.

Skip Task 4 only if all normal rows pass with classification `Target`, no recovery, and successful paste-only insertion.

**Step 7: Stop diagnostics and restore config**

Stop the dev server and restore app data from Task 2.

**Step 8: Commit QA updates only if evidence changed**

```bash
git add docs/qa/2026-07-07-autosend-never-key-recovery.md
git commit -m "docs: complete autosend never-key diagnostic matrix"
```

---

### Task 4: Final Verification And Push

**Files:**
- No source changes expected.

**Step 1: Run source verification if any code changed**

If source changed, run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm test
npm run build
```

Expected: all pass.

**Step 2: Inspect status**

Run:

```bash
git status --short --branch
git log --oneline --decorate -5
```

Expected: no task source/QA files are left uncommitted. Existing build artifacts may remain dirty and must not be staged.

**Step 3: Push if a commit was created**

Run:

```bash
git push origin main
```

Expected: push succeeds.

**Step 4: Report final acceptance state**

Report one of:

- `PASS`: all four diagnostic rows passed and QA says acceptance recommendation is PASS.
- `NEEDS FIX`: diagnostics ran but found a real app behavior problem.
- `BLOCKED`: diagnostics could not be safely or reliably executed by the available automation.
