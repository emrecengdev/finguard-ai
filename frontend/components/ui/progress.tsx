"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/lib/utils";

type ProgressProps = React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & {
  indicatorClassName?: string;
  value?: number;
};

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  ProgressProps
>(({ className, indicatorClassName, value = 0, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn(
      "relative h-2 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-white/8",
      className,
    )}
    value={value}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className={cn(
        "h-full w-full flex-1 rounded-full bg-[linear-gradient(90deg,rgba(37,99,235,0.88),rgba(14,165,233,0.82),rgba(16,185,129,0.78))] transition-transform duration-500 ease-out dark:bg-[linear-gradient(90deg,rgba(96,165,250,0.92),rgba(45,212,191,0.86),rgba(52,211,153,0.82))]",
        indicatorClassName,
      )}
      style={{ transform: `translateX(-${100 - Math.max(0, Math.min(value, 100))}%)` }}
    />
  </ProgressPrimitive.Root>
));

Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
