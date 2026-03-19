import { useState, useEffect, useRef } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { getHandbuchToc, getHandbuchChapter, getAllHandbuchEntries } from "../handbuch/handbuchIndex";
import { elementToPdfBytes, saveHandbuchPdf, sanitizePdfFilename } from "../utils/handbuchPdfExport";
import type { HandbuchEntry } from "../handbuch/handbuchIndex";
import "./HandbuchView.css";

type Props = {
  onBack: () => void;
  initialSlug?: string;
};

export default function HandbuchView({ onBack, initialSlug }: Props) {
  const [toc, setToc] = useState<{ slug: string; title: string }[]>([]);
  const [slug, setSlug] = useState<string>(initialSlug ?? "index");
  const [chapter, setChapter] = useState<{ title: string; body: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [fullPdfEntries, setFullPdfEntries] = useState<HandbuchEntry[] | null>(null);
  const articleRef = useRef<HTMLElement>(null);
  const fullPdfContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getHandbuchToc()
      .then((list) => {
        if (!cancelled) setToc(list);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setChapter(null);
    getHandbuchChapter(slug)
      .then((entry) => {
        if (!cancelled && entry) setChapter({ title: entry.title, body: entry.body });
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  function normalizeInternalSlug(rawSlug: string): string {
    let normalized = rawSlug.trim();
    try {
      normalized = decodeURIComponent(normalized);
    } catch {
      // Keep original slug when decoding fails.
    }
    normalized = normalized.replace(/^\/+/, "").replace(/\/+$/, "").trim();
    return normalized || "index";
  }

  function getInternalSlug(href: string): string | null {
    if (href.startsWith("#")) {
      return normalizeInternalSlug(href.slice(1));
    }
    if (href.startsWith("handbuch://") || href.startsWith("handbuch:")) {
      return normalizeInternalSlug(href.replace(/^handbuch:(\/\/)?/, ""));
    }
    return null;
  }

  async function handleExportChapterPdf() {
    if (!articleRef.current || !chapter) return;
    setPdfExporting(true);
    setError(null);
    try {
      const bytes = await elementToPdfBytes(articleRef.current);
      const name = sanitizePdfFilename(`Handbuch_${chapter.title}`);
      await saveHandbuchPdf(bytes, name);
    } catch (e) {
      setError(String(e));
    } finally {
      setPdfExporting(false);
    }
  }

  async function handleExportFullPdf() {
    setPdfExporting(true);
    setError(null);
    try {
      const entries = await getAllHandbuchEntries();
      setFullPdfEntries(entries);
    } catch (e) {
      setError(String(e));
      setPdfExporting(false);
    }
  }

  useEffect(() => {
    if (!fullPdfEntries?.length || !fullPdfContainerRef.current) return;
    const container = fullPdfContainerRef.current;
    const run = async () => {
      // Wait until the container has real layout/content before rendering to PDF.
      const startedAt = Date.now();
      while (true) {
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        const h = container.scrollHeight || container.clientHeight;
        const textLen = (container.textContent || "").trim().length;
        if (h > 200 && textLen > 20) break;
        if (Date.now() - startedAt > 3000) break; // fail-safe
      }
      try {
        const bytes = await elementToPdfBytes(container);
        await saveHandbuchPdf(bytes, "Handbuch_Kassensystem.pdf");
      } catch (e) {
        setError(String(e));
      } finally {
        setFullPdfEntries(null);
        setPdfExporting(false);
      }
    };
    run();
  }, [fullPdfEntries]);

  return (
    <div className="handbuch-view">
      <header className="handbuch-header">
        <button type="button" className="handbuch-back" onClick={onBack}>
          ← Zurück
        </button>
        <h1 className="handbuch-title">Handbuch</h1>
        <div className="handbuch-pdf-actions">
          <button
            type="button"
            className="handbuch-pdf-btn"
            onClick={handleExportChapterPdf}
            disabled={!chapter || pdfExporting}
          >
            {pdfExporting && !fullPdfEntries ? "Erstelle…" : "Aktuelles Kapitel als PDF"}
          </button>
          <button
            type="button"
            className="handbuch-pdf-btn"
            onClick={handleExportFullPdf}
            disabled={pdfExporting}
          >
            {pdfExporting && fullPdfEntries ? "Erstelle…" : "Gesamtes Handbuch als PDF"}
          </button>
        </div>
      </header>

      <div className="handbuch-layout">
        <nav className="handbuch-toc" aria-label="Inhaltsverzeichnis">
          {loading ? (
            <p className="handbuch-toc-loading">Lade…</p>
          ) : (
            <ul className="handbuch-toc-list">
              {toc.map((item) => (
                <li key={item.slug} className="handbuch-toc-item">
                  <button
                    type="button"
                    className={`handbuch-toc-link ${slug === item.slug ? "handbuch-toc-link-active" : ""}`}
                    onClick={() => setSlug(item.slug)}
                  >
                    {item.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>

        <main className="handbuch-content" aria-label="Handbuch-Inhalt">
          {error && <p className="handbuch-error">{error}</p>}
          {!error && chapter && (
            <article className="handbuch-article" ref={articleRef}>
              <h2 className="handbuch-article-title">{chapter.title}</h2>
              <div className="handbuch-markdown">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  urlTransform={(url) => {
                    if (url.startsWith("handbuch://") || url.startsWith("handbuch:")) {
                      return url;
                    }
                    return defaultUrlTransform(url);
                  }}
                  components={{
                    a: ({ href, children, ...props }) => {
                      const internalSlug = href ? getInternalSlug(href) : null;
                      if (internalSlug !== null) {
                        return (
                          <button
                            type="button"
                            className="handbuch-inline-link"
                            onClick={() => setSlug(internalSlug)}
                          >
                            {children}
                          </button>
                        );
                      }
                      return (
                        <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                          {children}
                        </a>
                      );
                    },
                  }}
                >
                  {chapter.body}
                </ReactMarkdown>
              </div>
            </article>
          )}
          {!error && !chapter && !loading && <p className="handbuch-empty">Kapitel nicht gefunden.</p>}
        </main>
      </div>

      {fullPdfEntries && fullPdfEntries.length > 0 && (
        <>
          <div className="handbuch-pdf-export-overlay" role="status" aria-live="polite">
            <div className="handbuch-pdf-export-overlay-inner">PDF wird erstellt…</div>
          </div>
          <div
            ref={fullPdfContainerRef}
            className="handbuch-pdf-full-container"
            aria-hidden="true"
          >
            {fullPdfEntries.map((entry) => (
              <section
                key={entry.slug}
                className={`handbuch-pdf-full-section ${entry.slug === fullPdfEntries[0]?.slug ? "" : "html2pdf__page-break"}`}
              >
                <h2 className="handbuch-article-title">{entry.title}</h2>
                <div className="handbuch-markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.body}</ReactMarkdown>
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
