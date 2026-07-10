import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { acknowledgePromptPopoverMode, setPromptButtonVisibility } from "./platformApi";

describe("platform API", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("routes persistent pet visibility through one native command", async () => {
    invokeMock.mockResolvedValue({
      visible: false,
      applied: true,
      persisted: true,
      error: null,
    });

    await expect(setPromptButtonVisibility(false)).resolves.toMatchObject({
      visible: false,
      applied: true,
      persisted: true,
    });
    expect(invokeMock).toHaveBeenCalledWith("set_prompt_button_visibility", {
      visible: false,
    });
  });

  it("acknowledges the committed popover mode", async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    await acknowledgePromptPopoverMode(7, "button-controls");

    expect(invokeMock).toHaveBeenCalledWith("acknowledge_prompt_popover_mode", {
      requestId: 7,
      mode: "button-controls",
    });
  });
});
