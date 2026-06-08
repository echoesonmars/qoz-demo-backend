export function validateReservedStoragePath(
  path: string,
  prefix: "incidents" | "lessons",
): boolean {
  const p = path.trim();
  if (!p.startsWith(`${prefix}/`)) {
    return false;
  }
  const rest = p.slice(prefix.length + 1);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/i.test(
    rest,
  );
}
