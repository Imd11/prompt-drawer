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
    expect(css).toContain(".prompt-category-tabs");
    expect(css).toContain(".prompt-quick-list");
    expect(css).toContain("overflow-y: auto");
  });
});
