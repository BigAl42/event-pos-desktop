import i18n from "./i18n";

export type UserMsgParsed = { code: string; params: Record<string, string> };

export function tryParseUserMsg(raw: string): UserMsgParsed | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const o = JSON.parse(trimmed) as { code?: string; params?: Record<string, unknown> };
    if (!o || typeof o.code !== "string") return null;
    const params: Record<string, string> = {};
    if (o.params && typeof o.params === "object") {
      for (const [k, v] of Object.entries(o.params)) {
        params[k] = v === null || v === undefined ? "" : String(v);
      }
    }
    return { code: o.code, params };
  } catch {
    return null;
  }
}

/** Success strings from `invoke` or protocol messages that use the same JSON shape. */
export function translateUserJsonMessage(raw: string): string {
  const p = tryParseUserMsg(raw);
  if (p) return i18n.t(p.code, p.params);
  return raw;
}

export function translateInvokeError(e: unknown): string {
  const raw =
    typeof e === "string"
      ? e
      : e && typeof e === "object" && "message" in e && typeof (e as Error).message === "string"
        ? (e as Error).message
        : String(e);
  const p = tryParseUserMsg(raw);
  if (p) return i18n.t(p.code, p.params);
  return i18n.t("errors.generic", { message: raw });
}
