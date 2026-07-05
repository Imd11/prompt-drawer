import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

describe("popover styles", () => {
  const css = readFileSync("src/styles.css", "utf8");
  const rule = (selector: string) => {
    const match = css.match(new RegExp(`${selector.replace(".", "\\.")}\\s*{[^}]*}`));
    return match?.[0] ?? "";
  };

  it("does not draw an outer rectangular popover gutter or shadow", () => {
    const rootRule = rule(".popover-root");
    const windowRule = rule(".popover-window");

    expect(css).toContain("--pp-popover-window-padding: 0px");
    expect(rootRule).toContain("padding: 0");
    expect(windowRule).toContain("box-shadow: none");
    expect(windowRule).not.toContain("box-shadow: var(--pp-shadow-popover)");
  });
});
