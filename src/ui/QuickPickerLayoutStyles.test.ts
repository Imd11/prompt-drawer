import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

describe("quick picker layout styles", () => {
  const css = readFileSync("src/styles.css", "utf8");
  const rule = (selector: string) => {
    const match = css.match(new RegExp(`${selector.replace(".", "\\.")}\\s*{[^}]*}`));
    return match?.[0] ?? "";
  };

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

  it("keeps the rounded popover panel flush with the native popover window", () => {
    const rootRule = rule(".popover-root");
    const windowRule = rule(".popover-window");

    expect(css).toContain("--pp-popover-window-padding: 0px");
    expect(rootRule).toContain("padding: 0");
    expect(windowRule).toContain("width: 100%");
    expect(windowRule).toContain("height: 100%");
    expect(windowRule).toContain("box-shadow: none");
    expect(windowRule).not.toContain("box-shadow: var(--pp-shadow-popover)");
    expect(windowRule).not.toContain("width: 100vw");
    expect(windowRule).not.toContain("min-height: 100vh");
  });
});
