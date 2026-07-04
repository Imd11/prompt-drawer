import type { PromptContainer } from "./promptTypes";
import { DEFAULT_GROUP_INTERVAL_MS } from "./promptTypes";

export const samplePrompts: PromptContainer[] = [
  {
    id: "sample-code-review",
    categoryId: "category-default",
    title: "Code Review",
    type: "single",
    prompts: [
      {
        id: "sample-code-review-entry",
        body: "Review this code for bugs, regressions, missing tests, and maintainability issues.",
        order: 0,
      },
    ],
    intervalMs: DEFAULT_GROUP_INTERVAL_MS,
    order: 0,
    createdAt: "2026-05-26T00:00:00.000Z",
    updatedAt: "2026-05-26T00:00:00.000Z"
  }
];
