import type { HTMLAttributes, ReactNode } from "react"

import { cn } from "../../lib/utils"

type BadgeTone = "neutral" | "running" | "verified" | "stale" | "blocked"

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode
  tone?: BadgeTone
}

export function Badge({ children, className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span className={cn("rs-badge", `rs-badge-${tone}`, className)} {...props}>
      {children}
    </span>
  )
}
