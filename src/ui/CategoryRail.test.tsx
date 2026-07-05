import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CategoryRail } from "./CategoryRail";

const categories = [
  { id: "cat-dev", name: "开发代码", order: 0, createdAt: "", updatedAt: "" },
  { id: "cat-writing", name: "写作", order: 1, createdAt: "", updatedAt: "" },
];

const messages = {
  title: "Categories",
  newCategory: "New",
  newCategoryName: "Category name",
  newCategoryDefaultName: "New category",
  categoryActions: (name: string) => `More actions for ${name}`,
  renameCategory: "Rename category",
  deleteCategory: "Delete category",
  saveCategory: "Save",
  cancelCategory: "Cancel",
};

function renderRail(overrides: Partial<Parameters<typeof CategoryRail>[0]> = {}) {
  return render(
    <CategoryRail
      categories={categories}
      activeCategoryId="cat-dev"
      counts={{ "cat-dev": 13, "cat-writing": 4 }}
      messages={messages}
      onSelect={() => {}}
      onCreate={() => {}}
      onRename={() => {}}
      onDelete={() => {}}
      {...overrides}
    />
  );
}

describe("CategoryRail", () => {
  it("renders categories with counts and selects a category", () => {
    const onSelect = vi.fn();
    renderRail({ onSelect });

    expect(
      screen.getByRole("button", { name: /开发代码.*13/ }).getAttribute("aria-current")
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /写作.*4/ }));
    expect(onSelect).toHaveBeenCalledWith("cat-writing");
  });

  it("renders category tabs with a compact add row and no permanent action buttons", () => {
    renderRail();

    expect(screen.getByRole("button", { name: /开发代码.*13/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /写作.*4/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New category" }).textContent).toBe("+");
    expect(screen.queryByRole("button", { name: "Rename category" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete category" })).toBeNull();
  });

  it("creates a category from an inline tab with preselected default text", async () => {
    const onCreate = vi.fn();
    renderRail({ onCreate });

    fireEvent.click(screen.getByRole("button", { name: "New category" }));

    const input = screen.getByRole("textbox", { name: /Category name/ }) as HTMLInputElement;
    expect(input.value).toBe("New category");
    await waitFor(() => {
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(input.value.length);
    });

    fireEvent.change(input, { target: { value: "运营" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCreate).toHaveBeenCalledWith("运营");
  });

  it("prefills a unique category name when the default already exists", () => {
    renderRail({
      categories: [
        ...categories,
        { id: "cat-new", name: "New category", order: 2, createdAt: "", updatedAt: "" },
      ],
      counts: { "cat-dev": 13, "cat-writing": 4, "cat-new": 0 },
    });

    fireEvent.click(screen.getByRole("button", { name: "New category" }));

    expect((screen.getByRole("textbox", { name: /Category name/ }) as HTMLInputElement).value).toBe(
      "New category 2"
    );
  });

  it("cancels inline category creation with Escape", () => {
    const onCreate = vi.fn();
    renderRail({ onCreate });

    fireEvent.click(screen.getByRole("button", { name: "New category" }));
    const input = screen.getByRole("textbox", { name: /Category name/ });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: /Category name/ })).toBeNull();
  });

  it("does not submit inline creation while Chinese IME composition is active", () => {
    const onCreate = vi.fn();
    renderRail({ onCreate });

    fireEvent.click(screen.getByRole("button", { name: "New category" }));
    const input = screen.getByRole("textbox", { name: /Category name/ });

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "yun" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCreate).not.toHaveBeenCalled();
  });

  it("renames a category from the row overflow menu", async () => {
    const onRename = vi.fn();
    renderRail({ onRename });

    fireEvent.click(screen.getByRole("button", { name: /More actions for 开发代码/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename category" }));

    const input = screen.getByRole("textbox", { name: /Category name/ }) as HTMLInputElement;
    expect(input.value).toBe("开发代码");
    await waitFor(() => {
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(input.value.length);
    });

    fireEvent.change(input, { target: { value: "研发" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onRename).toHaveBeenCalledWith("cat-dev", "研发");
  });

  it("confirms delete from the row overflow menu before calling onDelete", () => {
    const onDelete = vi.fn();
    renderRail({ onDelete });

    fireEvent.click(screen.getByRole("button", { name: /More actions for 开发代码/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete category" }));

    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete category" }));

    expect(onDelete).toHaveBeenCalledWith("cat-dev");
  });

  it("closes the row menu with Escape", () => {
    renderRail();

    fireEvent.click(screen.getByRole("button", { name: /More actions for 开发代码/ }));
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows a category action error", () => {
    renderRail({ actionError: "Cannot remove category with prompts" });

    expect(screen.getByRole("status").textContent).toContain("Cannot remove category with prompts");
  });
});
