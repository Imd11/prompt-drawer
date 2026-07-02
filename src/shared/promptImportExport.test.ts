import { describe, expect, it } from "vitest";
import { createPromptStore } from "./promptStore";

function createTestStore(initial?: string | null) {
  let state = initial ?? null;
  return createPromptStore({
    read: async () => state,
    write: async (value) => { state = value; }
  });
}

describe("prompt import export", () => {
  it("export includes version and prompts", async () => {
    const store = createTestStore();
    await store.create({ title: "A", body: "a" });

    const json = await store.exportJson();
    const data = JSON.parse(json);

    expect(data.version).toBe(2);
    expect(Array.isArray(data.containers)).toBe(true);
  });

  it("import rejects malformed JSON", async () => {
    const store = createTestStore();

    await expect(store.importJson("not json")).rejects.toThrow();
  });

  it("import rejects prompt containers without usable title/body", async () => {
    const store = createTestStore();

    await expect(store.importJson(JSON.stringify({
      version: 2,
      containers: [{ id: "1", title: "", type: "single", prompts: [] }]
    }))).rejects.toThrow();
  });

  it("import preserves manual order for v2 containers", async () => {
    const store = createTestStore();
    await store.create({ title: "Original", body: "original" });

    const imported = JSON.stringify({
      version: 2,
      containers: [
        { id: "imported-1", title: "First", type: "single", prompts: [{ id: "entry-1", body: "first", order: 0 }], intervalMs: 700, order: 0, createdAt: "2026-05-26T00:00:00.000Z", updatedAt: "2026-05-26T00:00:00.000Z" },
        { id: "imported-2", title: "Second", type: "single", prompts: [{ id: "entry-2", body: "second", order: 0 }], intervalMs: 700, order: 1, createdAt: "2026-05-26T00:00:00.000Z", updatedAt: "2026-05-26T00:00:00.000Z" }
      ]
    });

    await store.importJson(imported);

    const list = await store.list();
    expect(list.map(p => p.title)).toEqual(["First", "Second"]);
  });

  it("import accepts legacy v1 prompt exports", async () => {
    const store = createTestStore();

    await store.importJson(JSON.stringify({
      version: 1,
      prompts: [
        { id: "legacy-1", title: "Legacy", body: "legacy body", order: 0, createdAt: "2026-05-26T00:00:00.000Z", updatedAt: "2026-05-26T00:00:00.000Z" }
      ]
    }));

    const list = await store.list();
    expect(list[0].type).toBe("single");
    expect(list[0].prompts[0].body).toBe("legacy body");
  });
});
