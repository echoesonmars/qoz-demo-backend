export type FfmpegHlsInput = {
  preInputArgs: string[];
  inputUrl: string;
};

const DEFAULT_HLS_RESOLVE: [string, string][] = [["v-guard.kz", "38.107.235.151"]];

function parseResolveMap(): Map<string, string> {
  const map = new Map<string, string>(DEFAULT_HLS_RESOLVE);
  const raw = process.env.LIVE_HLS_RESOLVE?.trim();
  if (!raw) return map;
  for (const part of raw.split(",")) {
    const chunk = part.trim();
    if (!chunk) continue;
    const eq = chunk.indexOf("=");
    if (eq <= 0) continue;
    const host = chunk.slice(0, eq).trim().toLowerCase();
    const ip = chunk.slice(eq + 1).trim();
    if (host && ip) map.set(host, ip);
  }
  return map;
}

export function buildFfmpegHlsInput(hlsUrl: string): FfmpegHlsInput {
  const preInputArgs: string[] = [];
  let inputUrl = hlsUrl;
  const resolveMap = parseResolveMap();
  if (resolveMap.size === 0) return { preInputArgs, inputUrl };

  try {
    const u = new URL(hlsUrl);
    const ip = resolveMap.get(u.hostname.toLowerCase());
    if (!ip) return { preInputArgs, inputUrl };
    const originalHost = u.hostname;
    u.hostname = ip.includes(":") ? `[${ip}]` : ip;
    inputUrl = u.toString();
    preInputArgs.push("-headers", `Host: ${originalHost}\r\n`);
    if (u.protocol === "https:") {
      preInputArgs.push("-tls_verify", "0");
    }
  } catch {
    return { preInputArgs, inputUrl: hlsUrl };
  }

  return { preInputArgs, inputUrl };
}
