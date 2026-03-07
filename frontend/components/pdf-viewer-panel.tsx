"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft, ExternalLink, FileText } from "lucide-react";
import { motion } from "framer-motion";

import type { DocumentInfo } from "@/lib/api";
import { SAMPLE_DOC_FILENAMES } from "@/lib/sample-documents";

const PdfDocumentView = dynamic(
  () =>
    import("./pdf-document-view").then((module) => ({
      default: module.PdfDocumentView,
    })),
  {
    ssr: false,
  },
);

interface PdfViewerPanelProps {
  document: DocumentInfo;
  onClose: () => void;
}

export function PdfViewerPanel({ document, onClose }: PdfViewerPanelProps) {
  const previewUrl = useMemo(
    () => `/api/documents/${encodeURIComponent(document.filename)}/file`,
    [document.filename],
  );
  const fallbackUrl = useMemo(
    () =>
      SAMPLE_DOC_FILENAMES.has(document.filename)
        ? `/samples/${encodeURIComponent(document.filename)}`
        : undefined,
    [document.filename],
  );
  const openInNewTabUrl = fallbackUrl ?? previewUrl;

  return (
    <motion.section
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.24, ease: "easeOut" }}
      className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-black/5 bg-white/68 shadow-[0_20px_70px_-36px_rgba(15,23,42,0.32)] ring-1 ring-white/50 backdrop-blur-xl dark:border-white/[0.06] dark:bg-[#0f172a]/72 dark:ring-0 dark:shadow-[0_22px_70px_-36px_rgba(2,6,23,0.82)]"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.10),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.06),transparent)] dark:bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.14),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.03),transparent)]" />

      <div className="relative flex items-start justify-between gap-4 border-b border-black/5 px-5 py-4 dark:border-white/[0.05]">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
            Belge Önizleme
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-600 ring-1 ring-sky-200/70 dark:bg-sky-400/10 dark:text-sky-300 dark:ring-sky-400/15">
              <FileText className="size-4.5" strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                {document.filename}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <span>{document.pages} sayfa</span>
                <span className="size-1 rounded-full bg-slate-300 dark:bg-slate-600" />
                <span>{document.chunks} parça</span>
                {document.pages === 1 ? (
                  <>
                    <span className="size-1 rounded-full bg-slate-300 dark:bg-slate-600" />
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">
                      Ozet
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="inline-flex h-9 items-center gap-2 rounded-full border border-black/5 bg-white/75 px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-white hover:text-slate-950 dark:border-white/[0.05] dark:bg-white/[0.05] dark:text-slate-200 dark:hover:bg-white/[0.09] dark:hover:text-white"
            title="Sohbete geri dön"
          >
            <ArrowLeft className="size-4" strokeWidth={1.9} />
            <span className="hidden sm:inline">Geri</span>
          </button>
          <a
            href={openInNewTabUrl}
            target="_blank"
            rel="noreferrer"
            className="flex size-9 items-center justify-center rounded-full border border-black/5 bg-white/70 text-slate-600 transition-colors hover:bg-white hover:text-slate-900 dark:border-white/[0.05] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white"
            title="Yeni sekmede aç"
          >
            <ExternalLink className="size-4" strokeWidth={1.8} />
          </a>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 p-3">
        <div className="relative h-full min-h-[540px] overflow-hidden rounded-[22px] border border-black/5 bg-slate-50/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] dark:border-white/[0.05] dark:bg-[#020817]">
          <PdfDocumentView
            fileUrl={previewUrl}
            fallbackUrl={fallbackUrl}
            fileName={document.filename}
          />
        </div>
      </div>
    </motion.section>
  );
}
