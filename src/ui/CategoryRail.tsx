import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { PromptCategory } from "../shared/promptTypes";

export type CategoryRailMessages = {
  title: string;
  newCategory: string;
  newCategoryName: string;
  newCategoryDefaultName: string;
  categoryActions: (name: string) => string;
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

type EditMode =
  | { kind: "idle" }
  | { kind: "create"; value: string }
  | { kind: "rename"; categoryId: string; value: string };

export function CategoryRail({
  categories,
  activeCategoryId,
  counts,
  messages,
  getCategoryDisplayName,
  actionError = null,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: CategoryRailProps) {
  const [editMode, setEditMode] = useState<EditMode>({ kind: "idle" });
  const [menuCategoryId, setMenuCategoryId] = useState<string | null>(null);
  const [deleteConfirmCategoryId, setDeleteConfirmCategoryId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const composingRef = useRef(false);
  const suppressNextBlurSubmitRef = useRef(false);

  useEffect(() => {
    setEditMode({ kind: "idle" });
    setMenuCategoryId(null);
    setDeleteConfirmCategoryId(null);
  }, [activeCategoryId]);

  const displayName = (category: PromptCategory) =>
    getCategoryDisplayName?.(category) ?? category.name;

  const uniqueCategoryName = (baseName: string, ignoredCategoryId?: string) => {
    const usedNames = new Set(
      categories
        .filter((category) => category.id !== ignoredCategoryId)
        .map((category) => displayName(category).trim())
    );
    if (!usedNames.has(baseName)) return baseName;
    let suffix = 2;
    while (usedNames.has(`${baseName} ${suffix}`)) {
      suffix += 1;
    }
    return `${baseName} ${suffix}`;
  };

  const beginCreate = () => {
    suppressNextBlurSubmitRef.current = false;
    setMenuCategoryId(null);
    setDeleteConfirmCategoryId(null);
    setEditMode({
      kind: "create",
      value: uniqueCategoryName(messages.newCategoryDefaultName),
    });
  };

  const beginRename = (category: PromptCategory) => {
    suppressNextBlurSubmitRef.current = false;
    setMenuCategoryId(null);
    setDeleteConfirmCategoryId(null);
    setEditMode({
      kind: "rename",
      categoryId: category.id,
      value: displayName(category),
    });
  };

  useEffect(() => {
    if (editMode.kind === "idle") return;
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [editMode]);

  const cancelEdit = () => {
    suppressNextBlurSubmitRef.current = true;
    setEditMode({ kind: "idle" });
  };

  const submit = () => {
    if (editMode.kind === "idle") return;
    const value = editMode.value.trim();
    if (!value) {
      setEditMode({ kind: "idle" });
      return;
    }
    suppressNextBlurSubmitRef.current = true;
    if (editMode.kind === "create") {
      void Promise.resolve(onCreate(uniqueCategoryName(value))).then(() => {
        setEditMode({ kind: "idle" });
      });
      return;
    }
    void Promise.resolve(
      onRename(editMode.categoryId, uniqueCategoryName(value, editMode.categoryId))
    ).then(() => {
      setEditMode({ kind: "idle" });
    });
  };

  const handleInputBlur = () => {
    if (suppressNextBlurSubmitRef.current) {
      suppressNextBlurSubmitRef.current = false;
      return;
    }
    submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEdit();
      return;
    }
    if (event.key !== "Enter" || composingRef.current) return;
    event.preventDefault();
    submit();
  };

  return (
    <aside className="category-rail">
      <h2>{messages.title}</h2>
      <div className="category-rail-list">
        {categories.map((category) => {
          const name = displayName(category);
          return (
            <div
              key={category.id}
              className={`category-rail-row ${category.id === activeCategoryId ? "is-active" : ""}`}
            >
              <button
                className="category-rail-item"
                type="button"
                aria-current={category.id === activeCategoryId ? "true" : undefined}
                onClick={() => {
                  setMenuCategoryId(null);
                  setDeleteConfirmCategoryId(null);
                  onSelect(category.id);
                }}
              >
                <span>{name}</span>
                <span>{counts[category.id] ?? 0}</span>
              </button>
              <button
                aria-label={messages.categoryActions(name)}
                className="category-rail-menu-trigger"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setMenuCategoryId(menuCategoryId === category.id ? null : category.id);
                  setDeleteConfirmCategoryId(null);
                }}
              >
                {"⋯"}
              </button>
              {menuCategoryId === category.id ? (
                <div
                  className="category-rail-menu"
                  role="menu"
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setMenuCategoryId(null);
                    }
                  }}
                >
                  <button role="menuitem" type="button" onClick={() => beginRename(category)}>
                    {messages.renameCategory}
                  </button>
                  <button
                    role="menuitem"
                    type="button"
                    className="is-danger"
                    onClick={() => {
                      setMenuCategoryId(null);
                      setDeleteConfirmCategoryId(category.id);
                    }}
                  >
                    {messages.deleteCategory}
                  </button>
                </div>
              ) : null}
              {deleteConfirmCategoryId === category.id ? (
                <div className="category-rail-delete-confirm" role="alert">
                  <span>{messages.deleteCategory}?</span>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => setDeleteConfirmCategoryId(null)}
                  >
                    {messages.cancelCategory}
                  </button>
                  <button
                    type="button"
                    className="button button-ghost-danger"
                    onClick={() => {
                      void Promise.resolve(onDelete(category.id)).then(() => {
                        setDeleteConfirmCategoryId(null);
                      });
                    }}
                  >
                    {messages.deleteCategory}
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
        {editMode.kind !== "idle" ? (
          <div className="category-rail-edit-row">
            <input
              ref={inputRef}
              className="field category-rail-input"
              aria-label={messages.newCategoryName}
              value={editMode.value}
              onBlur={handleInputBlur}
              onChange={(event) => setEditMode({ ...editMode, value: event.target.value })}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={() => {
                composingRef.current = false;
              }}
              onKeyDown={handleKeyDown}
            />
          </div>
        ) : null}
        <button
          className="category-rail-add"
          type="button"
          aria-label={messages.newCategoryDefaultName}
          onClick={beginCreate}
        >
          +
        </button>
      </div>
      {actionError ? (
        <div className="category-rail-error" role="status" aria-live="polite">
          {actionError}
        </div>
      ) : null}
    </aside>
  );
}
