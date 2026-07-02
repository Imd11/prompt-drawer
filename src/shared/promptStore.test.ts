import { describe, expect, it } from "vitest";
import { createPromptStore } from "./promptStore";

function createTestStore() {
  let state: string | null = null;
  return createPromptStore({
    read: async () => state,
    write: async (value) => {
      state = value;
    }
  });
}

describe("prompt store", () => {
  it("creates and lists prompt containers in manual order", async () => {
    const store = createTestStore();
    await store.create({ title: "B", body: "second" });
    await store.create({ title: "A", body: "first" });

    expect((await store.list()).map((p) => p.title)).toEqual(["B", "A"]);
  });

  it("create assigns id, order, and a single prompt entry", async () => {
    const store = createTestStore();
    const prompt = await store.create({ title: "Test", body: "body" });

    expect(prompt.id).toBeDefined();
    expect(typeof prompt.order).toBe("number");
    expect(prompt.title).toBe("Test");
    expect(prompt.type).toBe("single");
    expect(prompt.prompts[0].body).toBe("body");
  });

  it("creates grouped prompt containers with ordered entries", async () => {
    const store = createTestStore();

    const group = await store.createGroup({
      title: "Repair flow",
      intervalMs: 450,
      prompts: [
        { body: "First prompt" },
        { body: "Second prompt" },
      ],
    });

    expect(group.type).toBe("group");
    expect(group.intervalMs).toBe(450);
    expect(group.prompts.map((prompt) => prompt.body)).toEqual([
      "First prompt",
      "Second prompt",
    ]);
  });

  it("update changes title and body", async () => {
    const store = createTestStore();
    const created = await store.create({ title: "Original", body: "original body" });
    const updated = await store.update(created.id, { title: "Updated", body: "updated body" });

    expect(updated?.title).toBe("Updated");
    expect(updated?.prompts[0].body).toBe("updated body");
  });

  it("update can replace group prompt entries", async () => {
    const store = createTestStore();
    const created = await store.createGroup({
      title: "Original group",
      prompts: [{ body: "one" }, { body: "two" }],
    });

    const updated = await store.update(created.id, {
      title: "Updated group",
      intervalMs: 900,
      prompts: [{ body: "new one" }, { body: "new two" }, { body: "new three" }],
    });

    expect(updated?.title).toBe("Updated group");
    expect(updated?.intervalMs).toBe(900);
    expect(updated?.prompts.map((prompt) => prompt.body)).toEqual([
      "new one",
      "new two",
      "new three",
    ]);
  });

  it("delete removes item", async () => {
    const store = createTestStore();
    const created = await store.create({ title: "ToDelete", body: "body" });
    await store.remove(created.id);

    expect(await store.list()).toHaveLength(0);
  });

  it("reorder persists new order", async () => {
    const store = createTestStore();
    const first = await store.create({ title: "First", body: "first" });
    const second = await store.create({ title: "Second", body: "second" });

    await store.reorder([second.id, first.id]);

    const list = await store.list();
    expect(list.map((p) => p.title)).toEqual(["Second", "First"]);
  });

  it("export returns portable JSON", async () => {
    const store = createTestStore();
    await store.create({ title: "A", body: "a" });

    const json = await store.exportJson();
    const data = JSON.parse(json);

    expect(data.version).toBe(2);
    expect(Array.isArray(data.containers)).toBe(true);
  });

  it("import replaces containers with valid imported v2 data", async () => {
    const store = createTestStore();
    await store.create({ title: "Original", body: "original" });

    const imported = JSON.stringify({
      version: 2,
      containers: [
        {
          id: "imported-1",
          title: "Imported",
          type: "single",
          prompts: [{ id: "entry-1", body: "imported body", order: 0 }],
          intervalMs: 700,
          order: 0,
          createdAt: "2026-05-26T00:00:00.000Z",
          updatedAt: "2026-05-26T00:00:00.000Z"
        }
      ]
    });

    await store.importJson(imported);

    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("Imported");
  });

  it("loads legacy v1 prompts as single containers", async () => {
    const store = createTestStore();
    await store.importJson(JSON.stringify({
      version: 1,
      prompts: [
        {
          id: "legacy-1",
          title: "Legacy",
          body: "legacy body",
          order: 0,
          createdAt: "2026-05-26T00:00:00.000Z",
          updatedAt: "2026-05-26T00:00:00.000Z"
        }
      ]
    }));

    const list = await store.list();
    expect(list[0].type).toBe("single");
    expect(list[0].prompts[0].body).toBe("legacy body");
  });
});
