# Prompt Group Review Fixes

## Goal

Close the reliability, accessibility, and data-preservation gaps found while reviewing the prompt combine/split feature, without changing category management, prompt sending, the quick picker, or unrelated editor behavior.

## Constraints

- Keep the existing selection, combine, and split UX structure.
- Keep deletion of source singles enabled by default.
- Keep the same row actions for single and group containers.
- Do not change the runtime prompt insertion strategy.
- Preserve backward compatibility with existing version 3 prompt libraries.
- Keep failures retryable: do not dismiss dialogs or clear selections after an error.

## Task 1: Make Combine And Split Single-Flight

**Files:**

- `src/ui/PromptManager.tsx`
- `src/shared/i18n.ts`
- `src/ui/PromptManager.test.tsx`

**Implementation:**

1. Add a dedicated in-flight guard for combine/split operations. Use a ref for synchronous duplicate protection and state for rendering.
2. Do not use the existing 250 ms gesture guard for these asynchronous operations.
3. Disable the active dialog's confirmation and cancellation paths while persistence is in flight.
4. Release the guard only in `finally`, after the persistence callback settles.
5. Keep the dialog, selection, title, ordering, and delete-originals choice unchanged when an operation fails.
6. Show a localized inline error with `role="alert"`; retain the console error for diagnostics.

**Tests:**

- Two rapid combine submissions call `onCombineSingles` once.
- The confirmation button remains disabled until the operation settles.
- A rejected combine remains open and shows a localized error.
- A rejected split remains open and shows a localized error.

## Task 2: Make Execution Order Accessible

**Files:**

- `src/ui/PromptManager.tsx`
- `src/shared/i18n.ts`
- `src/styles.css`
- `src/ui/PromptManager.test.tsx`

**Implementation:**

1. Retain drag-and-drop for pointer users.
2. Add compact move-up and move-down icon buttons to every selected item.
3. Disable move-up for the first item and move-down for the last item.
4. Add localized accessible labels containing the prompt title.
5. Keep removal as a compact icon action and avoid adding another text toolbar.

**Tests:**

- Moving an item with the compact controls changes the ID order sent to `onCombineSingles`.
- Boundary buttons are disabled correctly.
- The retain-originals checkbox sends `deleteOriginals: false` when unchecked.

## Task 3: Preserve Legacy Per-Container Metadata Through A Round Trip

**Files:**

- `src/shared/promptTypes.ts`
- `src/shared/promptStore.ts`
- `src/ui/PromptManager.tsx`
- `src/shared/promptStore.test.ts`

**Implementation:**

1. Add optional `sendBehavior` metadata to `PromptEntry` and prompt-entry inputs.
2. Preserve that optional field during normalization, serialization, and group editing.
3. When combining singles, store each source container's legacy behavior on its group entry.
4. Keep the group's effective behavior unchanged: use the common behavior when all sources match, otherwise use `inherit`.
5. When splitting, restore each entry's preserved behavior; legacy groups without entry metadata continue using the group's behavior.
6. Do not expose new settings or change current runtime sending, which already uses the global setting.

**Tests:**

- Combine prompts with different legacy behaviors, split the result, and verify title, body, order, and behavior are restored.
- Existing groups without entry-level metadata still split correctly.

## Task 4: Strengthen Contract Tests

**Files:**

- `src/ui/PromptManager.test.tsx`
- `src/shared/promptStore.test.ts`

**Implementation:**

1. Replace the row-action button-count assertion with explicit assertions for the shared standard actions and each row's overflow menu.
2. Cover keep-originals, reordered merge input, async duplicate protection, and visible failure handling.
3. Add a complete combine-to-split store round trip.

## Verification

Run in this order:

1. `npm test -- --run src/ui/PromptManager.test.tsx src/shared/promptStore.test.ts`
2. `npm test -- --reporter=dot`
3. `npm run build`
4. `git diff --check`
5. Inspect `git diff` to confirm no quick-picker, category, autosend, Tauri, release, or generated build files changed.

## Acceptance Criteria

- Combine and split cannot be submitted twice while a previous request is pending.
- Persistence failures are visible and retryable.
- Merge order works with both pointer drag and compact buttons.
- Keeping originals remains optional and deletion remains the default.
- Combine then split restores source titles, bodies, order, and legacy metadata.
- Single and group rows retain the same standard action structure.
- Focused tests, all tests, and the production build pass.
