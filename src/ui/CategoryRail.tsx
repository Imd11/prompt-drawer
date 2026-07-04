import { useEffect, useRef, useState, type KeyboardEvent } from "react";
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
  const composingRef = useRef(false);
  const activeCategory = categories.find((category) => category.id === activeCategoryId) ?? null;

  useEffect(() => {
    setEditMode({ kind: "idle" });
  }, [activeCategoryId]);

  const displayName = (category: PromptCategory) =>
    getCategoryDisplayName?.(category) ?? category.name;

  const submit = () => {
    if (editMode.kind === "idle") return;
    const value = editMode.value.trim();
    if (!value) return;
    if (editMode.kind === "create") {
      void Promise.resolve(onCreate(value)).then(() => {
        setEditMode({ kind: "idle" });
      });
      return;
    }
    void Promise.resolve(onRename(editMode.categoryId, value)).then(() => {
      setEditMode({ kind: "idle" });
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || composingRef.current) return;
    event.preventDefault();
    submit();
  };

  const inputMode = editMode.kind !== "idle";

  return (
    <aside className="category-rail">
      <h2>{messages.title}</h2>
      <div className="category-rail-list">
        {categories.map((category) => (
          <button
            key={category.id}
            className={`category-rail-item ${category.id === activeCategoryId ? "is-active" : ""}`}
            type="button"
            aria-current={category.id === activeCategoryId ? "true" : undefined}
            onClick={() => onSelect(category.id)}
          >
            <span>{displayName(category)}</span>
            <span>{counts[category.id] ?? 0}</span>
          </button>
        ))}
      </div>
      {inputMode ? (
        <div className="category-rail-editor">
          <input
            className="field category-rail-input"
            aria-label={messages.newCategoryName}
            value={editMode.value}
            onChange={(event) => setEditMode({ ...editMode, value: event.target.value })}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            onKeyDown={handleKeyDown}
          />
          <div className="category-rail-editor-actions">
            <button className="button button-secondary" type="button" onClick={submit}>
              {messages.saveCategory}
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => setEditMode({ kind: "idle" })}
            >
              {messages.cancelCategory}
            </button>
          </div>
        </div>
      ) : (
        <button
          className="category-rail-new"
          type="button"
          onClick={() => setEditMode({ kind: "create", value: "" })}
        >
          + {messages.newCategory}
        </button>
      )}
      {activeCategory && editMode.kind === "idle" ? (
        <div className="category-rail-actions">
          <button
            className="button button-secondary"
            type="button"
            onClick={() =>
              setEditMode({
                kind: "rename",
                categoryId: activeCategory.id,
                value: displayName(activeCategory),
              })
            }
          >
            {messages.renameCategory}
          </button>
          <button
            className="button button-ghost-danger"
            type="button"
            onClick={() => onDelete(activeCategory.id)}
          >
            {messages.deleteCategory}
          </button>
        </div>
      ) : null}
      {actionError ? (
        <div className="category-rail-error" role="status" aria-live="polite">
          {actionError}
        </div>
      ) : null}
    </aside>
  );
}
