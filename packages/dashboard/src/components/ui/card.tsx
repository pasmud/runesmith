import type { HTMLAttributes, ReactNode } from "react"

import { cn } from "../../lib/utils"

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode
}

export function Card({ children, className, ...props }: CardProps) {
  return (
    <div className={cn("rs-card", className)} {...props}>
      {children}
    </div>
  )
}

export function CardHeader({ children, className, ...props }: CardProps) {
  return (
    <div className={cn("rs-card-header", className)} {...props}>
      {children}
    </div>
  )
}

export function CardTitle({ children, className, ...props }: CardProps) {
  return (
    <h3 className={cn("rs-card-title", className)} {...props}>
      {children}
    </h3>
  )
}

export function CardDescription({ children, className, ...props }: CardProps) {
  return (
    <p className={cn("rs-card-description", className)} {...props}>
      {children}
    </p>
  )
}

export function CardContent({ children, className, ...props }: CardProps) {
  return (
    <div className={cn("rs-card-content", className)} {...props}>
      {children}
    </div>
  )
}
