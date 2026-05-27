import type { ButtonHTMLAttributes, ReactNode } from "react"

import { cn } from "../../lib/utils"

type ButtonVariant = "default" | "outline" | "ghost" | "destructive"
type ButtonSize = "sm" | "md" | "icon"

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({
  children,
  className,
  size = "md",
  variant = "default",
  ...props
}: ButtonProps) {
  return (
    <button className={cn("rs-button", `rs-button-${variant}`, `rs-button-${size}`, className)} {...props}>
      {children}
    </button>
  )
}
