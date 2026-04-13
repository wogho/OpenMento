import * as React from "react"

import { cn } from "@/lib/utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // AppKit NSTextField — rounded rect style
          "flex h-[34px] w-full rounded-[8px] px-3 py-0",
          "text-[13px] leading-none",
          "bg-white dark:bg-[#1C1C1E]",
          "border border-[rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.10)]",
          "text-[rgba(0,0,0,0.85)] dark:text-[rgba(255,255,255,0.85)]",
          "placeholder:text-[rgba(60,60,67,0.4)] dark:placeholder:text-[rgba(235,235,245,0.4)]",
          "shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)]",
          "transition-[border-color,box-shadow] duration-150",
          "focus-visible:outline-none",
          "focus-visible:border-[#007AFF] dark:focus-visible:border-[#0A84FF]",
          "focus-visible:shadow-[inset_0_1px_2px_rgba(0,0,0,0.04),0_0_0_3px_rgba(0,122,255,0.25)]",
          "dark:focus-visible:shadow-[inset_0_1px_2px_rgba(0,0,0,0.1),0_0_0_3px_rgba(10,132,255,0.3)]",
          "file:border-0 file:bg-transparent file:text-[13px] file:font-medium",
          "disabled:cursor-not-allowed disabled:opacity-40",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
