import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { getHandbookToc, getHandbookChapter, getAllHandbookEntries } from "../handbook/handbookIndex";
import { elementToPdfBytes, saveHandbookPdf, sanitizePdfFilename } from "../utils/handbookPdfExport";
import type { HandbookEntry } from "../handbook/handbookIndex";
import "./HandbookView.css";

type Props = {
  onBack: () => void;
  initialSlug?: string;
};

export default function HandbookView({ onBack, initialSlug }: Props) {
  const { i18n } = useTranslation();
  const [toc, setToc] = useState<{ slug: string; title: string }[]>([]);
  const [slug, setSlug] = useState<string>(initialSlug ?? "index");
  const [chapter, setChapter] = useState<{ title: string; body: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [fullPdfEntries, setFullPdfEntries] = useState<HandbookEntry[] | null>(null);
  const articleRef = useRef<HTMLElement>(null);
  const fullPdfContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getHandbookToc(i18n.language)
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
  }, [i18n.language]);

  useEffect(() => {
    let cancelled = false;
    setChapter(null);
    getHandbookChapter(slug, i18n.language)
      .then((entry) => {
        if (!cancelled && entry) setChapter({ title: entry.title, body: entry.body });
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [slug, i18n.language]);

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
      await saveHandbookPdf(bytes, name);
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
      const entries = await getAllHandbookEntries(i18n.language);
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
        await saveHandbookPdf(bytes, "Handbuch_Kassensystem.pdf");
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
    <div className="handbook-view">
      <header className="handbook-header">
        <button type="button" className="handbook-back" onClick={onBack}>
          ← Zurück
        </button>
        <h1 className="handbook-title">Handbuch</h1>
        <div className="handbook-pdf-actions">
          <button
            type="button"
            className="handbook-pdf-btn"
            onClick={handleExportChapterPdf}
            disabled={!chapter || pdfExporting}
          >
            {pdfExporting && !fullPdfEntries ? "Erstelle…" : "Aktuelles Kapitel als PDF"}
          </button>
          <button
            type="button"
            className="handbook-pdf-btn"
            onClick={handleExportFullPdf}
            disabled={pdfExporting}
          >
            {pdfExporting && fullPdfEntries ? "Erstelle…" : "Gesamtes Handbuch als PDF"}
          </button>
        </div>
      </header>

      <div className="handbook-layout">
        <nav className="handbook-toc" aria-label="Inhaltsverzeichnis">
          {loading ? (
            <p className="handbook-toc-loading">Lade…</p>
          ) : (
            <ul className="handbook-toc-list">
              {toc.map((item) => (
                <li key={item.slug} className="handbook-toc-item">
                  <button
                    type="button"
                    className={`handbook-toc-link ${slug === item.slug ? "handbook-toc-link-active" : ""}`}
                    onClick={() => setSlug(item.slug)}
                  >
                    {item.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>

        <main className="handbook-content" aria-label="Handbuch-Inhalt">
          {error && <p className="handbook-error">{error}</p>}
          {!error && chapter && (
            <article className="handbook-article" ref={articleRef}>
              <h2 className="handbook-article-title">{chapter.title}</h2>
              <div className="handbook-markdown">
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
                            className="handbook-inline-link"
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
          {!error && !chapter && !loading && <p className="handbook-empty">Kapitel nicht gefunden.</p>}
        </main>
      </div>

      {fullPdfEntries && fullPdfEntries.length > 0 && (
        <>
          <div className="handbook-pdf-export-overlay" role="status" aria-live="polite">
            <div className="handbook-pdf-export-overlay-inner">PDF wird erstellt…</div>
          </div>
          <div
            ref={fullPdfContainerRef}
            className="handbook-pdf-full-container"
            aria-hidden="true"
          >
            {fullPdfEntries.map((entry) => (
              <section
                key={entry.slug}
                className={`handbook-pdf-full-section ${entry.slug === fullPdfEntries[0]?.slug ? "" : "html2pdf__page-break"}`}
              >
                <h2 className="handbook-article-title">{entry.title}</h2>
                <div className="handbook-markdown">
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
