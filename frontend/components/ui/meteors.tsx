"use client"

import React, { useMemo } from "react"

import { cn } from "@/lib/utils"

interface MeteorsProps {
  number?: number
  minDelay?: number
  maxDelay?: number
  minDuration?: number
  maxDuration?: number
  angle?: number
  className?: string
}

function pseudoRandom(seed: number) {
  const x = Math.sin(seed) * 10000
  return x - Math.floor(x)
}

export const Meteors = ({
  number = 20,
  minDelay = 0.2,
  maxDelay = 1.2,
  minDuration = 2,
  maxDuration = 10,
  angle = 215,
  className,
}: MeteorsProps) => {
  const meteorStyles = useMemo<Array<React.CSSProperties>>(() => {
    const viewportWidth = typeof window === "undefined" ? 0 : window.innerWidth

    return [...new Array(number)].map(() => ({
      "--angle": -angle + "deg",
      top: "-5%",
    })).map((style, index) => {
      const baseSeed = (index + 1) * 97 + angle * 13 + number * 17
      const leftOffset = Math.floor(pseudoRandom(baseSeed) * viewportWidth)
      const delaySeconds =
        pseudoRandom(baseSeed + 1) * (maxDelay - minDelay) + minDelay
      const durationSeconds =
        Math.floor(
          pseudoRandom(baseSeed + 2) * (maxDuration - minDuration) + minDuration
        )

      return {
        ...style,
        left: `calc(0% + ${leftOffset}px)`,
        animationDelay: `${delaySeconds}s`,
        animationDuration: `${durationSeconds}s`,
      }
    })
  }, [angle, maxDelay, maxDuration, minDelay, minDuration, number])

  return (
    <>
      {[...meteorStyles].map((style, idx) => (
        // Meteor Head
        <span
          key={idx}
          style={{ ...style }}
          className={cn(
            "animate-meteor pointer-events-none absolute size-0.5 rotate-[var(--angle)] rounded-full bg-zinc-500 shadow-[0_0_0_1px_#ffffff10]",
            className
          )}
        >
          {/* Meteor Tail */}
          <div className="pointer-events-none absolute top-1/2 -z-10 h-px w-[50px] -translate-y-1/2 bg-gradient-to-r from-zinc-500 to-transparent" />
        </span>
      ))}
    </>
  )
}
