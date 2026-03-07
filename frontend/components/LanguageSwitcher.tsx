"use client"

import { motion } from "framer-motion"
import { useAppStore } from "@/store/useAppStore"
import { useMounted } from "@/hooks/use-mounted"

export function LanguageSwitcher() {
    const { locale, setLocale } = useAppStore()
    const mounted = useMounted()

    if (!mounted) {
        return <div className="w-[68px] h-[32px] rounded-full bg-black/5 dark:bg-white/5 animate-pulse" />
    }

    const isEN = locale === "en"

    return (
        <button
            onClick={() => setLocale(isEN ? "tr" : "en")}
            className="group relative flex h-[32px] w-[68px] cursor-pointer items-center rounded-full bg-slate-200/50 p-1 transition-colors hover:bg-slate-200/80 dark:bg-white/5 dark:hover:bg-white/10"
            aria-label="Toggle language"
        >
            <motion.div
                className="absolute left-1 flex size-[24px] items-center justify-center rounded-full bg-white shadow-sm dark:bg-[#1a1921]"
                animate={{
                    x: isEN ? 36 : 0,
                }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
            >
                <span className="text-[10px] font-bold text-slate-800 dark:text-white">
                    {isEN ? "EN" : "TR"}
                </span>
            </motion.div>

            <div className="flex w-full justify-between px-1.5 text-[10px] font-bold text-slate-400 dark:text-slate-500">
                <span>TR</span>
                <span>EN</span>
            </div>
        </button>
    )
}
