"use client"

import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      // iOS/macOS Toggle style
      "peer inline-flex h-[28px] w-[48px] shrink-0 cursor-pointer items-center rounded-full",
      "border-2 border-transparent",
      "transition-all duration-200 ease-in-out",
      "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#007AFF]/40 focus-visible:ring-offset-0",
      "disabled:cursor-not-allowed disabled:opacity-40",
      // Off: iOS system fill gray
      "data-[state=unchecked]:bg-[rgba(120,120,128,0.32)] dark:data-[state=unchecked]:bg-[rgba(120,120,128,0.45)]",
      // On: iOS system green
      "data-[state=checked]:bg-[#34C759] dark:data-[state=checked]:bg-[#30D158]",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block rounded-full bg-white",
        "h-[22px] w-[22px]",
        "shadow-[0_2px_4px_rgba(0,0,0,0.25),0_1px_2px_rgba(0,0,0,0.15)]",
        "ring-0",
        "transition-transform duration-200 ease-in-out",
        "data-[state=checked]:translate-x-[21px]",
        "data-[state=unchecked]:translate-x-[1px]",
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
