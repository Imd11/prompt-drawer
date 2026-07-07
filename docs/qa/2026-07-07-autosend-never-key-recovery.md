# Autosend Never-Key Recovery QA

Date: 2026-07-07

## Scope

This QA covers the autosend focus preservation work from
`docs/plans/2026-07-07-autosend-never-key-recovery.md`.

The verified changes are:

- Prompt button and prompt popover windows are created hidden and non-focusable before their first non-activating show path.
- Autosend focus diagnostics are available behind `PROMPT_PICKER_FOCUS_DIAGNOSTICS`.
- Recovery click points are selected with generic rules instead of Codex-specific fallback logic.
- Existing safety behavior is retained: when the target cannot be restored, the app copies only and does not send.

## Automated Verification

Passed:

- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml recovery_click_point --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml fallback_click_point --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml last_input_target --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml autosend --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml macos_panels --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml windows --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`
- `npm test`
- `npm run build`
- `git diff --check -- src-tauri/src/lib.rs src-tauri/src/platform/macos.rs src-tauri/src/platform/mod.rs src-tauri/src/platform/unsupported.rs`

Automated result summary:

- Rust lib tests: 166 passed.
- Vitest files: 23 passed.
- Vitest tests: 284 passed.
- Frontend production build completed successfully.

## Source Checks

Passed:

- No `allows_fallback_click_point` function remains.
- No legacy `paste_prompt_to_app`, `paste_prompt_to_last_target`, `pastePromptToApp`, `pastePromptToLastTarget`, or `paste_to_app_script` references were found in `src` or `src-tauri/src`.
- Codex bundle-id references remain only in unit tests and script fixtures, not in production fallback selection logic.

## Manual Verification Still Needed

The following require real app interaction and were not claimed as passed by automation:

- Codex: click the pet, select a prompt, confirm it pastes and submits without falling back to manual paste.
- Claude: click the pet, select a prompt, confirm it pastes and submits when the input remains focused.
- WeChat: click the pet, select a prompt, confirm it pastes and submits when the input remains focused.
- Focus break safety: click the pet, deliberately switch to another app before selecting a prompt, confirm Prompt Picker copies only and does not send to the wrong app.
- Optional diagnostics: run with `PROMPT_PICKER_FOCUS_DIAGNOSTICS=1` and confirm the prompt button/popover reports non-key behavior while opening.

## Notes

The Tao/Wry class guard was not removed. The plan made this conditional on diagnostics proving the runtime-managed window class still steals focus after the show-ordering fix. No such diagnostic evidence was produced during automated verification.
