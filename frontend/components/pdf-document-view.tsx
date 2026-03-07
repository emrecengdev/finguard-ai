"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileWarning, Loader2 } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

interface PdfDocumentViewProps {
  fileUrl: string;
  fallbackUrl?: string;
  fileName: string;
}

interface PdfLoadSuccessPayload {
  numPages: number;
}

export function PdfDocumentView({ fileUrl, fallbackUrl, fileName }: PdfDocumentViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [resolvedFileState, setResolvedFileState] = useState<{
    source: string;
    activeFileUrl: string;
  }>({
    source: "",
    activeFileUrl: fileUrl,
  });
  const [documentState, setDocumentState] = useState<{
    source: string;
    numPages: number;
    loadError: string | null;
  }>({
    source: "",
    numPages: 0,
    loadError: null,
  });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      setContainerWidth(Math.floor(entry.contentRect.width));
    });

    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, []);

  const pageWidth = useMemo(() => {
    const width = containerWidth - 32;
    return width > 0 ? Math.max(340, width) : 680;
  }, [containerWidth]);

  const activeFileUrl =
    resolvedFileState.source === fileUrl ? resolvedFileState.activeFileUrl : fileUrl;
  const numPages = documentState.source === activeFileUrl ? documentState.numPages : 0;
  const loadError = documentState.source === activeFileUrl ? documentState.loadError : null;

  return (
    <div ref={containerRef} className="h-full overflow-y-auto px-4 pb-8 pt-4">
      <Document
        key={activeFileUrl}
        file={activeFileUrl}
        loading={
          <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 rounded-[20px] border border-black/5 bg-white/72 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] dark:border-white/[0.05] dark:bg-[#020817]/78 dark:text-slate-200">
            <Loader2 className="size-6 animate-spin text-sky-600 dark:text-sky-300" />
            <div className="text-sm font-medium">PDF hazırlanıyor</div>
          </div>
        }
        error={
          <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 rounded-[20px] border border-rose-500/15 bg-rose-50/70 px-6 text-center text-rose-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] dark:border-rose-400/15 dark:bg-rose-500/10 dark:text-rose-200">
            <FileWarning className="size-6" strokeWidth={1.8} />
            <div className="text-sm font-semibold">PDF önizleme yüklenemedi</div>
            <div className="max-w-sm text-xs text-rose-600/90 dark:text-rose-200/80">
              {loadError ?? `${fileName} şu anda görüntülenemiyor.`}
            </div>
          </div>
        }
        onLoadSuccess={({ numPages: nextNumPages }: PdfLoadSuccessPayload) => {
          setDocumentState({
            source: activeFileUrl,
            numPages: nextNumPages,
            loadError: null,
          });
        }}
        onLoadError={(error) => {
          if (activeFileUrl === fileUrl && fallbackUrl) {
            setResolvedFileState({
              source: fileUrl,
              activeFileUrl: fallbackUrl,
            });
            return;
          }

          setDocumentState({
            source: activeFileUrl,
            numPages: 0,
            loadError: error instanceof Error ? error.message : "PDF açılamadı.",
          });
        }}
        className="flex flex-col gap-5"
      >
        {Array.from({ length: numPages }, (_, index) => (
          <div
            key={`${fileName}-${index + 1}`}
            className="rounded-[22px] border border-black/5 bg-white/92 p-3 shadow-[0_24px_44px_-34px_rgba(15,23,42,0.35)] ring-1 ring-white/60 dark:border-white/[0.06] dark:bg-[#081120]/92 dark:ring-white/[0.02]"
          >
            <div className="mb-3 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              <span>Sayfa {index + 1}</span>
              <span>{numPages} / toplam</span>
            </div>

            <Page
              pageNumber={index + 1}
              width={pageWidth}
              renderAnnotationLayer={false}
              renderTextLayer={false}
              className="overflow-hidden rounded-[16px] bg-white dark:bg-slate-50"
              loading={
                <div className="flex min-h-[420px] items-center justify-center rounded-[16px] bg-white text-slate-500 dark:bg-slate-50">
                  <Loader2 className="size-5 animate-spin" />
                </div>
              }
            />
          </div>
        ))}
      </Document>
    </div>
  );
}
