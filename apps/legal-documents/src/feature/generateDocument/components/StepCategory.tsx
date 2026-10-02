import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Briefcase, TrendingUp, Building2, FileSignature, CheckCircle } from "lucide-react";
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
    description: "Contratos de compraventa y financiamiento de vehículos",
    icon: Briefcase,
  },
  {
    value: "inversiones",
    label: "Inversiones",
    description: "Acuerdos, anexos, cesiones y contratos para inversionistas",
    icon: TrendingUp,
  },
  {
    value: "inversiones_sociedad",
    label: "Inversiones Sociedad",
    description: "Contratos y acuerdos de inversión bajo figura de sociedad",
    icon: Building2,
  },
  {
    value: "carta_poder",
    label: "Carta Poder",
    description: "Documentos de representación y poderes de mandato",
    icon: FileSignature,
  },
];

/**
 * Categorías que ya no se generan acá sino en el CRM. Jurídico seguía armando
 * los contratos de ventas e inversiones en esta plataforma y no en el CRM, que
 * es donde salen a firma; se ocultan para que no haya dos caminos. Para volver
 * a mostrar una, sacarla de esta lista.
 */
const CATEGORIAS_EN_EL_CRM: ReadonlySet<DocumentCategoria> = new Set([
  "ventas",
  "inversiones",
  "inversiones_sociedad",
]);

const CATEGORIAS_VISIBLES = CATEGORIES.filter(
  (cat) => !CATEGORIAS_EN_EL_CRM.has(cat.value)
);

export function StepCategory({ data, onChange }: StepCategoryProps) {
  const selected = data.category;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Selecciona la categoría del documento que deseas generar.
      </p>

      <p className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
        Los contratos de ventas e inversiones se generan desde el CRM.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {CATEGORIAS_VISIBLES.map((cat) => {
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
