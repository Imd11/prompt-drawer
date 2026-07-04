# Prompt Categories Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add lightweight prompt categories so users can organize prompt containers by scenario while preserving the existing manager and picker UI style.

**Architecture:** Evolve the local prompt JSON store from flat `containers` to `categories + containers`, with a default category migration for all existing data. Keep `Single` and `Group` exactly as prompt-container types inside a category. Add a narrow left category rail to the manager and category tabs to the Calico quick picker without redesigning the whole app.

**Tech Stack:** React 19, TypeScript, Vitest + Testing Library, Tauri local file storage, existing CSS in `src/styles.css`.

---

## Product Scope

### In Scope

- Add first-class `Category` data.
- Migrate existing v1/v2 prompt data into one default category.
- Keep current `New Prompt Container` and `Prompt List` UI mostly intact.
- Add a lightweight left category rail in the prompt manager.
- Filter manager create/list/reorder operations by current category.
- Add category tabs at the top of the Calico quick picker.
- Remember the last active category.
- Export v3 data and import v1/v2/v3.
- Add focused tests for data migration, manager interactions, quick picker tabs, and App integration.

### Out Of Scope For First Version

- Nested folders.
- Tags.
- Search.
- Category colors/icons.
- Dragging prompts across categories.
- Bulk move.
- Managing categories from the Calico quick picker.
- Large visual redesign of the manager page.

---

## Target UX

### Manager Page

Keep the existing page header and right-side panels. Insert a narrow category rail beside the existing content.

```text
Manage Prompts                         Settings Import Export
13 prompt containers in your local library.

┌───────────────┬────────────────────────────────────────────┐
│ Categories    │ New Prompt Container                       │
│               │ [Single] [Group]                           │
│ ● 默认     13 │ Title                                      │
│   写作      4 │ Prompt body...                             │
│   运营      2 │ Add Prompt                                  │
│               │                                            │
│ + New         │ Prompt List                                │
│               │ 讨论方案              ↑ ↓ Edit Delete       │
│               │ 代码审查              ↑ ↓ Edit Delete       │
└───────────────┴────────────────────────────────────────────┘
```

Expected behavior:

- Clicking a category switches the right pane to that category.
- Creating a prompt adds it to the active category.
- Reordering prompts only reorders prompts in the active category.
- Empty categories show a local empty state in the right pane.
- Category management is inline and lightweight.

### Calico Quick Picker

Add tabs above the current prompt list.

```text
┌────────────────────────────┐
│ [开发代码] [写作] [运营]   │
├────────────────────────────┤
│ 讨论方案                   │
│ 代码审查                   │
│ 生成测试                   │
└────────────────────────────┘
```

Expected behavior:

- Tabs switch the prompt list.
- The selected tab is remembered.
- If the selected category is removed, fall back to the first category.
- If a category is empty, show the existing quick-list empty-state style with category-aware copy.
- Tabs live inside the popover content viewport, above the scrollable prompt list. They do not replace or consume the outer panel padding.
- The bottom pointer/triangle decoration should be removed so the panel reads as a clean picker surface and the top/bottom content spacing is easier to balance.
- The prompt list should be the only scrollable region. When scrolled to the top or bottom, the first and last prompt cards should be fully visible and not appear clipped by the panel edge.

Target internal layout:

```text
Popover panel
┌────────────────────────────┐
│ panel padding               │
│ [开发代码] [写作] [运营]   │  ← fixed tabs inside panel
│                            │
│ ┌────────────────────────┐ │
│ │ scrollable prompt list │ │  ← only this area scrolls
│ │ prompt card            │ │
│ │ prompt card            │ │
│ └────────────────────────┘ │
│ panel padding               │
└────────────────────────────┘
```

---

## Data Model

Add categories to `src/shared/promptTypes.ts`.

```ts
export type PromptCategory = {
  id: string;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
};

export type PromptContainer = {
  id: string;
  categoryId: string;
  title: string;
  type: PromptContainerType;
  prompts: PromptEntry[];
  intervalMs: number;
  order: number;
  createdAt: string;
  updatedAt: string;
};
```

Use store data v3:

```ts
type PromptStoreDataV3 = {
  version: 3;
  categories: PromptCategory[];
  containers: PromptContainer[];
  activeCategoryId: string | null;
};
```

Migration rule:

- v1 `{ prompts }` -> one default category + converted single containers.
- v2 `{ containers }` -> one default category + existing containers assigned to it.
- v3 -> normalize categories, containers, active category.

Default category:

- Internal generated id, e.g. `category-default`.
- Store the stable name `"Default"` in local/imported data because the prompt store is language-agnostic.
- Display the default category through i18n at UI time: if `category.id === "category-default"` and `category.name === "Default"`, show `messages.manager.defaultCategoryName` (`"默认"` / `"Default"`). If the user renames it, show the stored custom name.
- The default category remains editable. Renaming it should replace the stored name, and after that the UI must not force the localized fallback.

Risk-control rules:

- This is a forward data upgrade from v1/v2 to v3. Existing v1/v2 files must migrate automatically; new v3 exports are not expected to be readable by older app versions.
- Prompt ordering is category-local. `order` values only need to be stable within each `categoryId`; reordering one category must not renumber another category's visible order.
- Switching active category must clear transient manager UI state such as editing mode, delete confirmation, create/rename inline inputs, and category action errors.
- Category create/rename inputs must be safe for Chinese IME composition. Pressing Enter during composition must not submit early.
- Deleting a non-empty category or the last category must show user-visible feedback, not only throw or log.

---

## Implementation Tasks

### Task 1: Add Category Types And Store Migration Tests

**Files:**

- Modify: `src/shared/promptTypes.ts`
- Modify: `src/shared/promptStore.test.ts`
- Modify later: `src/shared/promptStore.ts`

**Step 1: Write failing tests for v3 migration and listing**

Add tests to `src/shared/promptStore.test.ts`.

```ts
it("migrates v2 containers into a default category", async () => {
  let state = JSON.stringify({
    version: 2,
    containers: [
      {
        id: "container-1",
        title: "Code Review",
        type: "single",
        prompts: [{ id: "entry-1", body: "Review this", order: 0 }],
        intervalMs: 700,
        order: 0,
        createdAt: "2026-05-26T00:00:00.000Z",
        updatedAt: "2026-05-26T00:00:00.000Z"
      }
    ]
  });
  const store = createPromptStore({
    read: async () => state,
    write: async (value) => { state = value; }
  });

  const categories = await store.listCategories();
  const prompts = await store.list();

  expect(categories).toHaveLength(1);
  expect(categories[0].name).toBe("Default");
  expect(prompts[0].categoryId).toBe(categories[0].id);
});

it("exports v3 data with categories and active category", async () => {
  const store = createTestStore();
  const categories = await store.listCategories();
  await store.create({ title: "A", body: "a", categoryId: categories[0].id });

  const data = JSON.parse(await store.exportJson());

  expect(data.version).toBe(3);
  expect(Array.isArray(data.categories)).toBe(true);
  expect(Array.isArray(data.containers)).toBe(true);
  expect(data.activeCategoryId).toBe(categories[0].id);
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- src/shared/promptStore.test.ts
```

Expected: FAIL because `listCategories()` does not exist and export still uses `version: 2`.

**Step 3: Add types only**

In `src/shared/promptTypes.ts`, add:

```ts
export type PromptCategory = {
  id: string;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
};
```

Add `categoryId: string` to `PromptContainer`.

**Step 4: Implement minimal v3 parsing and default category**

In `src/shared/promptStore.ts`:

- Add `PromptStoreDataV3`.
- Add `DEFAULT_CATEGORY_ID = "category-default"`.
- Add helpers:

```ts
function defaultCategory(now: string): PromptCategory {
  return {
    id: DEFAULT_CATEGORY_ID,
    name: "Default",
    order: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function sortCategories(categories: PromptCategory[]): PromptCategory[] {
  return [...categories].sort((a, b) => a.order - b.order);
}
```

Return a normalized data object internally instead of only `PromptContainer[]`:

```ts
type NormalizedPromptStore = {
  categories: PromptCategory[];
  containers: PromptContainer[];
  activeCategoryId: string;
};
```

**Step 5: Run tests to verify pass**

Run:

```bash
npm test -- src/shared/promptStore.test.ts
```

Expected: PASS for updated prompt-store tests.

**Step 6: Commit**

```bash
git add src/shared/promptTypes.ts src/shared/promptStore.ts src/shared/promptStore.test.ts
git commit -m "feat: add prompt category store model"
```

---

### Task 2: Add Category Store Operations

**Files:**

- Modify: `src/shared/promptStore.ts`
- Modify: `src/shared/promptStore.test.ts`
- Modify: `src/shared/promptImportExport.test.ts`

**Step 1: Write failing tests for category CRUD**

Add tests:

```ts
it("creates, renames, and removes empty categories", async () => {
  const store = createTestStore();
  const created = await store.createCategory("Writing");

  expect((await store.listCategories()).map((category) => category.name)).toContain("Writing");

  await store.renameCategory(created.id, "Drafting");
  expect((await store.listCategories()).find((category) => category.id === created.id)?.name)
    .toBe("Drafting");

  await store.removeCategory(created.id);
  expect((await store.listCategories()).some((category) => category.id === created.id)).toBe(false);
});

it("does not remove the last category", async () => {
  const store = createTestStore();
  const [category] = await store.listCategories();

  await expect(store.removeCategory(category.id)).rejects.toThrow("Cannot remove last category");
});

it("does not remove categories that contain prompts", async () => {
  const store = createTestStore();
  const [category] = await store.listCategories();
  await store.create({ title: "A", body: "a", categoryId: category.id });

  await expect(store.removeCategory(category.id)).rejects.toThrow("Cannot remove category with prompts");
});

it("reorders prompts only inside the selected category", async () => {
  const store = createTestStore();
  const dev = await store.createCategory("开发代码");
  const writing = await store.createCategory("写作");
  const devFirst = await store.create({ title: "Dev First", body: "a", categoryId: dev.id });
  const devSecond = await store.create({ title: "Dev Second", body: "b", categoryId: dev.id });
  const writingOnly = await store.create({ title: "Writing Only", body: "c", categoryId: writing.id });

  await store.reorder([devSecond.id, devFirst.id], dev.id);

  const devTitles = (await store.list())
    .filter((prompt) => prompt.categoryId === dev.id)
    .map((prompt) => prompt.title);
  const writingTitles = (await store.list())
    .filter((prompt) => prompt.categoryId === writing.id)
    .map((prompt) => prompt.title);

  expect(devTitles).toEqual(["Dev Second", "Dev First"]);
  expect(writingTitles).toEqual([writingOnly.title]);
});
```

**Step 2: Run tests to verify fail**

Run:

```bash
npm test -- src/shared/promptStore.test.ts src/shared/promptImportExport.test.ts
```

Expected: FAIL because category CRUD methods do not exist.

**Step 3: Implement category API**

Extend `createPromptStore()` return object:

```ts
async listCategories(): Promise<PromptCategory[]>
async getActiveCategoryId(): Promise<string>
async setActiveCategoryId(categoryId: string): Promise<void>
async createCategory(name: string): Promise<PromptCategory>
async renameCategory(id: string, name: string): Promise<PromptCategory | null>
async removeCategory(id: string): Promise<void>
```

Rules:

- Trim names.
- Empty names throw `Invalid category name`.
- `setActiveCategoryId` ignores or throws for missing id. Prefer throw so tests catch mistakes.
- `removeCategory` throws when category has prompts.
- `removeCategory` throws when removing the last category.
- After removing active category, set active to first category.
- Reordering with a `categoryId` only renumbers prompts in that category. Prompts in other categories keep their relative order and category membership.
- When create/createGroup is called without `categoryId`, use the active category. If the active category is missing, fall back to the first normalized category.

**Step 4: Update create/createGroup/update/reorder signatures**

Allow category-aware create:

```ts
async create(input: { title: string; body: string; categoryId?: string }): Promise<PromptContainer>
async createGroup(input: {
  title: string;
  prompts: Array<{ body: string }>;
  intervalMs?: number;
  categoryId?: string;
}): Promise<PromptContainer>
```

Default to active category when `categoryId` is omitted.

Add category-aware reorder:

```ts
async reorder(orderedIds: string[], categoryId?: string): Promise<void>
```

If `categoryId` is provided, only reorder containers in that category.

**Step 5: Run tests**

Run:

```bash
npm test -- src/shared/promptStore.test.ts src/shared/promptImportExport.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/shared/promptStore.ts src/shared/promptStore.test.ts src/shared/promptImportExport.test.ts
git commit -m "feat: add prompt category operations"
```

---

### Task 3: Add Category-Aware App State

**Files:**

- Modify: `src/App.tsx`
- Modify: `src/app/App.test.tsx`

**Step 1: Write failing App tests**

Add tests in `src/app/App.test.tsx`.

```ts
it("renders manager categories and filters prompts by active category", async () => {
  const devCategory = {
    id: "cat-dev",
    name: "开发代码",
    order: 0,
    createdAt: "2026-05-26T00:00:00.000Z",
    updatedAt: "2026-05-26T00:00:00.000Z",
  };
  const writingCategory = {
    ...devCategory,
    id: "cat-writing",
    name: "写作",
    order: 1,
  };

  await renderMainPromptManagerWithStore({
    version: 3,
    categories: [devCategory, writingCategory],
    activeCategoryId: "cat-dev",
    containers: [
      makeContainer({ id: "dev-1", categoryId: "cat-dev", title: "Code Review" }),
      makeContainer({ id: "writing-1", categoryId: "cat-writing", title: "Blog Draft" }),
    ],
  });

  expect(screen.getByRole("button", { name: /开发代码/ })).toBeTruthy();
  expect(screen.getByText("Code Review")).toBeTruthy();
  expect(screen.queryByText("Blog Draft")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: /写作/ }));

  expect(await screen.findByText("Blog Draft")).toBeTruthy();
  expect(screen.queryByText("Code Review")).toBeNull();
});
```

Create helpers near current `renderMainPromptManager()`:

```ts
function makeContainer(overrides: Partial<PromptContainer>): PromptContainer {
  return {
    id: "container",
    categoryId: "cat-dev",
    title: "Prompt",
    type: "single",
    prompts: [{ id: "entry", body: "body", order: 0 }],
    intervalMs: 700,
    order: 0,
    createdAt: "2026-05-26T00:00:00.000Z",
    updatedAt: "2026-05-26T00:00:00.000Z",
    ...overrides,
  };
}
```

**Step 2: Run tests to verify fail**

Run:

```bash
npm test -- src/app/App.test.tsx -t "categories|active category"
```

Expected: FAIL because `App` does not pass category state into `PromptManager`.

**Step 3: Add App state**

In `src/App.tsx` add:

```ts
const [categories, setCategories] = useState<PromptCategory[]>([]);
const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
```

Create a reload function:

```ts
const reloadPromptData = useCallback(async () => {
  const [containers, loadedCategories, loadedActiveCategoryId] = await Promise.all([
    storeRef.current.list(),
    storeRef.current.listCategories(),
    storeRef.current.getActiveCategoryId(),
  ]);
  setPrompts(containers);
  setCategories(loadedCategories);
  setActiveCategoryId(loadedActiveCategoryId);
}, []);
```

Replace existing `reloadPrompts()` calls with `reloadPromptData()` where category data must stay fresh.

Also replace the initial `storeRef.current.list().then(...)` load with `reloadPromptData()` so the first render loads prompts, categories, and active category together.

**Step 4: Filter prompts by active category**

Add:

```ts
const activeCategory = categories.find((category) => category.id === activeCategoryId)
  ?? categories[0]
  ?? null;
const activePrompts = activeCategory
  ? prompts.filter((prompt) => prompt.categoryId === activeCategory.id)
  : prompts;
```

Pass `activePrompts` to `PromptManager` and `PromptQuickList`.

**Step 5: Run tests**

Run:

```bash
npm test -- src/app/App.test.tsx -t "categories|active category"
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/App.tsx src/app/App.test.tsx
git commit -m "feat: wire active prompt category state"
```

---

### Task 4: Build The Lightweight Category Rail Component

**Files:**

- Create: `src/ui/CategoryRail.tsx`
- Create: `src/ui/CategoryRail.test.tsx`
- Modify: `src/shared/i18n.ts`
- Modify later: `src/styles.css`

**Step 1: Write failing component tests**

Create `src/ui/CategoryRail.test.tsx`.

```ts
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CategoryRail } from "./CategoryRail";

const categories = [
  { id: "cat-dev", name: "开发代码", order: 0, createdAt: "", updatedAt: "" },
  { id: "cat-writing", name: "写作", order: 1, createdAt: "", updatedAt: "" },
];

describe("CategoryRail", () => {
  it("renders categories with counts and selects a category", () => {
    const onSelect = vi.fn();
    render(
      <CategoryRail
        categories={categories}
        activeCategoryId="cat-dev"
        counts={{ "cat-dev": 13, "cat-writing": 4 }}
        messages={{
          title: "Categories",
          newCategory: "New",
          newCategoryName: "New category name",
          renameCategory: "Rename category",
          deleteCategory: "Delete category",
          saveCategory: "Save",
          cancelCategory: "Cancel",
        }}
        onSelect={onSelect}
        onCreate={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
      />
    );

    expect(screen.getByRole("button", { name: /开发代码.*13/ })).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByRole("button", { name: /写作.*4/ }));
    expect(onSelect).toHaveBeenCalledWith("cat-writing");
  });

  it("creates a category inline", () => {
    const onCreate = vi.fn();
    render(/* same props with onCreate */);

    fireEvent.click(screen.getByRole("button", { name: /New/ }));
    fireEvent.change(screen.getByRole("textbox", { name: /New category name/ }), {
      target: { value: "运营" },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: /New category name/ }), {
      key: "Enter",
    });

    expect(onCreate).toHaveBeenCalledWith("运营");
  });

  it("does not submit while Chinese IME composition is active", () => {
    const onCreate = vi.fn();
    render(/* same props with onCreate */);

    fireEvent.click(screen.getByRole("button", { name: /New/ }));
    const input = screen.getByRole("textbox", { name: /New category name/ });

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "yun" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCreate).not.toHaveBeenCalled();

    fireEvent.compositionEnd(input);
    fireEvent.change(input, { target: { value: "运营" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    expect(onCreate).toHaveBeenCalledWith("运营");
  });

  it("shows a category action error", () => {
    render(
      <CategoryRail
        categories={categories}
        activeCategoryId="cat-dev"
        counts={{ "cat-dev": 13, "cat-writing": 4 }}
        messages={{
          title: "Categories",
          newCategory: "New",
          newCategoryName: "New category name",
          renameCategory: "Rename category",
          deleteCategory: "Delete category",
          saveCategory: "Save",
          cancelCategory: "Cancel",
        }}
        actionError="Cannot remove category with prompts"
        onSelect={() => {}}
        onCreate={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent("Cannot remove category with prompts");
  });
});
```

**Step 2: Run tests to verify fail**

Run:

```bash
npm test -- src/ui/CategoryRail.test.tsx
```

Expected: FAIL because component does not exist.

**Step 3: Implement component**

Create `src/ui/CategoryRail.tsx`.

Required props:

```ts
import { useState } from "react";
import type { PromptCategory } from "../shared/promptTypes";

export type CategoryRailMessages = {
  title: string;
  newCategory: string;
  newCategoryName: string;
  renameCategory: string;
  deleteCategory: string;
  saveCategory: string;
  cancelCategory: string;
};

type CategoryRailProps = {
  categories: PromptCategory[];
  activeCategoryId: string | null;
  counts: Record<string, number>;
  messages: CategoryRailMessages;
  getCategoryDisplayName?: (category: PromptCategory) => string;
  actionError?: string | null;
  onSelect: (categoryId: string) => void;
  onCreate: (name: string) => void | Promise<void>;
  onRename: (categoryId: string, name: string) => void | Promise<void>;
  onDelete: (categoryId: string) => void | Promise<void>;
};
```

Component behavior:

- Render heading `messages.title`.
- Render each category as a button with count.
- Active button gets `aria-current="true"` and class `is-active`.
- Render `+ New` button.
- Inline input for create mode.
- Inline create/rename controls must include visible Save and Cancel buttons. Enter may submit only when not composing text.
- Track IME composition with `onCompositionStart` / `onCompositionEnd`; ignore Enter while composition is active.
- Use `getCategoryDisplayName?.(category) ?? category.name` so the App can show `"默认"` for the stored default category in Chinese without mutating store data.
- Render `actionError` in a small `role="status"` area near the category controls when category create/rename/delete fails.
- Minimal edit/delete controls for active category only.

Keep it simple. Use text buttons for Rename/Delete in this first version.

**Step 4: Add i18n keys**

In `src/shared/i18n.ts`, add under `manager`:

```ts
categoriesTitle: "分类",
defaultCategoryName: "默认",
newCategory: "新建",
newCategoryName: "分类名称",
renameCategory: "重命名分类",
deleteCategory: "删除分类",
saveCategory: "保存",
cancelCategory: "取消",
categoryCreateFailed: "未能新建分类，请重试。",
categoryRenameFailed: "未能重命名分类，请重试。",
categoryDeleteFailed: "未能删除分类，请先确认它是否为空。",
emptyCategory: "这个分类还没有提示词。",
```

English:

```ts
categoriesTitle: "Categories",
defaultCategoryName: "Default",
newCategory: "New",
newCategoryName: "Category name",
renameCategory: "Rename category",
deleteCategory: "Delete category",
saveCategory: "Save",
cancelCategory: "Cancel",
categoryCreateFailed: "Could not create category. Try again.",
categoryRenameFailed: "Could not rename category. Try again.",
categoryDeleteFailed: "Could not delete category. Make sure it is empty first.",
emptyCategory: "No prompts in this category.",
```

**Step 5: Run tests**

Run:

```bash
npm test -- src/ui/CategoryRail.test.tsx
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/ui/CategoryRail.tsx src/ui/CategoryRail.test.tsx src/shared/i18n.ts
git commit -m "feat: add category rail component"
```

---

### Task 5: Integrate Category Rail Into PromptManager

**Files:**

- Modify: `src/ui/PromptManager.tsx`
- Modify: `src/ui/PromptManager.test.tsx`
- Modify: `src/styles.css`

**Step 1: Write failing tests**

Add to `src/ui/PromptManager.test.tsx`:

```ts
it("renders a left category rail without changing create and list panels", () => {
  renderManager({
    categories: [
      { id: "cat-dev", name: "开发代码", order: 0, createdAt: "", updatedAt: "" },
      { id: "cat-writing", name: "写作", order: 1, createdAt: "", updatedAt: "" },
    ],
    activeCategoryId: "cat-dev",
    categoryCounts: { "cat-dev": 2, "cat-writing": 0 },
  });

  expect(screen.getByRole("heading", { name: "分类" })).toBeTruthy();
  expect(screen.getByRole("button", { name: /开发代码.*2/ })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "New Prompt Container" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Prompt List" })).toBeTruthy();
});

it("clears transient edit and delete state when the active category changes", () => {
  const { rerender } = renderManager({
    categories: [
      { id: "cat-dev", name: "开发代码", order: 0, createdAt: "", updatedAt: "" },
      { id: "cat-writing", name: "写作", order: 1, createdAt: "", updatedAt: "" },
    ],
    activeCategoryId: "cat-dev",
    categoryCounts: { "cat-dev": 1, "cat-writing": 1 },
    prompts: [makePrompt({ id: "dev-1", categoryId: "cat-dev", title: "Code Review" })],
  });

  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByDisplayValue("Code Review")).toBeTruthy();

  rerender(renderManagerElement({
    categories: [
      { id: "cat-dev", name: "开发代码", order: 0, createdAt: "", updatedAt: "" },
      { id: "cat-writing", name: "写作", order: 1, createdAt: "", updatedAt: "" },
    ],
    activeCategoryId: "cat-writing",
    categoryCounts: { "cat-dev": 1, "cat-writing": 1 },
    prompts: [makePrompt({ id: "writing-1", categoryId: "cat-writing", title: "Blog Draft" })],
  }));

  expect(screen.queryByDisplayValue("Code Review")).toBeNull();
});
```

**Step 2: Run tests to verify fail**

Run:

```bash
npm test -- src/ui/PromptManager.test.tsx
```

Expected: FAIL because `PromptManager` has no category props.

**Step 3: Extend PromptManager props**

In `src/ui/PromptManager.tsx`, add props:

```ts
categories: PromptCategory[];
activeCategoryId: string | null;
categoryCounts: Record<string, number>;
onSelectCategory: (categoryId: string) => void;
onCreateCategory: (name: string) => void | Promise<void>;
onRenameCategory: (categoryId: string, name: string) => void | Promise<void>;
onDeleteCategory: (categoryId: string) => void | Promise<void>;
getCategoryDisplayName: (category: PromptCategory) => string;
categoryActionError?: string | null;
```

Import `PromptCategory` and `CategoryRail`.

**Step 4: Add layout wrapper**

Change manager content after header to:

```tsx
<div className="prompt-manager-body">
  <CategoryRail ... />
  <div className="prompt-manager-content">
    <form className="editor-panel editor-panel-stacked">...</form>
    <section className="list-panel">...</section>
  </div>
</div>
```

Do not change the internal markup of the existing create/list panels except for empty-state copy.

Add an effect in `PromptManager`:

```ts
useEffect(() => {
  setEditingId(null);
  setDeleteConfirmId(null);
}, [activeCategoryId]);
```

If `CategoryRail` owns inline create/rename state, it should also reset its local input mode when `activeCategoryId` changes.

**Step 5: Add CSS**

In `src/styles.css`, add:

```css
.prompt-manager-body {
  display: grid;
  grid-template-columns: 172px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}

.category-rail {
  position: sticky;
  top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--pp-surface);
  border: 1px solid var(--pp-border);
  border-radius: var(--pp-radius-md);
  box-shadow: var(--pp-shadow-soft);
}

.category-rail-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.category-rail-item {
  display: flex;
  justify-content: space-between;
  width: 100%;
  min-height: 34px;
  padding: 0 8px;
  color: var(--pp-muted);
  background: transparent;
  border-radius: 7px;
  text-align: left;
}

.category-rail-item.is-active {
  color: var(--pp-text);
  background: var(--pp-accent-soft);
  font-weight: 700;
}

.prompt-manager-content {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 14px;
}
```

Mobile fallback:

```css
@media (max-width: 760px) {
  .prompt-manager-body {
    grid-template-columns: 1fr;
  }
  .category-rail {
    position: static;
  }
}
```

**Step 6: Run tests**

Run:

```bash
npm test -- src/ui/PromptManager.test.tsx
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src/ui/PromptManager.tsx src/ui/PromptManager.test.tsx src/styles.css
git commit -m "feat: add category rail to prompt manager"
```

---

### Task 6: Wire Category CRUD In App

**Files:**

- Modify: `src/App.tsx`
- Modify: `src/app/App.test.tsx`

**Step 1: Write failing App interaction tests**

Add:

```ts
it("creates a category from the manager rail and selects it", async () => {
  const files = await renderMainPromptManager();

  fireEvent.click(screen.getByRole("button", { name: /新建/ }));
  fireEvent.change(screen.getByRole("textbox", { name: /分类名称/ }), {
    target: { value: "写作" },
  });
  fireEvent.keyDown(screen.getByRole("textbox", { name: /分类名称/ }), { key: "Enter" });

  await waitFor(() => {
    expect(screen.getByRole("button", { name: /写作/ })).toHaveAttribute("aria-current", "true");
  });

  const saved = JSON.parse(files.get("prompts.json") ?? "{}");
  expect(saved.categories.some((category: { name: string }) => category.name === "写作")).toBe(true);
});

it("shows a visible error when deleting a non-empty category", async () => {
  await renderMainPromptManagerWithStore({
    version: 3,
    categories: [devCategory],
    activeCategoryId: "cat-dev",
    containers: [makeContainer({ id: "dev-1", categoryId: "cat-dev", title: "Code Review" })],
  });

  fireEvent.click(screen.getByRole("button", { name: /删除分类/ }));

  expect(await screen.findByRole("status")).toHaveTextContent("未能删除分类");
});

it("shows the localized default category name without changing stored data", async () => {
  const files = await renderMainPromptManagerWithStore({
    version: 3,
    categories: [{
      id: "category-default",
      name: "Default",
      order: 0,
      createdAt: "2026-05-26T00:00:00.000Z",
      updatedAt: "2026-05-26T00:00:00.000Z",
    }],
    activeCategoryId: "category-default",
    containers: [],
  });

  expect(screen.getByRole("button", { name: /默认/ })).toBeTruthy();
  expect(files.get("prompts.json")).toContain("\"name\": \"Default\"");
});
```

**Step 2: Run tests to verify fail**

Run:

```bash
npm test -- src/app/App.test.tsx -t "category"
```

Expected: FAIL because handlers are not wired.

**Step 3: Implement handlers**

In `src/App.tsx`:

```ts
const [categoryActionError, setCategoryActionError] = useState<string | null>(null);

const handleSelectCategory = async (categoryId: string) => {
  setCategoryActionError(null);
  await storeRef.current.setActiveCategoryId(categoryId);
  setActiveCategoryId(categoryId);
};

const handleCreateCategory = async (name: string) => {
  setCategoryActionError(null);
  try {
    const category = await storeRef.current.createCategory(name);
    await storeRef.current.setActiveCategoryId(category.id);
    await reloadPromptData();
  } catch (error) {
    console.warn("Failed to create category:", error);
    setCategoryActionError(t.manager.categoryCreateFailed);
  }
};

const handleRenameCategory = async (categoryId: string, name: string) => {
  setCategoryActionError(null);
  try {
    await storeRef.current.renameCategory(categoryId, name);
    await reloadPromptData();
  } catch (error) {
    console.warn("Failed to rename category:", error);
    setCategoryActionError(t.manager.categoryRenameFailed);
  }
};

const handleDeleteCategory = async (categoryId: string) => {
  setCategoryActionError(null);
  try {
    await storeRef.current.removeCategory(categoryId);
    await reloadPromptData();
  } catch (error) {
    console.warn("Failed to delete category:", error);
    setCategoryActionError(t.manager.categoryDeleteFailed);
  }
};
```

Add display helper:

```ts
const getCategoryDisplayName = useCallback((category: PromptCategory) => {
  if (category.id === "category-default" && category.name === "Default") {
    return t.manager.defaultCategoryName;
  }
  return category.name;
}, [t.manager.defaultCategoryName]);
```

Pass handlers, `getCategoryDisplayName`, and `categoryActionError` into `PromptManager`.

**Step 4: Update create/reorder calls**

For create:

```ts
await storeRef.current.create({
  ...input,
  categoryId: activeCategory?.id,
});
```

For create group:

```ts
await storeRef.current.createGroup({
  ...input,
  categoryId: activeCategory?.id,
});
```

For reorder:

```ts
await storeRef.current.reorder(ids, activeCategory?.id);
```

**Step 5: Run tests**

Run:

```bash
npm test -- src/app/App.test.tsx -t "category"
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/App.tsx src/app/App.test.tsx
git commit -m "feat: wire prompt category management"
```

---

### Task 7: Add Category Tabs To PromptQuickList

**Files:**

- Modify: `src/ui/PromptQuickList.tsx`
- Modify: `src/ui/PromptQuickList.test.tsx`
- Modify: `src/styles.css`

**Step 1: Write failing quick-list tests**

Add to `src/ui/PromptQuickList.test.tsx`:

```ts
it("renders category tabs and switches active category", () => {
  const onSelectCategory = vi.fn();
  render(
    <PromptQuickList
      prompts={[devPrompt]}
      categories={[
        { id: "cat-dev", name: "开发代码", order: 0, createdAt: "", updatedAt: "" },
        { id: "cat-writing", name: "写作", order: 1, createdAt: "", updatedAt: "" },
      ]}
      activeCategoryId="cat-dev"
      onSelectCategory={onSelectCategory}
      messages={zh.quickList}
      groupMeta={zh.manager.groupMeta}
      onSelect={() => {}}
    />
  );

  expect(screen.getByRole("tab", { name: "开发代码" })).toHaveAttribute("aria-selected", "true");
  fireEvent.click(screen.getByRole("tab", { name: "写作" }));
  expect(onSelectCategory).toHaveBeenCalledWith("cat-writing");
});
```

**Step 2: Run tests to verify fail**

Run:

```bash
npm test -- src/ui/PromptQuickList.test.tsx
```

Expected: FAIL because props and tab UI do not exist.

**Step 3: Extend props**

In `src/ui/PromptQuickList.tsx`:

```ts
categories?: PromptCategory[];
activeCategoryId?: string | null;
getCategoryDisplayName?: (category: PromptCategory) => string;
onSelectCategory?: (categoryId: string) => void;
```

**Step 4: Render tabs above list**

Inside `.prompt-quick-shell`, before `.prompt-quick-list`:

```tsx
{categories && categories.length > 1 ? (
  <div className="prompt-category-tabs" role="tablist" aria-label={messages.categoriesLabel}>
    {categories.map((category) => (
      <button
        key={category.id}
        className={`prompt-category-tab ${category.id === activeCategoryId ? "is-active" : ""}`}
        type="button"
        role="tab"
        aria-selected={category.id === activeCategoryId}
        onClick={() => onSelectCategory?.(category.id)}
      >
        {getCategoryDisplayName?.(category) ?? category.name}
      </button>
    ))}
  </div>
) : null}
```

Add i18n:

```ts
categoriesLabel: "分类"
```

English:

```ts
categoriesLabel: "Categories"
```

**Step 5: Add CSS**

```css
.prompt-category-tabs {
  display: flex;
  gap: 6px;
  max-width: 100%;
  overflow-x: auto;
  padding: 4px 4px 8px;
}

.prompt-category-tab {
  flex: 0 0 auto;
  min-height: 30px;
  padding: 0 10px;
  color: var(--pp-muted);
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid var(--pp-border);
  border-radius: 999px;
  white-space: nowrap;
}

.prompt-category-tab.is-active {
  color: var(--pp-text);
  background: #ffffff;
  border-color: var(--pp-border-strong);
  font-weight: 700;
}
```

**Step 6: Run tests**

Run:

```bash
npm test -- src/ui/PromptQuickList.test.tsx
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src/ui/PromptQuickList.tsx src/ui/PromptQuickList.test.tsx src/shared/i18n.ts src/styles.css
git commit -m "feat: add category tabs to quick picker"
```

---

### Task 8: Wire Quick Picker Category Tabs In App

**Files:**

- Modify: `src/App.tsx`
- Modify: `src/app/App.test.tsx`

**Step 1: Write failing App test**

Add:

```ts
it("quick picker switches prompt categories with tabs", async () => {
  await renderPromptPopoverWithStore({
    version: 3,
    categories: [devCategory, writingCategory],
    activeCategoryId: "cat-dev",
    containers: [
      makeContainer({ id: "dev-1", categoryId: "cat-dev", title: "Code Review" }),
      makeContainer({ id: "writing-1", categoryId: "cat-writing", title: "Blog Draft" }),
    ],
  });

  expect(screen.getByText("Code Review")).toBeTruthy();
  expect(screen.queryByText("Blog Draft")).toBeNull();

  fireEvent.click(screen.getByRole("tab", { name: "写作" }));

  expect(await screen.findByText("Blog Draft")).toBeTruthy();
});
```

**Step 2: Run test to verify fail**

Run:

```bash
npm test -- src/app/App.test.tsx -t "quick picker switches prompt categories"
```

Expected: FAIL because App does not pass category tabs to `PromptQuickList`.

**Step 3: Pass category props**

In `src/App.tsx` `PromptQuickList`:

```tsx
<PromptQuickList
  prompts={activePrompts}
  categories={categories}
  activeCategoryId={activeCategory?.id ?? null}
  getCategoryDisplayName={getCategoryDisplayName}
  onSelectCategory={handleSelectCategory}
  ...
/>
```

**Step 4: Ensure popover reload loads categories**

The existing `prompt-popover-opened` listener currently reloads prompts. It must call `reloadPromptData()`.

This is the minimum cross-window synchronization requirement: the popover must reflect categories and the last active category every time it opens. Live synchronization while both the manager and popover are already open is out of scope for this first version.

**Step 5: Run tests**

Run:

```bash
npm test -- src/app/App.test.tsx src/ui/PromptQuickList.test.tsx
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/App.tsx src/app/App.test.tsx
git commit -m "feat: wire quick picker category tabs"
```

---

### Task 9: Polish Quick Picker Viewport For Category Tabs

**Files:**

- Modify: `src/styles.css`
- Modify: `src-tauri/src/windows.rs`
- Modify: `src/ui/PromptQuickList.test.tsx`
- Modify: `src/app/App.test.tsx`

**Step 1: Write failing CSS/structure tests**

Add focused tests that protect the desired structure without overfitting every pixel.

In `src/ui/PromptQuickList.test.tsx`, add:

```ts
it("renders category tabs before the scrollable prompt list", () => {
  render(
    <PromptQuickList
      prompts={[singlePrompt]}
      categories={[
        { id: "cat-dev", name: "开发代码", order: 0, createdAt: "", updatedAt: "" },
        { id: "cat-writing", name: "写作", order: 1, createdAt: "", updatedAt: "" },
      ]}
      activeCategoryId="cat-dev"
      onSelectCategory={() => {}}
      messages={zh.quickList}
      groupMeta={zh.manager.groupMeta}
      onSelect={() => {}}
    />
  );

  const shell = document.querySelector(".prompt-quick-shell");
  const tabs = document.querySelector(".prompt-category-tabs");
  const list = document.querySelector(".prompt-quick-list");

  expect(shell?.firstElementChild).toBe(tabs);
  expect(tabs?.nextElementSibling).toBe(list);
});
```

In `src/app/App.test.tsx`, add a lightweight source/CSS regression test near other UI structure tests if there is an existing style-test pattern. If not, create a dedicated `src/ui/QuickPickerLayoutStyles.test.ts` that reads `src/styles.css`:

```ts
import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

describe("quick picker layout styles", () => {
  const css = readFileSync("src/styles.css", "utf8");

  it("does not render the old popover bottom triangle", () => {
    expect(css).not.toContain(".popover-window::after");
  });

  it("keeps tabs fixed above the scrollable prompt list", () => {
    expect(css).toContain(".popover-window");
    expect(css).toContain("display: flex");
    expect(css).toContain(".prompt-quick-list");
    expect(css).toContain("overflow-y: auto");
  });
});
```

Prefer the dedicated style test if adding this to App tests would make App tests too broad.

**Step 2: Run tests to verify fail**

Run:

```bash
npm test -- src/ui/PromptQuickList.test.tsx src/ui/QuickPickerLayoutStyles.test.ts
```

Expected: FAIL because the old CSS still contains `.popover-window::after` and the quick picker layout is not yet explicitly structured around fixed tabs + scroll list.

**Step 3: Remove the bottom triangle**

In `src/styles.css`, delete the entire block:

```css
.popover-window::after {
  position: absolute;
  bottom: 4px;
  left: 50%;
  width: 12px;
  height: 12px;
  background: var(--pp-surface-subtle);
  border-right: 1px solid rgba(148, 163, 184, 0.28);
  border-bottom: 1px solid rgba(148, 163, 184, 0.28);
  content: "";
  transform: translateX(-50%) rotate(45deg);
}
```

Reason: with category tabs, the popover reads more like a compact picker panel than a speech bubble. The triangle creates a visually larger bottom area and makes the scroll viewport appear unbalanced.

**Step 4: Make outer panel padding symmetric**

Change `.popover-window` from:

```css
padding: 8px 8px 16px;
```

to:

```css
display: flex;
min-height: 100vh;
flex-direction: column;
padding: 8px;
```

Keep:

```css
overflow: hidden;
```

The panel padding remains outside both the tabs and the list. Do not place tabs in the padding area.

**Step 5: Make shell fill the panel**

Update `.prompt-quick-shell`:

```css
.prompt-quick-shell {
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 7px;
}
```

Reason: once category tabs are inside the shell, the shell must divide available height between fixed tabs and a scrollable list.

**Step 6: Make tabs fixed and list scrollable**

Update category tabs CSS from Task 7:

```css
.prompt-category-tabs {
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
  max-width: 100%;
  overflow-x: auto;
  padding: 0 1px 1px;
}
```

Update `.prompt-quick-list`:

```css
.prompt-quick-list {
  display: flex;
  width: 100%;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  padding: 1px 1px 8px;
}
```

Notes:

- The list is the only vertical scrolling region.
- The bottom list padding is for scroll comfort only, not for the old triangle.
- If visual testing shows the bottom still feels too roomy, use `padding: 1px 1px 4px`.

**Step 7: Slightly reduce prompt card height without compressing text**

Current items are intentionally comfortable. With tabs added, reduce outer card padding and min-height slightly, but keep title/preview line-height stable.

Update:

```css
.prompt-quick-item {
  min-height: 58px;
  padding: 8px 11px;
}

.prompt-quick-item-group {
  min-height: 80px;
  padding-top: 10px;
  padding-bottom: 10px;
}
```

Do not reduce:

```css
.prompt-quick-title {
  line-height: 1.25;
}

.prompt-quick-preview-line {
  line-height: 1.3;
}
```

Reason: the target is less outer blank space per card, not tighter text.

**Step 8: Increase popover height for category tabs**

In `src-tauri/src/windows.rs`, update:

```rust
pub const POPOVER_HEIGHT: f64 = 432.0;
```

Update the existing height test:

```rust
#[test]
fn prompt_popover_height_supports_category_tabs_and_prompt_list() {
    assert_eq!(POPOVER_HEIGHT, 432.0);
}
```

Reason: tabs are inside the panel content, so the panel needs enough height to avoid reducing the visible prompt count too much.

Also review the existing popover positioning tests in `src-tauri/src/windows.rs`. If the larger height changes edge clamping behavior, update or add a test that places the button near the bottom edge of a monitor and verifies the popover still remains inside the visible monitor bounds.

**Step 9: Run tests**

Run:

```bash
npm test -- src/ui/PromptQuickList.test.tsx src/ui/QuickPickerLayoutStyles.test.ts
cargo test windows --lib
```

Expected: PASS.

**Step 10: Manual visual check**

Open the Calico quick picker and verify:

```text
1. There is no bottom triangle.
2. The outer panel looks like a clean rounded picker.
3. Category tabs sit inside the panel content area, above the list.
4. The prompt list scrolls independently below the tabs.
5. First and last prompt cards appear fully visible when scrolled to the top/bottom.
6. Top and bottom panel spacing feel balanced.
7. Prompt cards are slightly shorter, but title and preview text remain readable.
8. Hover preview still positions correctly.
9. With the cat near the top, bottom, left, and right screen edges, the taller popover stays on-screen and does not cover the cat in an obviously broken way.
```

**Step 11: Commit**

```bash
git add src/styles.css src-tauri/src/windows.rs src/ui/PromptQuickList.test.tsx src/ui/QuickPickerLayoutStyles.test.ts src/app/App.test.tsx
git commit -m "fix: polish quick picker category viewport"
```

---

### Task 10: Update Import/Export Compatibility

**Files:**

- Modify: `src/shared/promptStore.ts`
- Modify: `src/shared/promptImportExport.test.ts`
- Modify: `src/shared/promptStore.test.ts`

**Step 1: Write failing tests**

Add:

```ts
it("import preserves v3 categories", async () => {
  const store = createTestStore();

  await store.importJson(JSON.stringify({
    version: 3,
    categories: [
      { id: "cat-dev", name: "开发代码", order: 0, createdAt: "2026-05-26T00:00:00.000Z", updatedAt: "2026-05-26T00:00:00.000Z" }
    ],
    activeCategoryId: "cat-dev",
    containers: [
      {
        id: "container-1",
        categoryId: "cat-dev",
        title: "Review",
        type: "single",
        prompts: [{ id: "entry-1", body: "review", order: 0 }],
        intervalMs: 700,
        order: 0,
        createdAt: "2026-05-26T00:00:00.000Z",
        updatedAt: "2026-05-26T00:00:00.000Z"
      }
    ]
  }));

  expect((await store.listCategories())[0].name).toBe("开发代码");
  expect((await store.list())[0].categoryId).toBe("cat-dev");
});

it("importing v2 data creates a default category", async () => {
  const store = createTestStore();

  await store.importJson(JSON.stringify({
    version: 2,
    containers: [
      {
        id: "container-1",
        title: "Legacy V2",
        type: "single",
        prompts: [{ id: "entry-1", body: "body", order: 0 }],
        intervalMs: 700,
        order: 0,
        createdAt: "2026-05-26T00:00:00.000Z",
        updatedAt: "2026-05-26T00:00:00.000Z"
      }
    ]
  }));

  const [category] = await store.listCategories();
  expect(category.name).toBe("Default");
  expect((await store.list())[0].categoryId).toBe(category.id);
});
```

**Step 2: Run tests**

Run:

```bash
npm test -- src/shared/promptImportExport.test.ts src/shared/promptStore.test.ts
```

Expected: FAIL until import validation handles v3.

**Step 3: Implement validation**

Update `validateImportedContainers()` into `validateImportedData()` returning `NormalizedPromptStore`.

Rules:

- Reject categories with empty names.
- Reject containers with missing category by moving them to default category.
- Normalize category and container order.
- If active category missing, use first category.

**Step 4: Run tests**

Run:

```bash
npm test -- src/shared/promptImportExport.test.ts src/shared/promptStore.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/shared/promptStore.ts src/shared/promptImportExport.test.ts src/shared/promptStore.test.ts
git commit -m "feat: support category import export"
```

---

### Task 11: Empty States And Guardrails

**Files:**

- Modify: `src/ui/PromptManager.tsx`
- Modify: `src/ui/PromptManager.test.tsx`
- Modify: `src/ui/PromptQuickList.tsx`
- Modify: `src/ui/PromptQuickList.test.tsx`
- Modify: `src/shared/i18n.ts`

**Step 1: Write failing tests**

Manager empty category test:

```ts
it("shows an empty message for the selected empty category", () => {
  renderManager({
    prompts: [],
    categories: [{ id: "cat-empty", name: "写作", order: 0, createdAt: "", updatedAt: "" }],
    activeCategoryId: "cat-empty",
    categoryCounts: { "cat-empty": 0 },
  });

  expect(screen.getByText("这个分类还没有提示词。")).toBeTruthy();
});
```

Quick picker empty category test:

```ts
it("shows category-aware empty state in quick picker", () => {
  render(
    <PromptQuickList
      prompts={[]}
      categories={[{ id: "cat-writing", name: "写作", order: 0, createdAt: "", updatedAt: "" }]}
      activeCategoryId="cat-writing"
      messages={zh.quickList}
      groupMeta={zh.manager.groupMeta}
      onSelect={() => {}}
    />
  );

  expect(screen.getByText("这个分类还没有提示词")).toBeTruthy();
});
```

**Step 2: Run tests**

Run:

```bash
npm test -- src/ui/PromptManager.test.tsx src/ui/PromptQuickList.test.tsx
```

Expected: FAIL because copy is not category-aware yet.

**Step 3: Add copy**

In `src/shared/i18n.ts`:

```ts
quickList: {
  ...
  noPromptsInCategoryTitle: "这个分类还没有提示词",
  noPromptsInCategoryDescription: "可以在管理页添加一个。",
}
```

English equivalents:

```ts
noPromptsInCategoryTitle: "No prompts in this category",
noPromptsInCategoryDescription: "Add one from the manager.",
```

**Step 4: Update components**

Use category-aware empty copy when `categories` exists or `activeCategoryId` is present.

**Step 5: Run tests**

Run:

```bash
npm test -- src/ui/PromptManager.test.tsx src/ui/PromptQuickList.test.tsx
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/ui/PromptManager.tsx src/ui/PromptManager.test.tsx src/ui/PromptQuickList.tsx src/ui/PromptQuickList.test.tsx src/shared/i18n.ts
git commit -m "feat: add category empty states"
```

---

### Task 12: Full Regression Verification

**Files:**

- Review only: all touched files

**Step 1: Run focused tests**

Run:

```bash
npm test -- src/shared/promptStore.test.ts src/shared/promptImportExport.test.ts src/ui/CategoryRail.test.tsx src/ui/PromptManager.test.tsx src/ui/PromptQuickList.test.tsx src/app/App.test.tsx
```

Expected: PASS.

**Step 2: Run TypeScript check**

Run:

```bash
npx tsc --noEmit
```

Expected: PASS.

**Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: PASS and regenerated `dist/`.

Note: `dist/` is ignored by `.gitignore` but currently tracked/generated artifacts may appear dirty in this repo. Do not commit build artifacts unless the project convention for the current branch requires it.

**Step 4: Manual desktop check**

Run the app in dev or packaged mode and verify:

```text
1. Existing prompts appear in a Default category.
2. Manager page has left category rail.
3. The stored default category named `Default` displays as `默认` in Chinese UI.
4. New category can be created inline, including Chinese names typed through IME.
5. Switching category filters the right-side prompt list and clears edit/delete confirmation state.
6. Creating a prompt adds it to the active category.
7. Reordering prompts affects only the active category.
8. Attempting to delete a non-empty category shows a visible error and does not delete prompts.
9. Empty category shows empty state.
10. Calico popover shows category tabs.
11. Calico tab switch changes visible prompts.
12. Reopening the Calico popover reloads the last active category.
13. Calico popover no longer shows the bottom triangle.
14. Category tabs sit inside the popover panel, above the scrollable prompt list.
15. The prompt list is the only vertical scroll region.
16. The first and last prompt cards are fully visible when scrolled to the top/bottom.
17. Prompt cards are slightly denser but text remains readable.
18. The taller popover stays on-screen when the cat is near each screen edge.
19. Selecting a prompt still uses the existing paste/autosend behavior.
```

**Step 5: Commit final verification adjustments**

If verification required small fixes:

```bash
git add <fixed-files>
git commit -m "fix: stabilize prompt categories"
```

If no changes:

```bash
git status --short
```

Expected: only intentional source changes from previous commits.

---

## Acceptance Criteria

- Existing users do not lose prompts.
- Existing v1/v2 `prompts.json` opens without manual migration.
- v3 is treated as a forward upgrade; the app must import v1/v2/v3, but old app versions are not required to read new v3 exports.
- Manager page still looks like the current app, with only a lightweight left category rail added.
- Current `New Prompt Container` and `Prompt List` panels remain recognizable.
- Prompt creation, editing, deletion, and ordering still work.
- Prompt ordering is scoped to the active category.
- Category selection filters prompts in manager and quick picker.
- Switching categories clears manager edit/delete transient state.
- The default category displays in the current UI language while preserving stable stored data.
- Category create/rename supports Chinese IME input without premature Enter submission.
- Category create/rename/delete failures have visible feedback.
- Quick picker category tabs are compact and do not introduce management controls.
- Quick picker category tabs live inside the popover content area; they do not replace the panel padding.
- The old popover bottom triangle is removed.
- Quick picker outer panel spacing looks balanced without a larger bottom tail area.
- The taller quick picker remains correctly positioned near screen edges.
- Prompt card height is slightly reduced by trimming card padding, not by compressing title/preview line-height.
- Autosend/paste behavior is unchanged after selecting a prompt.
- Import/export works for old and new files.
- Tests and `npx tsc --noEmit` pass.

---

## Implementation Notes

- Keep category state in the prompt store, not settings, because it belongs to prompt-library organization and should travel with import/export.
- Use category counts in the manager rail so users can see where prompts live without adding explanatory text.
- Keep delete category conservative in v1: do not delete non-empty categories. This avoids building a modal and prevents accidental prompt loss.
- Do not add prompt moving between categories in the first version unless required after testing. It is useful but not necessary for the first complete category experience.
- Do not manage categories inside the Calico quick picker; the quick picker should only switch categories and select prompts.
- Treat the Calico quick picker as a clean rounded panel, not a speech bubble. Remove the decorative bottom triangle when adding tabs.
- Keep the quick picker structure as: outer panel padding -> fixed category tabs -> scrollable prompt list -> outer panel padding.
