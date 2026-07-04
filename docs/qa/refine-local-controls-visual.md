# Local Controls Visual Verification

Date: 2026-07-05

Source commit before this verification: `6737afe`

## Scope

This verification covers the local controls refinement plan for the settings and prompt manager surfaces:

- Settings page custom language dropdown.
- Settings page removal of the hidden apps section.
- Settings page return-to-manager affordance.
- Prompt manager segmented controls and group editor interval unit.
- Small viewport layout behavior.

## Environment

- App: Vite dev server at `http://127.0.0.1:1420/`
- Browser: Google Chrome launched through Playwright
- Viewports:
  - `760x560`
  - `640x460`

## Automated Checks

- `/?mode=settings`
  - `隐藏应用` is absent.
  - No native `select` element is rendered for language selection.
  - The language dropdown opens downward from the trigger.
  - The language dropdown stays inside the viewport.
  - The language dropdown options are not occluded by following cards.
  - There is no horizontal page overflow.

- `/?mode=manager`
  - The group segmented option can be selected and exposes `aria-pressed="true"`.
  - Group interval uses `s` instead of `ms`.
  - There is no horizontal page overflow.

- Manager to settings navigation
  - Opening settings from the manager shows the back button with accessible name `返回管理提示词`.
  - There is no horizontal page overflow.

## Screenshots

- `docs/qa/refine-local-controls-visual/settings-760x560-dropdown.png`
- `docs/qa/refine-local-controls-visual/settings-640x460-dropdown.png`
- `docs/qa/refine-local-controls-visual/manager-760x560-group-editor.png`
- `docs/qa/refine-local-controls-visual/manager-640x460-group-editor.png`
- `docs/qa/refine-local-controls-visual/settings-back-760x560.png`

## Result

Pass. The first visual pass exposed that the custom language dropdown was present but clipped by the settings card at small width. The settings language card now allows the dropdown layer to overflow while preserving the card heading radius, and the Playwright check verifies the dropdown options are not occluded.
