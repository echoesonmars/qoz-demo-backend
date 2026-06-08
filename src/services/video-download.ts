export async function downloadVideo(
  videoUrl: string,
  signal?: AbortSignal,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const res = await fetch(videoUrl, { signal });
  if (!res.ok) {
    throw new Error(`Video download failed: HTTP ${res.status}`);
  }
  const mimeType = (res.headers.get("content-type") ?? "video/mp4").split(";")[0];
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error("Video download returned empty body");
  }
  return { buffer, mimeType };
}
