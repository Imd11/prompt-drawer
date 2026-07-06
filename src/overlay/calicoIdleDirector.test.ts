import { describe, expect, it, vi } from "vitest";

const protectedStates = [
  "react-drag",
  "happy",
  "thinking",
  "working-typing",
  "working-conducting",
  "working-juggling",
  "working-building",
  "working-carrying",
  "working-sweeping",
  "notification",
  "error",
];

type IdleRhythmPhase = {
  name: "early" | "settled" | "longIdle" | "deepIdle";
  availableAfterMs: number;
  delayRangeMs: [number, number];
};

type IdleMotionPoolEntry = {
  state: string;
  category: "light" | "life" | "mini" | "rest" | "attention";
  weights: Record<IdleRhythmPhase["name"], number>;
};

type IdleDirectorPayload = {
  state: string;
  priority?: number;
  reason?: string;
  durationMs?: number;
};

type IdleDirectorModule = {
  IDLE_RHYTHM_PHASES: IdleRhythmPhase[];
  IDLE_MOTION_POOL: IdleMotionPoolEntry[];
  createCalicoIdleDirector(options: {
    applyMotion: (payload: IdleDirectorPayload) => boolean;
    resetMotion: () => void;
    getCurrentState: () => string;
    isUserActive: () => boolean;
    random?: () => number;
    setTimeout?: typeof window.setTimeout;
    clearTimeout?: typeof window.clearTimeout;
    now?: () => number;
    motionDurations?: Record<string, number>;
  }): {
    start(): void;
    stop(): void;
    pause(durationMs?: number): void;
    resetIdleClock(): void;
    resetToBaseline(): void;
    handleAttention(): boolean;
  };
};

async function loadDirectorModule() {
  // @ts-expect-error public overlay module is intentionally outside the src build graph.
  return (await import("../../public/calico/idle-director.js")) as IdleDirectorModule;
}

describe("Calico idle director", () => {
  it("uses short rhythm delays instead of long hard-tier pauses", async () => {
    const { IDLE_RHYTHM_PHASES } = await loadDirectorModule();

    expect(IDLE_RHYTHM_PHASES).toEqual([
      { name: "early", availableAfterMs: 7_000, delayRangeMs: [2_500, 5_000] },
      { name: "settled", availableAfterMs: 30_000, delayRangeMs: [2_000, 4_500] },
      { name: "longIdle", availableAfterMs: 90_000, delayRangeMs: [3_000, 6_000] },
      { name: "deepIdle", availableAfterMs: 10 * 60_000, delayRangeMs: [45_000, 90_000] },
    ]);
  });

  it("uses a weighted idle pool without protected semantic motions", async () => {
    const { IDLE_MOTION_POOL } = await loadDirectorModule();
    const states = IDLE_MOTION_POOL.map((entry) => entry.state);

    expect(new Set(states).size).toBe(states.length);
    expect(states).toEqual(
      expect.arrayContaining([
        "idle",
        "yawning",
        "dozing",
        "collapsing",
        "sleeping",
        "waking",
        "react-poke",
        "react-left",
        "mini-enter",
        "mini-idle",
        "mini-peek",
        "mini-alert",
        "mini-happy",
        "mini-crabwalk",
        "mini-sleep",
      ])
    );
    for (const state of protectedStates) {
      expect(states).not.toContain(state);
    }
  });

  it("does not allow sleep states during early idle", async () => {
    const { IDLE_MOTION_POOL } = await loadDirectorModule();
    const sleeping = IDLE_MOTION_POOL.find((entry) => entry.state === "sleeping");
    const miniSleep = IDLE_MOTION_POOL.find((entry) => entry.state === "mini-sleep");

    expect(sleeping?.weights.early).toBe(0);
    expect(miniSleep?.weights.early).toBe(0);
  });

  it("raises rest and mini weights during long idle", async () => {
    const { IDLE_MOTION_POOL } = await loadDirectorModule();
    const sleeping = IDLE_MOTION_POOL.find((entry) => entry.state === "sleeping");
    const miniSleep = IDLE_MOTION_POOL.find((entry) => entry.state === "mini-sleep");
    const yawning = IDLE_MOTION_POOL.find((entry) => entry.state === "yawning");

    expect(sleeping?.weights.longIdle).toBeGreaterThan(sleeping?.weights.settled ?? 0);
    expect(miniSleep?.weights.longIdle).toBeGreaterThan(miniSleep?.weights.settled ?? 0);
    expect(yawning?.weights.settled).toBeGreaterThan(yawning?.weights.early ?? 0);
  });

  it("limits deep idle to non-replay static states", async () => {
    const { IDLE_MOTION_POOL } = await loadDirectorModule();
    const deepIdleStates = IDLE_MOTION_POOL.filter((entry) => (entry.weights.deepIdle ?? 0) > 0)
      .map((entry) => entry.state)
      .sort();

    expect(deepIdleStates).toEqual(["idle", "mini-idle", "mini-sleep", "sleeping"].sort());
  });

  it("uses long quiet delays when the next idle callback runs after deep idle begins", async () => {
    const { createCalicoIdleDirector } = await loadDirectorModule();
    const applied: IdleDirectorPayload[] = [];
    const scheduledDelays: number[] = [];
    let now = 0;
    let pendingTimer: (() => void) | null = null;

    const setTimer = ((callback: TimerHandler, delay?: number) => {
      if (typeof callback !== "function") {
        throw new Error("Calico idle director should schedule function callbacks");
      }
      pendingTimer = callback as () => void;
      scheduledDelays.push(delay ?? 0);
      return scheduledDelays.length as unknown as ReturnType<typeof window.setTimeout>;
    }) as typeof window.setTimeout;

    const director = createCalicoIdleDirector({
      applyMotion: (payload) => {
        applied.push(payload);
        return true;
      },
      resetMotion: vi.fn(),
      getCurrentState: () => "idle-follow",
      isUserActive: () => false,
      random: () => 0,
      setTimeout: setTimer,
      clearTimeout: vi.fn(),
      now: () => now,
      motionDurations: { idle: 5_200 },
    });

    director.start();
    expect(scheduledDelays[0]).toBe(7_000);

    now = 10 * 60_000;
    pendingTimer?.();

    expect(applied[0]).toMatchObject({
      state: "idle",
      reason: "idle-director",
      priority: 1,
    });
    expect(scheduledDelays[scheduledDelays.length - 1]).toBe(5_200 + 45_000);
  });

  it("starts from idle-follow and schedules low-priority idle flourishes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { createCalicoIdleDirector } = await loadDirectorModule();
    const applied: IdleDirectorPayload[] = [];

    const director = createCalicoIdleDirector({
      applyMotion: (payload) => {
        applied.push(payload);
        return true;
      },
      resetMotion: vi.fn(),
      getCurrentState: () => "idle-follow",
      isUserActive: () => false,
      random: () => 0,
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
      now: () => Date.now(),
    });

    director.start();
    vi.advanceTimersByTime(7_000 + 2_500);

    expect(applied).toContainEqual(
      expect.objectContaining({
        state: "idle",
        reason: "idle-director",
        priority: 1,
      })
    );
    vi.useRealTimers();
  });

  it("does not schedule the next idle flourish until the current motion finishes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { createCalicoIdleDirector } = await loadDirectorModule();
    const applied: IdleDirectorPayload[] = [];

    const director = createCalicoIdleDirector({
      applyMotion: (payload) => {
        applied.push(payload);
        return true;
      },
      resetMotion: vi.fn(),
      getCurrentState: () => "idle-follow",
      isUserActive: () => false,
      random: () => 0,
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
      now: () => Date.now(),
      motionDurations: { idle: 5_200 },
    });

    director.start();
    vi.advanceTimersByTime(7_000);
    expect(applied).toHaveLength(1);
    vi.advanceTimersByTime(5_200 + 2_499);
    expect(applied).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(applied).toHaveLength(2);
    vi.useRealTimers();
  });

  it("wakes Calico on hover attention when resting", async () => {
    const { createCalicoIdleDirector } = await loadDirectorModule();
    const applied: IdleDirectorPayload[] = [];

    const director = createCalicoIdleDirector({
      applyMotion: (payload) => {
        applied.push(payload);
        return true;
      },
      resetMotion: vi.fn(),
      getCurrentState: () => "sleeping",
      isUserActive: () => false,
      random: () => 0,
      now: () => Date.now(),
    });

    director.start();
    expect(director.handleAttention()).toBe(true);
    expect(applied[0]).toMatchObject({
      state: "waking",
      reason: "hover-attention",
      priority: 2,
    });
  });

  it("uses mini-happy on hover attention from neutral idle states", async () => {
    const { createCalicoIdleDirector } = await loadDirectorModule();
    const applied: IdleDirectorPayload[] = [];

    const director = createCalicoIdleDirector({
      applyMotion: (payload) => {
        applied.push(payload);
        return true;
      },
      resetMotion: vi.fn(),
      getCurrentState: () => "idle-follow",
      isUserActive: () => false,
      random: () => 0,
      now: () => Date.now(),
    });

    director.start();
    expect(director.handleAttention()).toBe(true);
    expect(applied[0]).toMatchObject({
      state: "mini-happy",
      reason: "hover-attention",
    });
  });

  it("does not interrupt protected semantic states on hover attention", async () => {
    const { createCalicoIdleDirector } = await loadDirectorModule();
    const applied: IdleDirectorPayload[] = [];

    for (const protectedState of ["happy", "react-drag", "error", "notification", "working-typing"]) {
      const director = createCalicoIdleDirector({
        applyMotion: (payload) => {
          applied.push(payload);
          return true;
        },
        resetMotion: vi.fn(),
        getCurrentState: () => protectedState,
        isUserActive: () => false,
        random: () => 0,
        now: () => Date.now(),
      });

      director.start();
      expect(director.handleAttention()).toBe(false);
    }
    expect(applied).toEqual([]);
  });

  it("throttles hover attention with a cooldown", async () => {
    const { createCalicoIdleDirector } = await loadDirectorModule();
    const applied: IdleDirectorPayload[] = [];
    let now = 0;

    const director = createCalicoIdleDirector({
      applyMotion: (payload) => {
        applied.push(payload);
        return true;
      },
      resetMotion: vi.fn(),
      getCurrentState: () => "idle-follow",
      isUserActive: () => false,
      random: () => 0,
      now: () => now,
    });

    director.start();
    expect(director.handleAttention()).toBe(true);
    now = 5_000;
    expect(director.handleAttention()).toBe(false);
    now = 10_001;
    expect(director.handleAttention()).toBe(true);
    expect(applied).toHaveLength(2);
  });
});
