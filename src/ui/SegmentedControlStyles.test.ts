import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "m"));
  return match?.[1] ?? "";
}

describe("segmented control styles", () => {
  it("does not compress the settings segmented control below its selected thumb", () => {
    const settingsBody = ruleBody(".settings-segmented-control");

    expect(settingsBody).not.toMatch(/height\s*:\s*32px/);
  });

  it("does not override selected segmented button text color in prompt manager", () => {
    const managerButtonBody = ruleBody(".prompt-manager .segmented-control button");

    expect(managerButtonBody).not.toMatch(/color\s*:/);
  });

  it("keeps selected segmented buttons white on a dark thumb", () => {
    const selectedBody = ruleBody(".segmented-control button.is-selected");

    expect(selectedBody).toMatch(/background\s*:\s*var\(--pp-text\)/);
    expect(selectedBody).toMatch(/color\s*:\s*#ffffff/);
  });
});
