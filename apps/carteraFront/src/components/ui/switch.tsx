"use client"

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

function Switch({
  className,
  checked,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  const isChecked = checked ?? false

  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      checked={checked}
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      style={{
        backgroundColor: isChecked ? "#22c55e" : "#d1d5db",
        borderColor: isChecked ? "#16a34a" : "#9ca3af",
      }}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block h-4 w-4 rounded-full transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
        style={{
          backgroundColor: "#ffffff",
          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
        }}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
