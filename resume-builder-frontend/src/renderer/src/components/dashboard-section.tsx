import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface DashboardSectionProps {
  title: string
  description?: string
  icon?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}

export function DashboardSection({
  title,
  description,
  icon,
  action,
  children,
  className,
  contentClassName,
}: DashboardSectionProps) {
  return (
    <section className={cn("border-t border-white/[0.08] py-7 first:border-t-0 sm:py-9", className)}>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            {icon && <span className="text-primary">{icon}</span>}
            <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">{title}</h2>
          </div>
          {description && (
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className={cn("space-y-5", contentClassName)}>{children}</div>
    </section>
  )
}
