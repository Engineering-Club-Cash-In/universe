import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import type { Field } from "../hooks/useStep2";

interface FieldRendererProps {
  readonly field: Field;
  readonly value: string;
  readonly hasError: boolean;
  readonly onChange: (key: string, value: string) => void;
}

type ListItem = Record<string, string>;

function parseListValue(raw: string): ListItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function ListField({ field, value, onChange }: FieldRendererProps) {
  const items = useMemo(() => parseListValue(value), [value]);
  const subFields = field.options ?? [];

  const setItems = (next: ListItem[]) => {
    onChange(field.key, JSON.stringify(next));
  };

  const handleItemChange = (idx: number, subKey: string, val: string) => {
    const next = items.map((item, i) =>
      i === idx ? { ...item, [subKey]: val } : item
    );
    setItems(next);
  };

  const addItem = () => {
    const blank: ListItem = Object.fromEntries(
      subFields.map((f) => [f.value, ""])
    );
    setItems([...items, blank]);
  };

  const removeItem = (idx: number) => {
    setItems(items.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3">
      {items.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          Aún no has agregado items. Pulsa "Agregar" para empezar.
        </p>
      )}

      {items.map((item, idx) => (
        <div
          key={idx}
          className="border rounded-md p-3 space-y-2 bg-muted/20"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Item #{idx + 1}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeItem(idx)}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {subFields.map((sub) => (
              <div key={sub.value} className="flex flex-col">
                <label className="text-xs mb-1 text-muted-foreground">
                  {sub.label}
                </label>
                <Input
                  value={item[sub.value] ?? ""}
                  onChange={(e) =>
                    handleItemChange(idx, sub.value, e.target.value)
                  }
                  placeholder={sub.label}
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addItem}
        className="gap-2"
      >
        <Plus className="h-4 w-4" />
        Agregar
      </Button>
    </div>
  );
}

function SelectFieldRenderer({
  field,
  value,
  hasError,
  onChange,
}: FieldRendererProps) {
  const options = field.options ?? [];

  return (
    <Select
      value={value || undefined}
      onValueChange={(val) => onChange(field.key, val)}
    >
      <SelectTrigger
        id={field.key}
        className={hasError ? "border-red-500" : ""}
      >
        <SelectValue placeholder={`Selecciona ${field.name.toLowerCase()}`} />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TextField({ field, value, hasError, onChange }: FieldRendererProps) {
  return (
    <Input
      id={field.key}
      value={value || ""}
      onChange={(e) => onChange(field.key, e.target.value)}
      placeholder={
        field.default
          ? `Por defecto: ${field.default}`
          : `Ingresa ${field.name.toLowerCase()}`
      }
      className={hasError ? "border-red-500" : ""}
    />
  );
}

export function FieldRenderer(props: FieldRendererProps) {
  switch (props.field.type) {
    case "select":
      return <SelectFieldRenderer {...props} />;
    case "list":
      return <ListField {...props} />;
    case "text":
    default:
      return <TextField {...props} />;
  }
}
