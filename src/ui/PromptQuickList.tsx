import { useState } from "react";
import type { PromptContainer } from "../shared/promptTypes";
import {
  getPromptContainerBodies,
  getPromptContainerMeta,
  getPromptContainerPreviewLines,
} from "../shared/promptTypes";

interface PromptQuickListProps {
  prompts: PromptContainer[];
  onSelect: (prompt: PromptContainer) => void;
  submittingPromptId?: string | null;
}

type HoverPreviewState = {
  promptId: string;
  top: number;
  placement: "above" | "below";
};

const HOVER_PREVIEW_MAX_HEIGHT = 180;
const HOVER_PREVIEW_MIN_USEFUL_SPACE = 120;
const HOVER_PREVIEW_GAP = 8;
const HOVER_PREVIEW_MARGIN = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function PromptQuickList({
  prompts,
  onSelect,
  submittingPromptId = null,
}: PromptQuickListProps) {
  const [hoverPreview, setHoverPreview] = useState<HoverPreviewState | null>(null);
  const hoveredPrompt = prompts.find((prompt) => prompt.id === hoverPreview?.promptId) ?? null;

  function showHoverPreview(prompt: PromptContainer, target: HTMLElement) {
    const shell = target.closest(".prompt-quick-shell") as HTMLElement | null;
    const targetRect = target.getBoundingClientRect();
    const shellRect = shell?.getBoundingClientRect();
    const shellHeight = Math.max(
      shellRect?.height ?? 0,
      shell?.clientHeight ?? 0,
      320
    );
    const localTop = shellRect ? targetRect.top - shellRect.top : target.offsetTop;
    const targetBottom = localTop + targetRect.height;
    const availableBelow = shellHeight - targetBottom - HOVER_PREVIEW_GAP - HOVER_PREVIEW_MARGIN;
    const availableAbove = localTop - HOVER_PREVIEW_GAP - HOVER_PREVIEW_MARGIN;
    const placement =
      availableBelow >= HOVER_PREVIEW_MIN_USEFUL_SPACE || availableBelow >= availableAbove
        ? "below"
        : "above";
    const idealTop = placement === "below"
      ? targetBottom + HOVER_PREVIEW_GAP
      : localTop - HOVER_PREVIEW_GAP - HOVER_PREVIEW_MAX_HEIGHT;
    const maxTop = Math.max(
      HOVER_PREVIEW_MARGIN,
      shellHeight - HOVER_PREVIEW_MAX_HEIGHT - HOVER_PREVIEW_MARGIN
    );

    setHoverPreview({
      promptId: prompt.id,
      top: clamp(idealTop, HOVER_PREVIEW_MARGIN, maxTop),
      placement,
    });
  }

  return (
    <div className="prompt-quick-shell">
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
              className={`prompt-quick-item ${
                prompt.type === "group" ? "prompt-quick-item-group" : ""
              }`}
              type="button"
              role="option"
              aria-selected="false"
              disabled={submittingPromptId === prompt.id}
              onMouseEnter={(event) => showHoverPreview(prompt, event.currentTarget)}
              onMouseLeave={() => setHoverPreview(null)}
              onFocus={(event) => showHoverPreview(prompt, event.currentTarget)}
              onBlur={() => setHoverPreview(null)}
              onClick={() => onSelect(prompt)}
            >
              <span className="prompt-quick-title-row">
                <span className="prompt-quick-title">{prompt.title}</span>
                {prompt.type === "group" ? (
                  <span className="prompt-quick-meta">{getPromptContainerMeta(prompt)}</span>
                ) : null}
              </span>
              <span className="prompt-quick-preview-lines">
                {getPromptContainerPreviewLines(prompt).map((line) => (
                  <span className="prompt-quick-preview-line" key={line}>
                    {line}
                  </span>
                ))}
              </span>
            </button>
          ))
        )}
      </div>
      {hoveredPrompt && hoverPreview ? (
        <PromptHoverPreview
          prompt={hoveredPrompt}
          top={hoverPreview.top}
          placement={hoverPreview.placement}
        />
      ) : null}
    </div>
  );
}

function PromptHoverPreview({
  prompt,
  top,
  placement,
}: {
  prompt: PromptContainer;
  top: number;
  placement: "above" | "below";
}) {
  const bodies = getPromptContainerBodies(prompt);

  return (
    <aside
      className={`prompt-hover-preview prompt-hover-preview-floating ${
        placement === "above" ? "is-above" : "is-below"
      }`}
      role="tooltip"
      style={{ top }}
    >
      <div className="prompt-hover-preview-header">
        <strong>{prompt.title}</strong>
        {prompt.type === "group" ? <span>{getPromptContainerMeta(prompt)}</span> : null}
      </div>
      <div className="prompt-hover-preview-body">
        {prompt.type === "group" ? (
          bodies.map((body, index) => (
            <p key={`${index}-${body}`}>
              {index + 1}. {body}
            </p>
          ))
        ) : (
          <p>{bodies[0] ?? ""}</p>
        )}
      </div>
    </aside>
  );
}
