# Dropdown and Segmented Control QA

Date: 2026-07-05

## Commands

- `npm test -- src/ui/SegmentedControlStyles.test.ts src/ui/SettingsPanel.test.tsx src/ui/PromptManager.test.tsx`
- `npm test`
- `npx tsc --noEmit`
- `npx vite build --outDir /tmp/prompt-picker-dropdown-segmented-final-build --emptyOutDir`

## Browser Checks

Verified with Playwright and Google Chrome at:

- Settings: `1520x1118`, `760x560`, `640x460`
- Prompt manager: `1520x1118`, `760x560`, `640x460`

Assertions checked:

- Settings language dropdown is visible and not occluded.
- Settings language dropdown escapes the language card boundary.
- Selected segmented button text is white on the dark selected thumb.
- Selected segmented buttons are not vertically clipped.
- No horizontal page overflow.

## Screenshots

- `docs/qa/dropdown-segmented-control-fix/settings-1520x1118-dropdown.png`
- `docs/qa/dropdown-segmented-control-fix/settings-760x560-dropdown.png`
- `docs/qa/dropdown-segmented-control-fix/settings-640x460-dropdown.png`
- `docs/qa/dropdown-segmented-control-fix/manager-1520x1118-segmented.png`
- `docs/qa/dropdown-segmented-control-fix/manager-760x560-segmented.png`
- `docs/qa/dropdown-segmented-control-fix/manager-640x460-segmented.png`
