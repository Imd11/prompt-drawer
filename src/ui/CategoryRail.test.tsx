import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CategoryRail } from "./CategoryRail";

const categories = [
  { id: "cat-dev", name: "开发代码", order: 0, createdAt: "", updatedAt: "" },
  { id: "cat-writing", name: "写作", order: 1, createdAt: "", updatedAt: "" },
];

const messages = {
  title: "Categories",
  newCategory: "New",
  newCategoryName: "New category name",
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

  it("creates a category inline", () => {
    const onCreate = vi.fn();
    renderRail({ onCreate });

    fireEvent.click(screen.getByRole("button", { name: /\+ New/ }));
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
    renderRail({ onCreate });

    fireEvent.click(screen.getByRole("button", { name: /\+ New/ }));
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
    renderRail({ actionError: "Cannot remove category with prompts" });

    expect(screen.getByRole("status").textContent).toContain("Cannot remove category with prompts");
  });
});
