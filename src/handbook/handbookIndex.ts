/**
 * Handbook: load Markdown at build time; TOC from frontmatter.
 * Content lives under docs/handbuch/{de|en}/.
 */

export type HandbookEntry = {
  slug: string;
  title: string;
  order: number;
  body: string;
};

const GLOB_DE = import.meta.glob("../../docs/handbuch/de/**/*.md", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

const GLOB_EN = import.meta.glob("../../docs/handbuch/en/**/*.md", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

type HandbookLang = "de" | "en";

function handbookLang(lang: string | undefined): HandbookLang {
  return lang && lang.toLowerCase().startsWith("de") ? "de" : "en";
}

function extractSlugFromPath(path: string): string {
  const match = path.match(/handbuch\/(?:de|en)\/(.+)\.md$/);
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

const cache: Partial<Record<HandbookLang, HandbookEntry[]>> = {};

async function loadAllEntries(lang: string): Promise<HandbookEntry[]> {
  const lg = handbookLang(lang);
  if (cache[lg]) return cache[lg]!;

  const glob = lg === "de" ? GLOB_DE : GLOB_EN;
  const results: HandbookEntry[] = [];
  for (const [path, loader] of Object.entries(glob)) {
    const raw = await loader();
    const slugFromPath = extractSlugFromPath(path);
    const { meta, body } = parseFrontmatter(raw);
    const title = meta.title ?? slugFromPath;
    const order = meta.order !== undefined ? parseInt(meta.order, 10) : 100;
    const slug = meta.slug ?? slugFromPath;
    results.push({ slug, title, order, body });
  }
  results.sort((a, b) => a.order - b.order);
  cache[lg] = results;
  return results;
}

/** TOC sorted by frontmatter order. */
export async function getHandbookToc(lang?: string): Promise<{ slug: string; title: string }[]> {
  const entries = await loadAllEntries(lang ?? "en");
  return entries.map((e) => ({ slug: e.slug, title: e.title }));
}

/** One chapter by slug (or null). */
export async function getHandbookChapter(slug: string, lang?: string): Promise<HandbookEntry | null> {
  const entries = await loadAllEntries(lang ?? "en");
  const normalized = slug === "" ? "index" : slug;
  return entries.find((e) => e.slug === normalized) ?? null;
}

/** All entries (full handbook PDF). */
export async function getAllHandbookEntries(lang?: string): Promise<HandbookEntry[]> {
  return loadAllEntries(lang ?? "en");
}
