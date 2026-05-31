import { useState } from "react";
import type { PromptItem } from "../shared/promptTypes";

interface PromptManagerProps {
  prompts: PromptItem[];
  onCreate: (input: { title: string; body: string }) => void;
  onUpdate: (id: string, input: { title?: string; body?: string }) => void;
  onDelete: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onImport: () => void;
  onExport: () => void;
}

export function PromptManager({
  prompts,
  onCreate,
  onUpdate,
  onDelete,
  onReorder,
  onImport,
  onExport
}: PromptManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");

  const handleCreate = () => {
    if (newTitle.trim() && newBody.trim()) {
      onCreate({ title: newTitle.trim(), body: newBody.trim() });
      setNewTitle("");
      setNewBody("");
    }
  };

  const handleSaveEdit = (id: string) => {
    if (newTitle.trim() && newBody.trim()) {
      onUpdate(id, { title: newTitle.trim(), body: newBody.trim() });
      setEditingId(null);
      setNewTitle("");
      setNewBody("");
    }
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const newOrder = [...prompts.map((p) => p.id)];
    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    onReorder(newOrder);
  };

  const handleMoveDown = (index: number) => {
    if (index === prompts.length - 1) return;
    const newOrder = [...prompts.map((p) => p.id)];
    [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
    onReorder(newOrder);
  };

  return (
    <div className="prompt-manager page-stack">
      <header className="page-header">
        <div>
          <h1>Manage Prompts</h1>
          <p>{prompts.length} prompts in your local library.</p>
        </div>
        <div className="toolbar">
          <button className="button button-secondary" onClick={onImport}>
            Import
          </button>
          <button className="button button-secondary" onClick={onExport}>
            Export
          </button>
        </div>
      </header>

      <section className="editor-panel">
        <div className="section-heading">
          <h2>New Prompt</h2>
          <p>Add a reusable prompt to the quick picker.</p>
        </div>
        <input
          className="field"
          type="text"
          placeholder="Title"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
        />
        <textarea
          className="field prompt-body-field"
          placeholder="Prompt body..."
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
        />
        <button className="button button-primary editor-submit" onClick={handleCreate}>
          Add Prompt
        </button>
      </section>

      <section className="list-panel">
        <div className="section-heading">
          <h2>Prompt List</h2>
          <p>Choose the order used by the floating picker.</p>
        </div>
        <div className="prompt-list">
          {prompts.length === 0 ? (
            <div className="empty-state-block">No prompts yet</div>
          ) : prompts.map((prompt, index) => (
            <div key={prompt.id} className="prompt-item">
            {editingId === prompt.id ? (
              <div className="edit-form">
                <input
                  className="field"
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                />
                <textarea
                  className="field prompt-body-field"
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                />
                <div className="edit-actions">
                  <button
                    className="button button-primary"
                    onClick={() => handleSaveEdit(prompt.id)}
                  >
                    Save
                  </button>
                  <button
                    className="button button-secondary"
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : deleteConfirmId === prompt.id ? (
              <div className="delete-confirm">
                <span>Delete this prompt?</span>
                <div className="confirm-actions">
                  <button
                    className="button button-danger"
                    onClick={() => { onDelete(prompt.id); setDeleteConfirmId(null); }}
                  >
                    Confirm
                  </button>
                  <button
                    className="button button-secondary"
                    onClick={() => setDeleteConfirmId(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="prompt-content">
                <div className="prompt-info">
                  <strong>{prompt.title}</strong>
                  <span className="prompt-preview">{prompt.body.slice(0, 96)}...</span>
                </div>
                <div className="prompt-actions">
                  <button
                    className="button icon-button"
                    onClick={() => handleMoveUp(index)}
                    disabled={index === 0}
                  >
                    ↑
                  </button>
                  <button
                    className="button icon-button"
                    onClick={() => handleMoveDown(index)}
                    disabled={index === prompts.length - 1}
                  >
                    ↓
                  </button>
                  <button
                    className="button button-secondary"
                    onClick={() => { setEditingId(prompt.id); setNewTitle(prompt.title); setNewBody(prompt.body); }}
                  >
                    Edit
                  </button>
                  <button
                    className="button button-ghost-danger"
                    onClick={() => setDeleteConfirmId(prompt.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
