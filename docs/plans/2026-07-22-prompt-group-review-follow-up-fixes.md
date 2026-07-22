# Prompt Group Review Follow-up Fixes

## Goal

Resolve the remaining consistency, retryability, and accessibility issues found after the first prompt-group repair, without changing the quick picker, prompt insertion behavior, category semantics, Tauri code, or release configuration.

## Constraints

- A successful storage write must never be presented as a retryable mutation failure.
- A pending combine or split must not allow its dialog state to be changed or dismissed.
- Only one group mutation may be active at a time.
- Existing pointer drag ordering, row actions, source-retention behavior, and legacy library compatibility must remain unchanged.
- Keep all changes within the prompt manager, prompt store, App integration, localization, styles, and their tests.

## Task 1: Return An Authoritative Snapshot From Group Mutations

**Files:**

- `src/shared/promptStore.ts`
- `src/shared/promptStore.test.ts`
- `src/App.tsx`
- `src/app/App.test.tsx`

**Implementation:**

1. Define an exported normalized prompt-library snapshot type.
2. Make the internal `save` helper return the exact normalized snapshot written to storage.
3. Change `combineSingles` and `splitGroup` to return both their affected containers and that committed snapshot.
4. In `App`, apply the returned snapshot directly after a successful group mutation instead of performing a second storage read.
5. Keep storage-write failures rejecting normally so the dialog remains visible and retryable.

**Tests:**

- A combine result contains the committed category/container snapshot.
- A split result contains the committed category/container snapshot.
- App combine/split callbacks do not require a post-commit prompt-library read.

## Task 2: Freeze Group Dialogs During Persistence

**Files:**

- `src/ui/PromptManager.tsx`
- `src/ui/PromptManager.test.tsx`

**Implementation:**

1. Derive one `groupActionBusy` flag from any pending group operation.
2. While busy, disable the merge title, ordering controls, remove controls, source-retention checkbox, confirmation, and cancellation controls.
3. Disable dragging while busy and ignore drag/drop callbacks that arrive after submission.
4. Keep the active dialog mounted until the callback settles.
5. Prevent opening or submitting another group operation while the shared guard is active.

**Tests:**

- Every merge state-changing control is disabled while combine persistence is pending.
- Removing items cannot dismiss the pending dialog.
- Split confirmation and cancellation remain disabled until persistence settles.

## Task 3: Complete Accessible Action Feedback

**Files:**

- `src/ui/PromptManager.tsx`
- `src/shared/i18n.ts`
- `src/styles.css`
- `src/ui/PromptManager.test.tsx`

**Implementation:**

1. Add localized accessible names to the standard row move-up and move-down actions.
2. Give compact merge ordering controls a clearly visible `:focus-visible` outline without changing pointer hover styling.
3. Preserve the same four standard row actions for both singles and groups.

**Tests:**

- Single and group rows expose move-up, move-down, edit, and overflow actions.
- First merge item move-up and final merge item move-down are disabled.

## Task 4: Complete Legacy Metadata Coverage

**Files:**

- `src/shared/promptStore.test.ts`

**Implementation:**

1. Create a legacy-style group with a non-default container `sendBehavior` and no entry-level behavior metadata.
2. Split it and assert every generated single inherits the group behavior.
3. Keep the existing mixed-behavior round-trip test.

## Verification

Run in this order:

1. `npm test -- --run src/ui/PromptManager.test.tsx src/shared/promptStore.test.ts src/app/App.test.tsx`
2. `npm test -- --reporter=dot`
3. `npm run build`
4. `git diff --check`
5. Inspect the final diff and confirm no quick-picker, autosend, Tauri, category behavior, release, or generated build files changed.

## Acceptance Criteria

- A committed combine/split is never executed again because a later refresh failed.
- Failed storage writes keep the relevant dialog and all user choices intact.
- Pending dialogs cannot be dismissed or mutated through any remaining control.
- Group operations remain single-flight across both dialogs.
- Pointer drag and keyboard ordering both remain available when idle.
- Keyboard focus is visibly identifiable.
- Legacy group behavior survives splitting when entry metadata is absent.
- Focused tests, full tests, production build, and diff checks pass.
