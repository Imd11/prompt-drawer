import type { PromptItem } from "../shared/promptTypes";
import { getPromptPreview } from "../shared/promptTypes";

interface PromptQuickListProps {
  prompts: PromptItem[];
  onSelect: (prompt: PromptItem) => void;
}

export function PromptQuickList({ prompts, onSelect }: PromptQuickListProps) {
  return (
    <div className="prompt-quick-list" role="listbox" aria-label="Prompts">
      {prompts.length === 0 ? (
        <div className="prompt-quick-empty">
          <strong>No prompts yet</strong>
          <span>Open Prompt Picker to create your first prompt.</span>
        </div>
      ) : (
        prompts.map((prompt) => (
          <button
            key={prompt.id}
            className="prompt-quick-item"
            type="button"
            onClick={() => onSelect(prompt)}
          >
            <span className="prompt-quick-title">{prompt.title}</span>
            <span className="prompt-quick-preview">{getPromptPreview(prompt.body)}</span>
          </button>
        ))
      )}
    </div>
  );
}
