import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Briefcase, TrendingUp, FileSignature, CheckCircle } from "lucide-react";
import type { DocumentCategoria } from "@/services/documents";

interface StepCategoryProps {
  readonly data: {
    category?: DocumentCategoria;
  };
  readonly onChange: (field: string, value: DocumentCategoria | null) => void;
}

const CATEGORIES: ReadonlyArray<{
  value: DocumentCategoria;
  label: string;
  description: string;
  icon: typeof Briefcase;
}> = [
  {
    value: "ventas",
    label: "Ventas",
    description: "Documentos relacionados con la venta y financiamiento de vehículos",
    icon: Briefcase,
  },
  {
    value: "inversiones",
    label: "Inversiones",
    description: "Documentos para inversionistas: acuerdos, anexos, cesiones y contratos",
    icon: TrendingUp,
  },
  {
    value: "carta_poder",
    label: "Carta Poder",
    description: "Documentos de representación y carta poder",
    icon: FileSignature,
  },
];

export function StepCategory({ data, onChange }: StepCategoryProps) {
  const selected = data.category;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Selecciona la categoría del documento que deseas generar.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {CATEGORIES.map((cat) => {
          const isSelected = selected === cat.value;
          const Icon = cat.icon;

          return (
            <Card
              key={cat.value}
              className={`cursor-pointer transition-all duration-200 hover:shadow-md border-2 ${
                isSelected
                  ? "border-primary bg-primary/5 shadow-md"
                  : "border-muted hover:border-primary/50"
              }`}
              onClick={() => onChange("category", cat.value)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-2">
                    <Icon className="h-5 w-5 text-primary" />
                    {isSelected && (
                      <CheckCircle className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  {isSelected && (
                    <Badge variant="default" className="text-xs">
                      Seleccionada
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <CardTitle className="text-base mb-2 leading-tight">
                  {cat.label}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {cat.description}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
