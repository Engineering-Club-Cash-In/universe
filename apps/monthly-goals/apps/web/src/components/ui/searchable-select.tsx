import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

interface SearchableSelectProps {
  value?: string
  onValueChange?: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  disabled?: boolean
  className?: string
}

interface SearchableSelectContextValue {
  search: string
  setSearch: (search: string) => void
}

const SearchableSelectContext = React.createContext<SearchableSelectContextValue>({
  search: "",
  setSearch: () => {},
})

function SearchableSelect({
  children,
  value,
  onValueChange,
  ...props
}: SearchableSelectProps & { children: React.ReactNode }) {
  const [search, setSearch] = React.useState("")
  const [open, setOpen] = React.useState(false)

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
    if (!newOpen) {
      // Reset search when closing
      setSearch("")
    }
  }

  return (
    <SearchableSelectContext.Provider value={{ search, setSearch }}>
      <SelectPrimitive.Root
        value={value}
        onValueChange={onValueChange}
        open={open}
        onOpenChange={handleOpenChange}
        {...props}
        // Disable native typeahead search
        dir="ltr"
      >
        {children}
      </SelectPrimitive.Root>
    </SearchableSelectContext.Provider>
  )
}

function SearchableSelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <span className="flex-1 text-left overflow-hidden">{children}</span>
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 opacity-50 shrink-0" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SearchableSelectContent({
  className,
  children,
  position = "popper",
  searchPlaceholder = "Buscar...",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content> & {
  searchPlaceholder?: string
}) {
  const { search, setSearch } = React.useContext(SearchableSelectContext)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [inputValue, setInputValue] = React.useState("")
  const debounceTimerRef = React.useRef<NodeJS.Timeout | null>(null)

  // Auto-focus the search input when content opens
  React.useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus()
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  // Sincronizar inputValue con search cuando cambie externamente
  React.useEffect(() => {
    setInputValue(search)
  }, [search])

  // Limpiar timeout al desmontar
  React.useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  // Función para manejar el cambio con debounce
  const handleSearchChange = (value: string) => {
    setInputValue(value)

    // Limpiar timeout anterior si existe
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    // Aplicar el filtro después de 300ms
    debounceTimerRef.current = setTimeout(() => {
      setSearch(value)
    }, 800)
  }

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        className={cn(
          "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-hidden rounded-md border shadow-md",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        onKeyDown={(e) => {
          // Prevent radix native typeahead search for all single character keypresses
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault()
            e.stopPropagation()
            // Focus input and append the key
            if (inputRef.current) {
              inputRef.current.focus()
              handleSearchChange(inputValue + e.key)
            }
          }
        }}
        {...props}
      >
        <div className="flex items-center border-b px-3 py-2">
          <SearchIcon className="mr-2 size-4 shrink-0 opacity-50" />
          <Input
            ref={inputRef}
            placeholder={searchPlaceholder}
            value={inputValue}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="h-8 border-0 px-0 py-0 shadow-none focus-visible:ring-0"
            onKeyDown={(e) => {
              // Prevent select from closing on Enter or Space
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation()
              }
              // Keep all keypress events from bubbling to prevent native search
              e.stopPropagation()
            }}
          />
        </div>
        <SelectPrimitive.Viewport
          className={cn(
            "p-1 max-h-[300px] overflow-y-auto",
            position === "popper" &&
              "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1"
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SearchableSelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value {...props} />
}

function SearchableSelectItem({
  className,
  children,
  searchValue,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item> & {
  searchValue?: string
}) {
  const { search } = React.useContext(SearchableSelectContext)

  // Filter logic
  const textToSearch = searchValue || (typeof children === 'string' ? children : '')
  const shouldShow = search === "" ||
    textToSearch.toLowerCase().includes(search.toLowerCase())

  if (!shouldShow) {
    return null
  }

  return (
    <SelectPrimitive.Item
      className={cn(
        "focus:bg-accent focus:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SearchableSelectEmpty({
  children = "No se encontraron resultados",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) {
  const { search } = React.useContext(SearchableSelectContext)

  if (search === "") {
    return null
  }

  return (
    <div
      className="py-6 text-center text-sm text-muted-foreground"
      {...props}
    >
      {children}
    </div>
  )
}

export {
  SearchableSelect,
  SearchableSelectTrigger,
  SearchableSelectContent,
  SearchableSelectValue,
  SearchableSelectItem,
  SearchableSelectEmpty,
}
