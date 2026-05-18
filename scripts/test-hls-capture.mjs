import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
const url =
  process.argv[2] ??
  "https://v-guard.kz/hls/camera_697bf0718e0450ae80477f2f_sub_1/video1_stream.m3u8";
const ffmpeg = process.env.FFMPEG_PATH ?? require("ffmpeg-static") ?? "ffmpeg";

function capture(hlsUrl) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      ffmpeg,
      ["-hide_banner", "-loglevel", "error", "-y", "-i", hlsUrl, "-vframes", "1", "-f", "image2", "pipe:1"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const chunks = [];
    let stderr = "";
    proc.stdout.on("data", (c) => chunks.push(c));
    proc.stderr.on("data", (c) => {
      stderr += c.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0 || !chunks.length) reject(new Error(stderr || `exit ${code}`));
      else resolve(Buffer.concat(chunks).length);
    });
  });
}

console.log("ffmpeg:", ffmpeg);
console.log("url:", url);
try {
  const size = await capture(url);
  console.log("OK frame bytes:", size);
} catch (e) {
  console.error("FAIL:", e.message ?? e);
  process.exit(1);
}
