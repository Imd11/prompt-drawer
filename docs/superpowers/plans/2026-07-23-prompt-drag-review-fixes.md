# Prompt Drag Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make prompt-container dragging exclude all row controls, report persistence failures, and add regression coverage without changing existing prompt behavior.

**Architecture:** Keep Motion `Reorder.Group` as the ordering engine and the existing store `reorder` method as the persistence boundary. Replace automatic whole-row drag listening with per-row `useDragControls`, starting drag only from non-interactive content. Keep optimistic ordering, but restore the previous order and show a localized inline error when persistence fails.

**Tech Stack:** React 19, TypeScript, Motion React, Vitest, Testing Library, CSS.

---

## File Structure

- Modify `src/ui/PromptManager.tsx`: controlled Motion row wrapper and reorder failure state.
- Modify `src/shared/i18n.ts`: Chinese and English reorder failure messages.
- Modify `src/styles.css`: compact reorder error styling.
- Modify `src/ui/PromptManager.test.tsx`: persistence rollback coverage.
- Create `src/ui/PromptManagerDrag.test.tsx`: controlled drag-start coverage.

### Task 1: Isolate row controls from Motion dragging

**Files:**
- Modify: `src/ui/PromptManager.tsx:1-180`
- Modify: `src/ui/PromptManager.tsx:787-1062`
- Create: `src/ui/PromptManagerDrag.test.tsx`

- [x] **Step 1: Write the failing controlled-drag test**

Mock `motion/react` so `useDragControls().start` is observable. Render two prompts, fire `pointerDown` on prompt copy, and expect one `start` call. Fire `pointerDown` on Edit and More buttons and expect no additional calls.

```tsx
const motionMocks = vi.hoisted(() => ({ start: vi.fn() }));

vi.mock("motion/react", () => ({
  useDragControls: () => ({ start: motionMocks.start }),
  Reorder: {
    Group: MockReorderGroup,
    Item: MockReorderItem,
  },
}));
```

- [x] **Step 2: Run the test and verify it fails**

```bash
npx vitest run src/ui/PromptManagerDrag.test.tsx
```

Expected: FAIL because the current component does not call `useDragControls().start`.

- [x] **Step 3: Add a controlled reorder row**

Import `useDragControls`, `ReactNode`, and React `PointerEvent`. Add a wrapper that always sets `dragListener={false}` and starts Motion only when the target is not a button, link, form field, editable element, or menu item.

```tsx
function isInteractivePromptTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    "button, a, input, textarea, select, [contenteditable='true'], [role='menuitem']"
  ));
}

function PromptReorderRow(props: PromptReorderRowProps) {
  const dragControls = useDragControls();
  return (
    <Reorder.Item
      dragListener={false}
      dragControls={dragControls}
      onPointerDown={(event) => {
        if (props.enabled && !isInteractivePromptTarget(event.target)) {
          dragControls.start(event);
        }
      }}
    >
      {props.children}
    </Reorder.Item>
  );
}
```

Replace the inline `Reorder.Item` with `PromptReorderRow`. Remove the ineffective `onPointerDown(stopPropagation)` from `.prompt-actions`; leave all button callbacks unchanged.

- [x] **Step 4: Run controlled-drag tests**

```bash
npx vitest run src/ui/PromptManagerDrag.test.tsx src/ui/PromptManager.test.tsx
```

Expected: PASS; content starts controlled dragging and action buttons do not.

### Task 2: Report and recover from persistence failures

**Files:**
- Modify: `src/shared/i18n.ts:50-105`
- Modify: `src/shared/i18n.ts:185-240`
- Modify: `src/ui/PromptManager.tsx:220-280`
- Modify: `src/ui/PromptManager.tsx:429-448`
- Modify: `src/ui/PromptManager.tsx:786-801`
- Modify: `src/styles.css:1392-1450`
- Modify: `src/ui/PromptManager.test.tsx:760-775`

- [x] **Step 1: Write the failing persistence test**

Render with a rejecting `onReorder`, click the first Down button, and assert that the old order is restored and an alert contains the localized failure message.

```tsx
it("restores the previous order and reports reorder persistence failures", async () => {
  renderManager({ onReorder: async () => { throw new Error("write failed"); } });
  fireEvent.click(screen.getByRole("button", { name: "下移 Code Review" }));
  expect((await screen.findByRole("alert")).textContent).toContain("排序保存失败");
  await waitFor(() => {
    expect(screen.getAllByRole("listitem")[0].textContent).toContain("Code Review");
  });
});
```

- [x] **Step 2: Run the test and verify it fails**

```bash
npx vitest run src/ui/PromptManager.test.tsx -t "reorder persistence failures"
```

Expected: FAIL because no reorder error is rendered.

- [x] **Step 3: Add localized feedback and rollback state**

Add these messages:

```ts
reorderFailed: "排序保存失败，已恢复原顺序。"
reorderFailed: "Could not save the new order. The previous order was restored."
```

Add `reorderError` state. Clear it before persistence and on category change. In `persistPromptOrder`'s catch, retain rollback and set `messages.manager.reorderFailed`. Render a `role="alert"` block immediately before the list and style it with existing danger colors.

- [x] **Step 4: Run persistence tests**

```bash
npx vitest run src/ui/PromptManager.test.tsx
```

Expected: PASS, including rollback and localized alert.

### Task 3: Verify scope and regressions

**Files:**
- Test: `src/ui/PromptManagerDrag.test.tsx`
- Test: `src/ui/PromptManager.test.tsx`
- Test: `src/ui/PromptManagerLayoutStyles.test.ts`

- [x] **Step 1: Run focused tests**

```bash
npm test -- src/ui/PromptManagerDrag.test.tsx src/ui/PromptManager.test.tsx src/ui/PromptManagerLayoutStyles.test.ts
```

Expected: all focused test files pass.

- [x] **Step 2: Run the complete frontend suite**

```bash
npm test
```

Expected: all test files pass with no new failures.

- [x] **Step 3: Run static and production checks**

```bash
npx tsc --noEmit
git diff --check
npm run build
```

Expected: TypeScript exits 0, diff check emits nothing, and Vite completes a production build.

- [x] **Step 4: Review the final diff**

Confirm task changes are limited to drag-control isolation, reorder failure feedback, tests, and this plan. Preserve all pre-existing uncommitted prompt-group work and do not commit or revert unrelated files.

## Self-Review

- Spec coverage: action-button isolation, drag start behavior, persistence rollback, user feedback, and regression verification each map to a task.
- Placeholder scan: no deferred implementation steps or unspecified tests remain.
- Type consistency: `PromptReorderRow`, `reorderError`, and `messages.manager.reorderFailed` use consistent names throughout.
