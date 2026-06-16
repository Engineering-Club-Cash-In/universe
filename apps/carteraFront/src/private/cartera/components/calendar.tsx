import { useState } from "react"
import { format, parse, isValid } from "date-fns"
import { es } from "date-fns/locale"
import { CalendarIcon, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react"
import { DayPicker } from "react-day-picker"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface DatePickerMUIProps {
  value?: string
  onChange?: (value: string) => void
  label?: string
  disableFuture?: boolean
  className?: string
}

// Estilos del calendario con utilidades Tailwind v3 (react-day-picker no trae CSS propio)
const dayPickerClassNames = {
  months: "relative",
  month: "space-y-3",
  month_caption: "flex justify-center items-center h-8 relative px-8",
  caption_label: "sr-only",
  nav: "absolute top-0 inset-x-0 flex items-center justify-between h-8",
  button_previous:
    "h-7 w-7 inline-flex items-center justify-center rounded-md text-gray-600 hover:bg-blue-50 disabled:opacity-30 disabled:hover:bg-transparent",
  button_next:
    "h-7 w-7 inline-flex items-center justify-center rounded-md text-gray-600 hover:bg-blue-50 disabled:opacity-30 disabled:hover:bg-transparent",
  dropdowns: "flex items-center justify-center gap-2",
  dropdown_root: "relative inline-flex items-center",
  dropdown:
    "appearance-none bg-white border border-gray-300 rounded-md pl-2 pr-6 py-1 text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 cursor-pointer",
  month_grid: "w-full border-collapse",
  weekdays: "flex",
  weekday:
    "w-9 h-8 text-xs font-semibold text-gray-400 flex items-center justify-center uppercase",
  week: "flex w-full mt-1",
  day: "w-9 h-9 p-0 text-center",
  day_button:
    "w-9 h-9 rounded-md text-sm text-gray-700 inline-flex items-center justify-center transition hover:bg-blue-50",
  selected:
    "[&>button]:bg-blue-600 [&>button]:text-white [&>button]:font-semibold [&>button:hover]:bg-blue-600",
  today: "[&:not([data-selected])>button]:text-blue-600 [&:not([data-selected])>button]:font-bold",
  outside: "[&>button]:text-gray-300",
  disabled: "[&>button]:text-gray-300 [&>button]:cursor-not-allowed [&>button:hover]:bg-transparent",
  hidden: "invisible",
}

/**
 * Selector de fecha con calendario emergente (react-day-picker + Popover),
 * estilizado con Tailwind para combinar con el resto de los campos.
 * El valor se maneja siempre en formato "YYYY-MM-DD".
 */
export function DatePickerMUI({
  value,
  onChange,
  disableFuture = true,
  className = "",
}: DatePickerMUIProps) {
  const [open, setOpen] = useState(false)

  const parsed = value ? parse(value, "yyyy-MM-dd", new Date()) : undefined
  const selected = parsed && isValid(parsed) ? parsed : undefined

  const today = new Date()

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "w-full flex items-center justify-between gap-2 border border-gray-300 rounded-lg px-3 py-2.5 bg-white text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition",
            selected ? "text-gray-900" : "text-gray-400",
            className
          )}
        >
          <span>{selected ? format(selected, "dd/MM/yyyy") : "DD/MM/YYYY"}</span>
          <CalendarIcon className="w-5 h-5 text-gray-400 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-3 bg-white border border-gray-200 rounded-xl shadow-lg"
        align="start"
      >
        <DayPicker
          mode="single"
          locale={es}
          selected={selected}
          defaultMonth={selected ?? today}
          captionLayout="dropdown"
          startMonth={new Date(2000, 0)}
          endMonth={disableFuture ? today : new Date(today.getFullYear() + 5, 11)}
          disabled={disableFuture ? { after: today } : undefined}
          onSelect={(date) => {
            onChange?.(date ? format(date, "yyyy-MM-dd") : "")
            setOpen(false)
          }}
          classNames={dayPickerClassNames}
          components={{
            Chevron: ({ orientation }) => {
              if (orientation === "left") return <ChevronLeft className="w-4 h-4" />
              if (orientation === "right") return <ChevronRight className="w-4 h-4" />
              return (
                <ChevronDown className="w-4 h-4 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500" />
              )
            },
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
