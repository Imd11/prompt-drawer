# Codex App Acceptance Checklist

## Accessibility Permission
- [ ] App reports whether Accessibility permission is granted
- [ ] If not granted, UI shows concise permission-required state

## Button Display
- [ ] After clicking into a text field, the blue `Prompts` button appears near that input area
- [ ] Button position does not cover critical Codex controls
- [ ] If no detectable input target, fallback mini button appears
- [ ] In blacklisted apps, all overlay UI is hidden
- [ ] Dragging the blue `Prompts` button moves it and the saved offset is reused

## Popover Interaction
- [ ] Popover opens beside button when button is clicked
- [ ] Prompt title and preview render correctly
- [ ] Prompt click reactivates the last recorded target app and inserts at the cursor position
- [ ] No automatic whitespace is added (no spaces/newlines)
- [ ] Popover closes after insert
- [ ] If no previous text field was recorded, the app shows "Click into a text field first, then choose a prompt."

## Prompt Manager
- [ ] Opens from the main app window "Manage Prompts" button
- [ ] Create new prompt with title/body works
- [ ] Edit existing prompt works
- [ ] Delete requires confirmation before removing
- [ ] Move Up/Move Down reorders prompts correctly
- [ ] Import JSON defaults to replacing the internal prompt library copy
- [ ] Import JSON can optionally link and sync the selected external file
- [ ] Linked prompt library status shows the file name, Sync now, and Unlink actions
- [ ] In-app edits write through to a linked JSON file
- [ ] External file conflicts keep the active edit form open instead of discarding the draft
- [ ] Unlink keeps the current internal prompt library and does not delete the external JSON file
- [ ] Export JSON downloads prompt library file

## Blacklist Settings
- [ ] Blacklisting Codex App hides all overlay UI
- [ ] Removing Codex from blacklist restores overlay UI
- [ ] Settings accessible from menu bar icon

## Fallback Behavior
- [ ] Detection failure does not silently paste into the wrong application
- [ ] Works in TextEdit and other text input apps

## Build Verification
- [ ] `npm test` passes
- [ ] `cargo test --lib` passes
- [ ] `npm run tauri build` completes successfully
- [ ] `Prompt Picker.app` bundle exists at `src-tauri/target/release/bundle/macos/`
