import { describe, expect, it } from "vitest";
import {
  DEFAULT_GROUP_INTERVAL_MS,
  MAX_GROUP_INTERVAL_MS,
  MIN_GROUP_INTERVAL_MS,
  clampGroupIntervalMs,
  getPromptContainerMeta,
  getPromptContainerPreview,
  getPromptPreview,
  normalizePromptTitle,
} from "./promptTypes";
import type { PromptContainer } from "./promptTypes";

describe("prompt model helpers", () => {
  it("trims prompt titles", () => {
    expect(normalizePromptTitle("  Code Review  ")).toBe("Code Review");
  });

  it("creates a compact preview from the prompt body", () => {
    expect(getPromptPreview("Line one\n\nLine two is longer", 18)).toBe("Line one Line two...");
  });

  it("creates a preview from a single prompt container", () => {
    const container: PromptContainer = {
      id: "single-1",
      title: "Single",
      type: "single",
      prompts: [{ id: "entry-1", body: "Use writing-plans skill.", order: 0 }],
      intervalMs: DEFAULT_GROUP_INTERVAL_MS,
      order: 0,
      createdAt: "2026-07-03T00:00:00.000Z",
      updatedAt: "2026-07-03T00:00:00.000Z",
    };

    expect(getPromptContainerPreview(container)).toBe("Use writing-plans skill.");
    expect(getPromptContainerMeta(container)).toBe("Single · 1 prompt");
  });

  it("creates a numbered preview from a group container without workflow wording", () => {
    const container: PromptContainer = {
      id: "group-1",
      title: "Repair flow",
      type: "group",
      prompts: [
        { id: "entry-2", body: "Write a plan.", order: 1 },
        { id: "entry-1", body: "Analyze the root cause.", order: 0 },
      ],
      intervalMs: 700,
      order: 0,
      createdAt: "2026-07-03T00:00:00.000Z",
      updatedAt: "2026-07-03T00:00:00.000Z",
    };

    expect(getPromptContainerPreview(container)).toContain("1. Analyze the root cause.");
    expect(getPromptContainerPreview(container)).toContain("2. Write a plan.");
    expect(getPromptContainerPreview(container)).not.toContain("Step");
    expect(getPromptContainerMeta(container)).toBe("Group · 2 prompts · 700ms");
  });

  it("keeps group intervals in a milliseconds-level range", () => {
    expect(DEFAULT_GROUP_INTERVAL_MS).toBe(700);
    expect(clampGroupIntervalMs(50)).toBe(MIN_GROUP_INTERVAL_MS);
    expect(clampGroupIntervalMs(10_000)).toBe(MAX_GROUP_INTERVAL_MS);
    expect(clampGroupIntervalMs(undefined)).toBe(DEFAULT_GROUP_INTERVAL_MS);
  });
});
