# Focus-Preserving Autosend Review Fixes QA

Date: 2026-07-07

Scope:

- Focus-preserving Calico prompt selection.
- Guarded paste/submit into the originally frontmost target app.
- Generic AX repair fallback.
- Removal of legacy public activating paste entrypoints.

## Automated Verification

These checks were run during the review-fix pass:

```bash
cargo test --manifest-path src-tauri/Cargo.toml legacy_activating --lib
```

Result: passed, 2 tests.

```bash
cargo test --manifest-path src-tauri/Cargo.toml ax_repair --lib
```

Result: passed, 2 tests.

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Result: passed, 139 tests.

```bash
npm run build
```

Result: passed.

Full `npm test` is part of final verification for this fix pass.

## Manual Acceptance Matrix

Manual acceptance depends on live macOS app focus behavior and must be confirmed on the user's device with the real target apps. This session did not fabricate a pass result for apps it could not truthfully operate end to end.

| App | Manual status | Steps | Expected |
|---|---|---|---|
| WeChat | Pending user/device confirmation | Click into a chat input, click Calico, choose a prompt. Test both `只填入` and `填入 + Enter`. | Prompt inserts quickly into the focused WeChat input. Enter behavior follows the prompt setting. No "Switch to an input field first" warning in the normal focused-input path. |
| Claude desktop | Pending user/device confirmation | Click into Claude input, click Calico, choose a prompt. Test both `只填入` and `填入 + Enter`. | Prompt inserts quickly. The app should not show a prolonged spinning cursor or feel blocked. |
| Codex desktop | Pending user/device confirmation | Use normal Codex prompt flow, click Calico, choose a prompt. | Existing easy path still works. Prompt behavior follows per-prompt send setting. |
| Notes or browser textarea | Pending user/device confirmation | Click into a note/textarea, click Calico, choose a prompt. Test paste-only and paste+Enter. | Paste-only inserts without submit. Paste+Enter inserts then sends/newlines according to target app behavior. |

## Manual Pass Criteria

For each app above:

- The target input is focused before clicking Calico.
- The prompt popover can be clicked without making Prompt Picker the key app.
- Text appears in the original target input promptly.
- `只填入` does not press Enter.
- `填入 + Enter` presses Enter only after paste.
- If the target app changes before paste, Prompt Picker copies only and shows `已复制，请手动粘贴`.
- If the target app changes after paste but before submit, Prompt Picker does not press Enter.

## Notes

- The core behavior is covered by unit tests, but macOS focus ownership across third-party apps still requires real-device acceptance.
- The current implementation intentionally has no WeChat/Claude app-specific autosend recipe.
