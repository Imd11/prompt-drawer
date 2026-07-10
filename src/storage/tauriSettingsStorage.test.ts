import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { createTauriSettingsStorage } from "./tauriSettingsStorage";

describe("Tauri settings storage", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("reads through the serialized native settings command", async () => {
    invokeMock.mockResolvedValueOnce('{"version":1}');

    await expect(createTauriSettingsStorage().read()).resolves.toBe('{"version":1}');
    expect(invokeMock).toHaveBeenCalledWith("read_settings_text");
  });

  it("returns null when native settings read fails", async () => {
    invokeMock.mockRejectedValueOnce(new Error("missing"));

    await expect(createTauriSettingsStorage().read()).resolves.toBeNull();
  });

  it("writes through the serialized native settings command", async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    await createTauriSettingsStorage().write('{"version":1}');
    expect(invokeMock).toHaveBeenCalledWith("write_settings_text", {
      value: '{"version":1}',
    });
  });
});
