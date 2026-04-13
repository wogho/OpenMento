import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // Base — Apple HIG: precise radius, SF typography, spring press
  [
    "inline-flex items-center justify-center whitespace-nowrap",
    "text-[13px] font-medium leading-none tracking-[-0.01em]",
    "rounded-[8px] select-none",
    "transition-all duration-150 ease-out active:scale-[0.97]",
    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#007AFF]/40 focus-visible:ring-offset-0",
    "disabled:pointer-events-none disabled:opacity-40",
  ].join(" "),
  {
    variants: {
      variant: {
        // macOS AccentColor filled button
        default: [
          "bg-[#007AFF] text-white",
          "shadow-[0_1px_3px_rgba(0,122,255,0.4),inset_0_1px_0_rgba(255,255,255,0.18)]",
          "hover:bg-[#0071E3] active:bg-[#0068D0]",
          "dark:bg-[#0A84FF] dark:hover:bg-[#0076E4] dark:active:bg-[#006BCC]",
          "dark:focus-visible:ring-[#0A84FF]/40",
        ].join(" "),
        // macOS destructive button
        destructive: [
          "bg-[#FF3B30] text-white",
          "shadow-[0_1px_3px_rgba(255,59,48,0.35),inset_0_1px_0_rgba(255,255,255,0.16)]",
          "hover:bg-[#E0352B] active:bg-[#CC2F26]",
          "dark:bg-[#FF453A] dark:hover:bg-[#E33E34]",
          "focus-visible:ring-[#FF3B30]/40",
        ].join(" "),
        // AppKit bordered/bezel button
        outline: [
          "border border-[rgba(0,0,0,0.12)] bg-white text-[#007AFF]",
          "shadow-[0_1px_2px_rgba(0,0,0,0.06)]",
          "hover:bg-[rgba(0,122,255,0.05)] active:bg-[rgba(0,122,255,0.1)]",
          "dark:border-[rgba(255,255,255,0.12)] dark:bg-[#1C1C1E] dark:text-[#0A84FF]",
          "dark:hover:bg-[rgba(10,132,255,0.1)]",
        ].join(" "),
        // AppKit secondary / muted
        secondary: [
          "bg-[rgba(120,120,128,0.12)] text-[rgba(0,0,0,0.8)]",
          "hover:bg-[rgba(120,120,128,0.18)] active:bg-[rgba(120,120,128,0.24)]",
          "dark:bg-[rgba(120,120,128,0.24)] dark:text-[rgba(255,255,255,0.8)]",
          "dark:hover:bg-[rgba(120,120,128,0.32)]",
        ].join(" "),
        // AppKit borderless / plain button
        ghost: [
          "bg-transparent text-[#007AFF]",
          "hover:bg-[rgba(0,122,255,0.08)] active:bg-[rgba(0,122,255,0.14)]",
          "dark:text-[#0A84FF] dark:hover:bg-[rgba(10,132,255,0.12)]",
        ].join(" "),
        link: "bg-transparent text-[#007AFF] underline-offset-4 hover:underline dark:text-[#0A84FF]",
      },
      size: {
        default: "h-[34px] px-[14px] py-0",
        sm:      "h-[28px] px-[10px] text-[12px] rounded-[7px]",
        lg:      "h-[40px] px-[20px] text-[15px] rounded-[10px]",
        icon:    "h-[34px] w-[34px] p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }
