"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { motion } from "framer-motion"
import { useMounted } from "@/hooks/use-mounted"

export function ThemeToggle() {
    const { setTheme, theme, systemTheme } = useTheme()
    const mounted = useMounted()

    if (!mounted) {
        return <div className="w-[68px] h-[32px] rounded-full bg-black/5 dark:bg-white/5 animate-pulse" />
    }

    const currentTheme = theme === 'system' ? systemTheme : theme
    const isDark = currentTheme === 'dark'

    return (
        <button
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className="group relative flex h-[32px] w-[68px] cursor-pointer items-center rounded-full bg-slate-200/50 p-1 transition-colors hover:bg-slate-200/80 dark:bg-white/5 dark:hover:bg-white/10"
            aria-label="Toggle theme"
        >
            <motion.div
                className="absolute left-1 flex size-[24px] items-center justify-center rounded-full bg-white shadow-sm dark:bg-[#1a1921]"
                animate={{
                    x: isDark ? 36 : 0,
                }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
            >
                {isDark ? (
                    <Moon size={12} strokeWidth={2.5} className="text-emerald-500" />
                ) : (
                    <Sun size={13} strokeWidth={2.5} className="text-amber-500" />
                )}
            </motion.div>

            <div className="flex w-full justify-between px-1.5 text-slate-400 dark:text-slate-500">
                <Sun size={12} strokeWidth={2} />
                <Moon size={12} strokeWidth={2} />
            </div>
        </button>
    )
}
