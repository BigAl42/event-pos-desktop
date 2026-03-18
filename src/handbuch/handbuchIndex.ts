/**
 * Handbuch: Markdown-Dateien zur Build-Zeit laden (release-fix), TOC aus Frontmatter.
 * Glob-Pfad relativ zu dieser Datei: docs/handbuch liegt im Projektroot.
 */

export type HandbuchEntry = {
  slug: string;
  title: string;
  order: number;
  body: string;
};

const HANDBUCH_GLOB = import.meta.glob("../../docs/handbuch/**/*.md", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

function extractSlugFromPath(path: string): string {
  const match = path.match(/handbuch\/(.+)\.md$/);
  if (match) {
    const inner = match[1];
    if (inner === "index") return "index";
    return inner.replace(/\/index$/, "");
  }
  const base = path.replace(/^.*\//, "").replace(/\.md$/, "");
  return base || "index";
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  match[1].split(/\r?\n/).forEach((line) => {
    const colon = line.indexOf(":");
    if (colon === -1) return;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim().replace(/^["']|["']$/g, "");
    meta[key] = value;
  });
  return { meta, body: match[2].trimStart() };
}

let cachedEntries: HandbuchEntry[] | null = null;

async function loadAllEntries(): Promise<HandbuchEntry[]> {
  if (cachedEntries) return cachedEntries;
  const results: HandbuchEntry[] = [];
  for (const [path, loader] of Object.entries(HANDBUCH_GLOB)) {
    const raw = await loader();
    const slugFromPath = extractSlugFromPath(path);
    const { meta, body } = parseFrontmatter(raw);
    const title = meta.title ?? slugFromPath;
    const order = meta.order !== undefined ? parseInt(meta.order, 10) : 100;
    const slug = meta.slug ?? slugFromPath;
    results.push({ slug, title, order, body });
  }
  results.sort((a, b) => a.order - b.order);
  cachedEntries = results;
  return results;
}

/** TOC sortiert nach Frontmatter order. */
export async function getHandbuchToc(): Promise<{ slug: string; title: string }[]> {
  const entries = await loadAllEntries();
  return entries.map((e) => ({ slug: e.slug, title: e.title }));
}

/** Ein Kapitel per slug (oder null). */
export async function getHandbuchChapter(slug: string): Promise<HandbuchEntry | null> {
  const entries = await loadAllEntries();
  const normalized = slug === "" ? "index" : slug;
  return entries.find((e) => e.slug === normalized) ?? null;
}

/** Alle Einträge (für PDF: Gesamtes Handbuch). */
export async function getAllHandbuchEntries(): Promise<HandbuchEntry[]> {
  return loadAllEntries();
}
