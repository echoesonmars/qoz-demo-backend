const MAX_PAYLOAD_BYTES = Math.max(
  32_768,
  Number.parseInt(process.env.LIVE_MAX_PAYLOAD_BYTES ?? "262144", 10) || 262_144,
);

const MAX_JPEG_BYTES = Math.max(
  50_000,
  Number.parseInt(process.env.LIVE_MAX_JPEG_BYTES ?? "2097152", 10) || 2_097_152,
);

export function maxLivePayloadBytes(): number {
  return MAX_PAYLOAD_BYTES;
}

export function maxLiveJpegBytes(): number {
  return MAX_JPEG_BYTES;
}

export function assertPayloadWithinLimit(payload: unknown): void {
  const size = Buffer.byteLength(JSON.stringify(payload ?? {}), "utf8");
  if (size > MAX_PAYLOAD_BYTES) {
    throw new Error(`Payload слишком большой (${size} B, лимит ${MAX_PAYLOAD_BYTES} B)`);
  }
}

export function assertJpegWithinLimit(jpeg: Buffer | null | undefined): Buffer | null {
  if (!jpeg || jpeg.length === 0) return null;
  if (jpeg.length > MAX_JPEG_BYTES) {
    throw new Error(`JPEG слишком большой (${jpeg.length} B, лимит ${MAX_JPEG_BYTES} B)`);
  }
  return jpeg;
}
