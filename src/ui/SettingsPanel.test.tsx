import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsPanel } from "./SettingsPanel";
import type { PromptInsertionMode, Settings } from "../shared/settingsStore";

describe("settings panel", () => {
  const mockSettings: Settings = {
    version: 1,
    blacklistedApps: [
      { bundleId: "com.example.app", name: "Example App" }
    ],
    overlayPlacement: { buttonOffset: null, buttonPosition: null },
    floatingButton: { visible: true },
    promptInsertion: { mode: "paste_and_submit" },
  };

  function renderPanel(
    settings: Settings = mockSettings,
    onPromptInsertionModeChange: (mode: PromptInsertionMode) => void = () => {}
  ) {
    render(
      <SettingsPanel
        settings={settings}
        onRemove={() => {}}
        onPromptInsertionModeChange={onPromptInsertionModeChange}
      />
    );
  }

  it("renders blacklisted apps", () => {
    renderPanel();
    expect(screen.getByText("Example App")).toBeTruthy();
  });

  it("remove button calls onRemove with bundle id", () => {
    let removedBundleId: string | null = null;
    render(
      <SettingsPanel
        settings={mockSettings}
        onRemove={(id) => { removedBundleId = id; }}
        onPromptInsertionModeChange={() => {}}
      />
    );

    const removeBtn = screen.getByRole("button", { name: "Remove" });
    removeBtn.click();
    expect(removedBundleId).toBe("com.example.app");
  });

  it("empty state renders when no blacklisted apps", () => {
    renderPanel({
      version: 1,
      blacklistedApps: [],
      overlayPlacement: { buttonOffset: null, buttonPosition: null },
      floatingButton: { visible: true },
      promptInsertion: { mode: "paste_and_submit" },
    });
    expect(screen.getByText("No blacklisted apps")).toBeTruthy();
  });

  it("renders prompt insertion behavior controls", () => {
    renderPanel();

    expect(screen.getByRole("button", { name: "Paste only" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Paste + Return" }).getAttribute(
      "aria-pressed"
    )).toBe("true");
  });

  it("changes prompt insertion mode", () => {
    let selectedMode: PromptInsertionMode | null = null;
    renderPanel(mockSettings, (mode) => { selectedMode = mode; });

    fireEvent.click(screen.getByRole("button", { name: "Paste only" }));

    expect(selectedMode).toBe("paste_only");
  });
});
