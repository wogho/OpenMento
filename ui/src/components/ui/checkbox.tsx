"use client"

import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      // AppKit NSButton checkbox style
      "peer h-[18px] w-[18px] shrink-0 rounded-[5px]",
      "border-2 border-[rgba(0,0,0,0.2)] dark:border-[rgba(255,255,255,0.3)]",
      "bg-white dark:bg-[#1C1C1E]",
      "shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)]",
      "transition-all duration-150",
      "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#007AFF]/35 focus-visible:ring-offset-0",
      "disabled:cursor-not-allowed disabled:opacity-40",
      "data-[state=checked]:bg-[#007AFF] data-[state=checked]:border-[#007AFF]",
      "data-[state=checked]:shadow-[0_1px_2px_rgba(0,122,255,0.3)]",
      "dark:data-[state=checked]:bg-[#0A84FF] dark:data-[state=checked]:border-[#0A84FF]",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn("flex items-center justify-center text-white")}
    >
      <Check className="h-[11px] w-[11px]" strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
