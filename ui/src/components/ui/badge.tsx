import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  // Apple system chip / label style
  "inline-flex items-center rounded-[6px] px-[8px] py-[3px] text-[11px] font-semibold border-0 transition-colors",
  {
    variants: {
      variant: {
        default:     "bg-[#007AFF]/10 text-[#007AFF] dark:bg-[#0A84FF]/15 dark:text-[#0A84FF]",
        secondary:   "bg-[rgba(120,120,128,0.12)] text-[rgba(60,60,67,0.8)] dark:bg-[rgba(120,120,128,0.24)] dark:text-[rgba(235,235,245,0.7)]",
        destructive: "bg-[#FF3B30]/10 text-[#FF3B30] dark:bg-[#FF453A]/15 dark:text-[#FF453A]",
        outline:     "border border-[rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.12)] text-foreground bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
