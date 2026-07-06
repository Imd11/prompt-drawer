# Autosend Target Recovery QA

Date: 2026-07-07
Plan: `docs/plans/2026-07-07-autosend-target-recovery.md`
Review fix plan: `docs/plans/2026-07-07-autosend-target-recovery-verification.md`

## Scope

This record closes the acceptance gap found in the post-implementation review for autosend target recovery.

The implementation goal is:

- Capture the target before opening Prompt Picker UI.
- Preserve pure focus-preserving paste/submit when the original target remains frontmost.
- Recover only when Prompt Picker itself became frontmost.
- Copy only when another non-target app is frontmost.
- Apply the same rule to single prompts and prompt groups.

## Automated Verification

Passed.

Commands run:

```bash
npm test -- src/overlay/overlayHtml.test.ts
cd src-tauri
cargo test --lib
```

Observed results:

- `src/overlay/overlayHtml.test.ts`: 1 test file passed, 23 tests passed.
- `cargo test --lib`: 148 tests passed.

Coverage relevant to this task:

- Overlay click flow captures the prompt target before opening the prompt list.
- `begin_prompt_pick_session` owns session startup before target capture.
- Opening the prompt popover preserves a target already captured for the same session.
- Frontmost target classification distinguishes original target, Prompt Picker, and other/unknown apps.
- Single prompt autosend recovers only when Prompt Picker is frontmost.
- Third-party foreground apps copy only and do not receive paste/submit.
- Prompt groups use the same recovery rule as single prompts.
- macOS pure focus-preserving sender remains free of activation/click logic.
- macOS recovery primitive uses target activation, frontmost wait, and optional recorded click point.

## Build Verification

Passed.

Commands run:

```bash
npm run build
npm run tauri -- build
```

Observed results:

- `npm run build`: TypeScript and Vite production build passed.
- `npm run tauri -- build`: release build passed.
- macOS bundle produced:
  - `src-tauri/target/release/bundle/macos/Prompt Picker.app`
  - `src-tauri/target/release/bundle/dmg/Prompt Picker_1.0.4_aarch64.dmg`
- The build signed the app and dmg with `Developer ID Application: Jinhang Yang (2GWPG8KGW5)`.
- Notarization was skipped by Tauri because the current shell did not provide `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` or `APPLE_API_KEY` / `APPLE_API_ISSUER` / `APPLE_API_KEY_PATH`. This is a build-environment limitation, not an autosend implementation failure.

## Real-App Manual Verification

The following scenarios require real foreground apps and may send text into active user accounts. They must not be marked as passed unless they are actually performed in a safe scratch conversation/input:

| Scenario | Status | Notes |
|---|---|---|
| Codex visible, input not manually focused, choose prompt | Pending user-safe manual test | Requires active Codex UI. |
| Claude input focused once, choose prompt | Pending user-safe manual test | Requires active Claude UI. |
| WeChat chat input focused once, choose prompt | Pending user-safe manual test | Requires safe scratch chat or user confirmation. |
| Start from Codex, switch to third app before selecting prompt | Pending user-safe manual test | Must confirm copy-only/no wrong-target send. |

## Acceptance Notes

Pending.
