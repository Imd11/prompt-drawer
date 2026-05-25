# Codex App Acceptance Checklist

## Accessibility Permission
- [ ] App reports whether Accessibility permission is granted
- [ ] If not granted, UI shows concise permission-required state

## Button Display
- [ ] With Codex App frontmost, button appears near input panel
- [ ] Button position does not cover critical Codex controls
- [ ] If no detectable input target, fallback mini button appears
- [ ] In blacklisted apps, all overlay UI is hidden

## Popover Interaction
- [ ] Popover opens beside button when button is clicked
- [ ] Prompt title and preview render correctly
- [ ] Prompt click inserts at cursor position
- [ ] No automatic whitespace is added (no spaces/newlines)
- [ ] Popover closes after insert
- [ ] Focus stays in Codex input field

## Prompt Manager
- [ ] Opens from popover footer "Manage Prompts" button
- [ ] Create new prompt with title/body works
- [ ] Edit existing prompt works
- [ ] Delete requires confirmation before removing
- [ ] Move Up/Move Down reorders prompts correctly
- [ ] Import JSON replaces current prompt library
- [ ] Export JSON downloads prompt library file

## Blacklist Settings
- [ ] Blacklisting Codex App hides all overlay UI
- [ ] Removing Codex from blacklist restores overlay UI
- [ ] Settings accessible from menu bar icon

## Fallback Behavior
- [ ] Detection failure fallback mini button can paste to focused input
- [ ] Works in TextEdit and other text input apps

## Build Verification
- [ ] `npm test` passes
- [ ] `npm run tauri build` completes successfully
- [ ] `Prompt Picker.app` bundle exists at `src-tauri/target/release/bundle/macos/`