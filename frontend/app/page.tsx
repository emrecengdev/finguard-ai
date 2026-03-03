"use client";

import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Sidebar } from "@/components/sidebar";
import { Chat } from "@/components/chat";
import { getDocuments, healthCheck, type DocumentInfo } from "@/lib/api";
import { useAppStore } from "@/store/useAppStore";

export default function Dashboard() {
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [isBackendOnline, setIsBackendOnline] = useState(false);
  const { isMobileSidebarOpen, setMobileSidebarOpen } = useAppStore();

  useEffect(() => {
    let active = true;

    const refreshState = async () => {
      const online = await healthCheck();
      if (!active) return;
      setIsBackendOnline(online);

      if (!online) {
        setDocuments([]);
        return;
      }

      try {
        const docs = await getDocuments();
        if (active) setDocuments(docs);
      } catch {
        if (active) setDocuments([]);
      }
    };

    const interval = setInterval(refreshState, 30_000);
    void refreshState();

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const handleDocumentsChange = () => {
    void (async () => {
      try {
        const docs = await getDocuments();
        setDocuments(docs);
      } catch {
        setDocuments([]);
      }
    })();
  };

  const sidebarContent = (
    <Sidebar
      documents={documents}
      onDocumentsChange={handleDocumentsChange}
      isBackendOnline={isBackendOnline}
    />
  );

  return (
    <main
      className="flex min-h-[100dvh] w-full items-center justify-center bg-slate-50 dark:bg-transparent dark:bg-[url('/bg-finance.png')] bg-cover bg-center bg-no-repeat p-4 font-sans sm:p-6 md:p-8 transition-colors duration-700 relative"
    >
      <div
        className="relative flex h-[90vh] min-h-[750px] w-full max-w-[1300px] overflow-hidden rounded-[32px] border border-black/5 dark:border-white/[0.05] shadow-[0_20px_80px_rgba(0,0,0,0.08)] dark:shadow-[0_20px_80px_rgba(0,0,0,0.6)]"
        style={{ backgroundColor: "var(--background)" }}
      >
        {/* ── Mobile top bar ─────────────────────────────── */}
        <div className="absolute left-0 right-0 top-0 z-50 flex h-14 items-center border-b border-border bg-background/80 px-4 backdrop-blur-md lg:hidden">
          <Sheet
            open={isMobileSidebarOpen}
            onOpenChange={setMobileSidebarOpen}
          >
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-xl text-muted-foreground hover:text-white"
              >
                <Menu className="size-5" strokeWidth={1.5} />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[340px] border-border bg-sidebar p-0">
              {sidebarContent}
            </SheetContent>
          </Sheet>
          <span className="ml-3 font-mono text-xs font-semibold tracking-wider text-foreground/90">
            FinGuard AI
          </span>
        </div>

        {/* ── Desktop sidebar ────────────────────────────── */}
        <AnimatePresence>
          <motion.aside
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
            className="hidden w-[280px] shrink-0 flex-col border-r border-white/[0.03] bg-sidebar lg:flex xl:w-[320px] 2xl:w-[360px]"
          >
            {sidebarContent}
          </motion.aside>
        </AnimatePresence>

        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden pt-14 lg:pt-0 bg-white/20 dark:bg-transparent transition-colors duration-700">
          {/* Main Background with massive soft emerald glow */}
          <div
            className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_50%_30%,rgba(16,185,129,0.06)_0%,transparent_70%)] dark:bg-[radial-gradient(circle_at_50%_30%,rgba(16,185,129,0.12)_0%,transparent_70%)] transition-all duration-700"
          />

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.08 }}
            className="relative z-10 flex min-w-0 flex-1 flex-col"
          >
            <Chat />
          </motion.div>
        </div>
      </div>
    </main>
  );
}
