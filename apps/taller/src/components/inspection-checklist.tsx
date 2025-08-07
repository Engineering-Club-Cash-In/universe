import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronRight,
  FileWarning,
  Wrench,
  Car,
  Gauge,
  Shield,
  Zap,
  FileText,
} from "lucide-react";
import { useInspection } from "../contexts/InspectionContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

// Definición de categorías y puntos críticos de inspección
const inspectionCategories = [
  {
    id: "structural",
    title: "Daños Estructurales o Reparaciones Mayores",
    icon: Shield,
    critical: true,
    items: [
      {
        id: "chassis-bent",
        label: "Chasis doblado, soldado o con signos de corte",
        critical: true,
      },
      {
        id: "poor-repairs",
        label: "Reparaciones mal ejecutadas tras colisiones graves",
        critical: true,
      },
      {
        id: "rebuilt-signs",
        label: "Señales de haber sido reconstruido o armado",
        critical: true,
      },
      {
        id: "vin-altered",
        label: "Número de chasis/VIN alterado o no legible",
        critical: true,
      },
    ],
  },
  {
    id: "engine-transmission",
    title: "Condición del Motor y Transmisión",
    icon: Wrench,
    critical: true,
    items: [
      {
        id: "visible-leaks",
        label: "Fugas visibles de aceite, agua o combustible",
        critical: true,
      },
      {
        id: "abnormal-smoke",
        label: "Humo anormal (blanco, azul, negro)",
        critical: true,
      },
      {
        id: "engine-knock",
        label: "Golpeteo en el motor o problemas de encendido",
        critical: true,
      },
      {
        id: "transmission-issues",
        label: "Transmisión con patinaje, golpes o respuesta irregular",
        critical: true,
      },
    ],
  },
  {
    id: "suspension-brakes",
    title: "Suspensión, Frenos y Dirección",
    icon: Gauge,
    critical: true,
    items: [
      {
        id: "shock-absorbers",
        label: "Amortiguadores sin retención o con fugas",
        critical: true,
      },
      {
        id: "brake-issues",
        label: "Frenos con ruido, falta de presión o desgaste extremo",
        critical: true,
      },
      {
        id: "joints-bushings",
        label: "Rótulas, terminales o bujes deteriorados",
        critical: true,
      },
      {
        id: "steering-play",
        label: "Dirección con juego excesivo o vibración anormal",
        critical: true,
      },
    ],
  },
  {
    id: "body-glass",
    title: "Carrocería y Cristales",
    icon: Car,
    critical: true,
    items: [
      {
        id: "structural-rust",
        label: "Oxidación estructural avanzada",
        critical: true,
      },
      {
        id: "visible-damage",
        label: "Daños visibles en pilares, techo o marcos",
        critical: true,
      },
      {
        id: "loose-parts",
        label: "Bumper, luces o piezas sueltas o ausentes",
        critical: true,
      },
    ],
  },
  {
    id: "tires",
    title: "Estado de Llantas",
    icon: Gauge,
    critical: true,
    items: [
      {
        id: "uneven-wear",
        label: "Llantas con desgaste disparejo",
        critical: true,
      },
      {
        id: "bulges-cuts",
        label: "Abultamientos o cortes laterales",
        critical: true,
      },
    ],
  },
  {
    id: "electrical-system",
    title: "Sistema Eléctrico y Tablero",
    icon: Zap,
    critical: true,
    items: [
      {
        id: "warning-lights",
        label: "Testigos activos en el tablero (Check Engine, ABS, airbag)",
        critical: true,
      },
      {
        id: "odometer-tampered",
        label: "Kilometraje alterado",
        critical: true,
      },
      {
        id: "lights-broken",
        label: "Faros, frenos o luces direccionales quebrados y opacos",
        critical: true,
      },
      {
        id: "dashboard-altered",
        label: "Tablero alterado o con señales de manipulación",
        critical: true,
      },
    ],
  },
  {
    id: "documentation",
    title: "Documentación y Legalidad",
    icon: FileText,
    critical: true,
    items: [
      {
        id: "vin-mismatch",
        label: "VIN no coincide con papelería",
        critical: true,
      },
      {
        id: "theft-report",
        label: "Vehículo con reporte de robo o antecedentes dudosos",
        critical: true,
      },
      {
        id: "pending-fines",
        label: "Multas graves pendientes o papelería incompleta",
        critical: true,
      },
    ],
  },
];

interface InspectionChecklistProps {
  onComplete?: () => void;
  isWizardMode?: boolean;
}

export default function InspectionChecklist({ 
  onComplete, 
  isWizardMode = false 
}: InspectionChecklistProps) {
  const { setChecklistItems } = useInspection();
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [expandedCategories, setExpandedCategories] = useState<
    Record<string, boolean>
  >({});
  const [showOnlyCritical, setShowOnlyCritical] = useState(false);

  // Toggle item check
  const toggleItem = (itemId: string) => {
    setCheckedItems((prev) => {
      const newState = {
        ...prev,
        [itemId]: !prev[itemId],
      };
      
      // Update context with checklist items
      updateChecklistContext(newState);
      
      return newState;
    });
  };
  
  // Update checklist items in context
  const updateChecklistContext = (items: Record<string, boolean>) => {
    const checklistData: Array<{
      category: string;
      item: string;
      checked: boolean;
      severity: string;
    }> = [];
    inspectionCategories.forEach((category) => {
      category.items.forEach((item) => {
        if (items[item.id]) {
          checklistData.push({
            category: category.title,
            item: item.label,
            checked: true,
            severity: item.critical ? 'critical' : 'warning',
          });
        }
      });
    });
    setChecklistItems(checklistData);
  };

  // Toggle category expansion
  const toggleCategory = (categoryId: string) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [categoryId]: !prev[categoryId],
    }));
  };

  // Calculate statistics
  const calculateStats = () => {
    let totalItems = 0;
    let checkedCount = 0;
    let criticalIssues = 0;

    inspectionCategories.forEach((category) => {
      category.items.forEach((item) => {
        totalItems++;
        if (checkedItems[item.id]) {
          checkedCount++;
          if (item.critical) {
            criticalIssues++;
          }
        }
      });
    });

    return { totalItems, checkedCount, criticalIssues };
  };

  const stats = calculateStats();
  const hasRejectionCriteria = stats.criticalIssues > 0;

  // Expand all / Collapse all
  const expandAll = () => {
    const expanded: Record<string, boolean> = {};
    inspectionCategories.forEach((cat) => {
      expanded[cat.id] = true;
    });
    setExpandedCategories(expanded);
  };

  const collapseAll = () => {
    setExpandedCategories({});
  };

  return (
    <div className="space-y-6">
      {/* Header and Stats */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileWarning className="h-5 w-5" />
            Lista de Verificación de Inspección
          </CardTitle>
          <CardDescription>
            Puntos críticos que determinan el rechazo o aprobación del vehículo
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <span className="text-sm text-muted-foreground">
                Items Revisados
              </span>
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span className="font-semibold">
                  {stats.checkedCount}/{stats.totalItems}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <span className="text-sm text-muted-foreground">
                Problemas Críticos
              </span>
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                <span className="font-semibold">{stats.criticalIssues}</span>
              </div>
            </div>
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <span className="text-sm text-muted-foreground">Estado</span>
              <Badge
                variant={hasRejectionCriteria ? "destructive" : "default"}
                className="gap-1"
              >
                {hasRejectionCriteria ? (
                  <>
                    <XCircle className="h-3 w-3" />
                    Rechazado
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-3 w-3" />
                    Aprobado
                  </>
                )}
              </Badge>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={expandAll}>
              Expandir Todo
            </Button>
            <Button variant="outline" size="sm" onClick={collapseAll}>
              Colapsar Todo
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowOnlyCritical(!showOnlyCritical)}
            >
              {showOnlyCritical ? "Mostrar Todo" : "Solo Críticos"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Alert for rejection */}
      {hasRejectionCriteria && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Vehículo No Apto para Aprobación</AlertTitle>
          <AlertDescription>
            Se han detectado {stats.criticalIssues} problema(s) crítico(s) que
            son causales de rechazo según los criterios de inspección.
          </AlertDescription>
        </Alert>
      )}

      {/* Categories */}
      <div className="space-y-4">
        {inspectionCategories.map((category) => {
          const CategoryIcon = category.icon;
          const isExpanded = expandedCategories[category.id] ?? true;
          const categoryIssues = category.items.filter(
            (item) => checkedItems[item.id]
          ).length;

          return (
            <Card key={category.id}>
              <Collapsible
                open={isExpanded}
                onOpenChange={() => toggleCategory(category.id)}
              >
                <CollapsibleTrigger className="w-full">
                  <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <CategoryIcon className="h-5 w-5 text-muted-foreground" />
                        <div className="text-left">
                          <CardTitle className="text-base">
                            {category.title}
                          </CardTitle>
                          <CardDescription className="text-xs mt-1">
                            {categoryIssues} de {category.items.length} problemas
                            detectados
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {categoryIssues > 0 && (
                          <Badge variant="destructive" className="text-xs">
                            {categoryIssues}
                          </Badge>
                        )}
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </div>
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0">
                    <div className="space-y-3">
                      {category.items.map((item) => (
                        <div
                          key={item.id}
                          className={cn(
                            "flex items-start gap-3 p-3 rounded-lg border transition-colors",
                            checkedItems[item.id]
                              ? "bg-destructive/10 border-destructive/30"
                              : "hover:bg-muted/50"
                          )}
                        >
                          <Checkbox
                            id={item.id}
                            checked={checkedItems[item.id] || false}
                            onCheckedChange={() => toggleItem(item.id)}
                            className="mt-0.5"
                          />
                          <label
                            htmlFor={item.id}
                            className="flex-1 cursor-pointer text-sm"
                          >
                            {item.label}
                            {item.critical && (
                              <Badge
                                variant="outline"
                                className="ml-2 text-xs px-1.5 py-0"
                              >
                                Crítico
                              </Badge>
                            )}
                          </label>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          );
        })}
      </div>

      {/* Summary Actions */}
      {!isWizardMode && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex justify-between items-center">
              <div className="text-sm text-muted-foreground">
                Basado en los criterios evaluados, el vehículo se considera:
              </div>
              <Button
                variant={hasRejectionCriteria ? "destructive" : "default"}
                size="lg"
              >
                {hasRejectionCriteria ? (
                  <>
                    <XCircle className="mr-2 h-4 w-4" />
                    Rechazar Vehículo
                  </>
                ) : (
                  <>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Aprobar Vehículo
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Wizard Mode Confirmation */}
      {isWizardMode && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex justify-between items-center">
              <div>
                <div className="text-sm text-muted-foreground">
                  Basado en los criterios evaluados, el vehículo se considera:
                </div>
                <div className="mt-2">
                  <Badge
                    variant={hasRejectionCriteria ? "destructive" : "default"}
                    className="text-base px-3 py-1"
                  >
                    {hasRejectionCriteria ? "RECHAZADO" : "APROBADO"}
                  </Badge>
                </div>
              </div>
              <Button
                onClick={onComplete}
                variant="outline"
                size="lg"
              >
                <CheckCircle className="mr-2 h-4 w-4" />
                Confirmar Evaluación
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}