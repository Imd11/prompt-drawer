import { invoke } from "@tauri-apps/api/core";

export function createTauriSettingsStorage() {
  return {
    async read(): Promise<string | null> {
      try {
        return await invoke<string | null>("read_settings_text");
      } catch {
        return null;
      }
    },

    async write(value: string): Promise<void> {
      await invoke("write_settings_text", { value });
    }
  };
}
