import type {
  PromptContainer,
  PromptContainerInput,
  PromptEntry,
  PromptItem,
} from "./promptTypes";
import {
  DEFAULT_GROUP_INTERVAL_MS,
  clampGroupIntervalMs,
  normalizePromptTitle,
} from "./promptTypes";

export interface StorageAdapter {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

type PromptStoreDataV1 = {
  version: 1;
  prompts: PromptItem[];
};

type PromptStoreDataV2 = {
  version: 2;
  containers: PromptContainer[];
};

type PromptStoreData = PromptStoreDataV1 | PromptStoreDataV2;

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function entryFromBody(
  body: string,
  order: number,
  id = generateId("entry")
): PromptEntry {
  return {
    id,
    body: body.trim(),
    order,
  };
}

function sortContainers(containers: PromptContainer[]): PromptContainer[] {
  return [...containers].sort((a, b) => a.order - b.order);
}

function sortEntries(entries: PromptEntry[]): PromptEntry[] {
  return [...entries].sort((a, b) => a.order - b.order);
}

function normalizeEntries(
  prompts: Array<{ id?: string; body: string; order?: number }>
): PromptEntry[] {
  return prompts
    .map((prompt, index) => entryFromBody(prompt.body, prompt.order ?? index, prompt.id))
    .filter((prompt) => prompt.body.length > 0)
    .sort((a, b) => a.order - b.order)
    .map((prompt, index) => ({ ...prompt, order: index }));
}

function normalizeContainer(
  input: PromptContainerInput,
  order: number,
  now: string,
  existing?: PromptContainer
): PromptContainer {
  const title = normalizePromptTitle(input.title);
  const prompts = normalizeEntries(input.prompts);
  if (!title || prompts.length === 0) {
    throw new Error("Invalid prompt container data");
  }

  const type = input.type === "group" ? "group" : "single";
  const usablePrompts = type === "single" ? [prompts[0]] : prompts;

  return {
    id: existing?.id ?? generateId("container"),
    title,
    type,
    prompts: usablePrompts.map((prompt, index) => ({ ...prompt, order: index })),
    intervalMs: clampGroupIntervalMs(input.intervalMs ?? existing?.intervalMs),
    order,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

function legacyPromptToContainer(prompt: PromptItem): PromptContainer {
  return {
    id: prompt.id,
    title: prompt.title,
    type: "single",
    prompts: [entryFromBody(prompt.body, 0, `${prompt.id}-entry`)],
    intervalMs: DEFAULT_GROUP_INTERVAL_MS,
    order: prompt.order,
    createdAt: prompt.createdAt,
    updatedAt: prompt.updatedAt,
  };
}

function containerToInput(container: PromptContainer): PromptContainerInput {
  return {
    title: container.title,
    type: container.type,
    prompts: sortEntries(container.prompts).map((prompt) => ({
      id: prompt.id,
      body: prompt.body,
      order: prompt.order,
    })),
    intervalMs: container.intervalMs,
  };
}

function parseContainers(data: string | null): PromptContainer[] {
  if (!data) return [];
  try {
    const parsed = JSON.parse(data) as PromptStoreData;
    if (parsed.version === 1 && Array.isArray(parsed.prompts)) {
      return sortContainers(parsed.prompts.map(legacyPromptToContainer));
    }
    if (parsed.version === 2 && Array.isArray(parsed.containers)) {
      return sortContainers(
        parsed.containers.map((container, index) =>
          normalizeContainer(
            containerToInput(container),
            Number.isFinite(container.order) ? container.order : index,
            container.updatedAt || new Date().toISOString(),
            {
              ...container,
              createdAt: container.createdAt || new Date().toISOString(),
              updatedAt: container.updatedAt || new Date().toISOString(),
            }
          )
        )
      );
    }
  } catch {
    return [];
  }
  return [];
}

function validateImportedContainers(json: string): PromptContainer[] {
  const parsed = JSON.parse(json) as PromptStoreData;
  if (parsed.version === 1 && Array.isArray(parsed.prompts)) {
    const containers = parsed.prompts.map(legacyPromptToContainer);
    containers.forEach((container) => {
      normalizeContainer(containerToInput(container), container.order, container.updatedAt, container);
    });
    return sortContainers(containers);
  }

  if (parsed.version === 2 && Array.isArray(parsed.containers)) {
    return sortContainers(
      parsed.containers.map((container, index) =>
        normalizeContainer(
          containerToInput(container),
          Number.isFinite(container.order) ? container.order : index,
          container.updatedAt || new Date().toISOString(),
          {
            ...container,
            createdAt: container.createdAt || new Date().toISOString(),
            updatedAt: container.updatedAt || new Date().toISOString(),
          }
        )
      )
    );
  }

  throw new Error("Invalid format");
}

export function createPromptStore(adapter: StorageAdapter) {
  async function load(): Promise<PromptContainer[]> {
    return parseContainers(await adapter.read());
  }

  async function save(containers: PromptContainer[]): Promise<void> {
    const data: PromptStoreDataV2 = { version: 2, containers: sortContainers(containers) };
    await adapter.write(JSON.stringify(data, null, 2));
  }

  return {
    async list(): Promise<PromptContainer[]> {
      return load();
    },

    async create(input: { title: string; body: string }): Promise<PromptContainer> {
      const containers = await load();
      const maxOrder = containers.reduce((max, p) => Math.max(max, p.order), -1);
      const now = new Date().toISOString();
      const container = normalizeContainer(
        {
          title: input.title,
          type: "single",
          prompts: [{ body: input.body }],
          intervalMs: DEFAULT_GROUP_INTERVAL_MS,
        },
        maxOrder + 1,
        now
      );
      containers.push(container);
      await save(containers);
      return container;
    },

    async createGroup(input: {
      title: string;
      prompts: Array<{ body: string }>;
      intervalMs?: number;
    }): Promise<PromptContainer> {
      const containers = await load();
      const maxOrder = containers.reduce((max, p) => Math.max(max, p.order), -1);
      const now = new Date().toISOString();
      const container = normalizeContainer(
        {
          title: input.title,
          type: "group",
          prompts: input.prompts,
          intervalMs: input.intervalMs,
        },
        maxOrder + 1,
        now
      );
      containers.push(container);
      await save(containers);
      return container;
    },

    async update(
      id: string,
      input: {
        title?: string;
        body?: string;
        type?: "single" | "group";
        prompts?: Array<{ id?: string; body: string; order?: number }>;
        intervalMs?: number;
      }
    ): Promise<PromptContainer | null> {
      const containers = await load();
      const idx = containers.findIndex((p) => p.id === id);
      if (idx === -1) return null;
      const existing = containers[idx];
      const now = new Date().toISOString();
      const updated = normalizeContainer(
        {
          title: input.title ?? existing.title,
          type: input.type ?? existing.type,
          prompts: input.prompts ?? (
            input.body === undefined
              ? existing.prompts
              : [{ id: existing.prompts[0]?.id, body: input.body, order: 0 }]
          ),
          intervalMs: input.intervalMs ?? existing.intervalMs,
        },
        existing.order,
        now,
        existing
      );
      containers[idx] = updated;
      await save(containers);
      return updated;
    },

    async remove(id: string): Promise<void> {
      const containers = await load();
      await save(containers.filter((p) => p.id !== id));
    },

    async reorder(orderedIds: string[]): Promise<void> {
      const containers = await load();
      const map = new Map(containers.map((p) => [p.id, p]));
      const reordered: PromptContainer[] = [];
      for (const id of orderedIds) {
        const p = map.get(id);
        if (p) reordered.push(p);
      }
      for (const p of containers) {
        if (!orderedIds.includes(p.id)) reordered.push(p);
      }
      const now = new Date().toISOString();
      reordered.forEach((p, i) => {
        p.order = i;
        p.updatedAt = now;
      });
      await save(reordered);
    },

    async exportJson(): Promise<string> {
      const containers = await load();
      const data: PromptStoreDataV2 = { version: 2, containers };
      return JSON.stringify(data, null, 2);
    },

    async importJson(json: string): Promise<void> {
      await save(validateImportedContainers(json));
    }
  };
}
