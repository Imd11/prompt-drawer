import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const root = process.cwd();
const calicoDir = join(root, "public", "calico");
const sourceDir = join(root, "assets", "calico-source");
const outputDir = join(calicoDir, "sheets");
const sourceManifest = JSON.parse(
  readFileSync(join(sourceDir, "manifest.json"), "utf8")
);
const finiteStates = new Set([
  "collapsing", "happy", "mini-alert", "mini-enter", "mini-happy",
  "mini-peek", "react-left", "react-poke", "waking", "yawning",
]);
const infiniteStates = new Set([
  "idle", "react-drag", "sleeping", "working-typing", "working-conducting",
  "working-juggling", "working-building", "working-carrying", "working-sweeping",
]);

function readApngPlayCount(path) {
  const png = readFileSync(path);
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    if (type === "acTL") return png.readUInt32BE(offset + 12);
    offset += 12 + length;
  }
  throw new Error(`Missing APNG acTL chunk: ${path}`);
}

function readPngHeader(path) {
  const png = readFileSync(path);
  if (png.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error(`Missing PNG IHDR: ${path}`);
  }
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    colorType: png[25],
  };
}

const ffmpegVersion = execFileSync("ffmpeg", ["-version"], { encoding: "utf8" })
  .split("\n")[0];
const ffprobeVersion = execFileSync("ffprobe", ["-version"], { encoding: "utf8" })
  .split("\n")[0];

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const states = {};
for (const [state, entry] of Object.entries(sourceManifest.states)) {
  const input = join(sourceDir, entry.file);
  const stream = JSON.parse(execFileSync("ffprobe", [
    "-v", "error", "-count_frames", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,nb_read_frames", "-of", "json", input,
  ], { encoding: "utf8" })).streams[0];
  const frames = JSON.parse(execFileSync("ffprobe", [
    "-v", "error", "-select_streams", "v:0", "-show_frames",
    "-show_entries", "frame=duration_time", "-of", "json", input,
  ], { encoding: "utf8" })).frames;

  const frameWidth = Number(stream.width);
  const frameHeight = Number(stream.height);
  const frameCount = Number(stream.nb_read_frames);
  if (![frameWidth, frameHeight, frameCount].every(Number.isInteger) || frameCount <= 0) {
    throw new Error(`Invalid APNG stream metadata for ${state}`);
  }
  if (frames.length !== frameCount) {
    throw new Error(`Frame duration count mismatch for ${state}`);
  }
  const frameDurationsMs = frames.map((frame, index) => {
    const duration = Math.round(Number(frame.duration_time) * 1000);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(`Invalid duration for ${state} frame ${index}`);
    }
    return duration;
  });

  const columns = Math.ceil(Math.sqrt(frameCount));
  const rows = Math.ceil(frameCount / columns);
  const gutter = 2;
  const baseName = basename(entry.file, ".apng");
  const temporaryOutput = join(outputDir, `${baseName}-sheet.tmp.png`);
  execFileSync("ffmpeg", [
    "-v", "error", "-y", "-i", input,
    "-vf", `tile=${columns}x${rows}:padding=${gutter}:margin=0:color=black@0`,
    "-pix_fmt", "rgba", "-frames:v", "1", temporaryOutput,
  ]);

  const outputBytes = readFileSync(temporaryOutput);
  const hash = createHash("sha256").update(outputBytes).digest("hex").slice(0, 12);
  const outputName = `${baseName}-sheet-${hash}.png`;
  const outputPath = join(outputDir, outputName);
  renameSync(temporaryOutput, outputPath);

  const sheetWidth = columns * frameWidth + (columns - 1) * gutter;
  const sheetHeight = rows * frameHeight + (rows - 1) * gutter;
  const header = readPngHeader(outputPath);
  if (header.colorType !== 6 || header.width !== sheetWidth || header.height !== sheetHeight) {
    throw new Error(`Invalid generated RGBA sheet dimensions for ${state}`);
  }

  const plays = readApngPlayCount(input);
  if (finiteStates.has(state) && plays === 0) {
    throw new Error(`Expected finite APNG play count for ${state}`);
  }
  if (infiniteStates.has(state) && plays !== 0) {
    throw new Error(`Expected infinite APNG play count for ${state}`);
  }

  states[state] = {
    file: `/calico/sheets/${outputName}`,
    pixelFormat: "rgba",
    frameWidth,
    frameHeight,
    frameCount,
    columns,
    rows,
    gutter,
    strideX: frameWidth + gutter,
    strideY: frameHeight + gutter,
    sheetWidth,
    sheetHeight,
    frameDurationsMs,
    plays,
  };
}

writeFileSync(
  join(outputDir, "manifest.json"),
  `${JSON.stringify({
    schemaVersion: 1,
    generator: { ffmpegVersion, ffprobeVersion },
    states,
  }, null, 2)}\n`
);
