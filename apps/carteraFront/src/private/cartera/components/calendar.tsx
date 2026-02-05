import * as React from "react"
import dayjs, { Dayjs } from "dayjs"
import "dayjs/locale/es"

import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider"
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs"
import { DatePicker } from "@mui/x-date-pickers/DatePicker"

import TextField from "@mui/material/TextField"
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth"

interface DatePickerMUIProps {
  value?: string
  onChange?: (value: string) => void
  label?: string
}

export function DatePickerMUI({
  value,
  onChange,
 
}: DatePickerMUIProps) {
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="es">
      <DatePicker
     
        value={value ? dayjs(value) : null}
        maxDate={dayjs()} // 🚫 sin fechas futuras
        enableAccessibleFieldDOMStructure={false} // 🔥 FIX CLAVE
        onChange={(newValue: Dayjs | null) => {
          onChange?.(
            newValue ? newValue.format("YYYY-MM-DD") : ""
          )
        }}
        slots={{
          textField: TextField,
          openPickerIcon: CalendarMonthIcon,
        }}
        slotProps={{
          textField: {
            fullWidth: true,
            size: "medium",
          },
        }}
      />
    </LocalizationProvider>
  )
}
