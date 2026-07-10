import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type SourceManifest = {
  states: Record<string, { file: string }>;
};

type SheetEntry = {
  file: string;
  pixelFormat: "rgba";
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  columns: number;
  rows: number;
  gutter: number;
  strideX: number;
  strideY: number;
  sheetWidth: number;
  sheetHeight: number;
  frameDurationsMs: number[];
  plays: number;
};

describe("Calico sprite sheet manifest", () => {
  it("covers every APNG motion with deterministic frame metadata", () => {
    const sources = JSON.parse(
      readFileSync("assets/calico-source/manifest.json", "utf8")
    ) as SourceManifest;
    const sheets = JSON.parse(
      readFileSync("public/calico/sheets/manifest.json", "utf8")
    ) as { states: Record<string, SheetEntry> };

    for (const [state] of Object.entries(sources.states)) {
      const sheet = sheets.states[state];
      expect(sheet, state).toBeDefined();
      expect(existsSync(`public${sheet.file}`), state).toBe(true);
      expect(sheet.frameCount, state).toBeGreaterThan(0);
      expect(sheet.columns * sheet.rows, state).toBeGreaterThanOrEqual(sheet.frameCount);
      expect(sheet.file, state).toMatch(/-sheet-[a-f0-9]{12}\.png$/);
      expect(sheet.pixelFormat, state).toBe("rgba");
      const png = readFileSync(`public${sheet.file}`);
      expect(png.toString("ascii", 12, 16), state).toBe("IHDR");
      expect(png[25], `${state} PNG color type`).toBe(6);
      expect(sheet.gutter, state).toBeGreaterThanOrEqual(2);
      expect(sheet.strideX, state).toBe(sheet.frameWidth + sheet.gutter);
      expect(sheet.strideY, state).toBe(sheet.frameHeight + sheet.gutter);
      expect(sheet.sheetWidth, state).toBe(
        sheet.columns * sheet.frameWidth + (sheet.columns - 1) * sheet.gutter
      );
      expect(sheet.sheetHeight, state).toBe(
        sheet.rows * sheet.frameHeight + (sheet.rows - 1) * sheet.gutter
      );
      expect(sheet.frameDurationsMs, state).toHaveLength(sheet.frameCount);
      expect(sheet.frameDurationsMs.every((value) => value > 0), state).toBe(true);
      expect(Number.isInteger(sheet.plays), state).toBe(true);
      expect(sheet.plays, state).toBeGreaterThanOrEqual(0);
    }
  });

  it("preserves an authorized source copy after removing the legacy runtime asset", () => {
    expect(existsSync("assets/calico-source/calico-idle.apng")).toBe(true);
    expect(existsSync("public/calico/calico-idle.apng")).toBe(false);
  });
});
