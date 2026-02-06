import { useState, useRef, useEffect, useCallback } from "react";
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
  Sparkles,
  FileText,
  Camera,
  Upload,
} from "lucide-react";
import { useInspection, type SectionTimes } from "../contexts/InspectionContext";
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

// ==========================================
// CRITERIOS DE RECHAZO (Causales de rechazo)
// ==========================================
const rejectionCriteria: Array<{
  id: string;
  title: string;
  icon: typeof Shield;
  critical: boolean;
  items: Array<{ id: string; label: string; critical: boolean }>;
}> = [
    {
      id: "structural-damage",
      title: "Daños o Reparaciones Estructurales",
      icon: Shield,
      critical: true,
      items: [
        {
          id: "chassis-damage",
          label: "Daños en chasis, largueros longitudinales, zonas de deformación delantera y trasera",
          critical: true,
        },
        {
          id: "poor-paint-work",
          label: "Trabajos de pintura mal realizados en gran parte del vehículo",
          critical: true,
        },
        {
          id: "major-replacements",
          label: "Sustituciones mayores de piezas de estructura o carrocería",
          critical: true,
        },
        {
          id: "vin-altered",
          label: "Números de identificación alterados o no legibles (Chasis, VIN, motor, etc)",
          critical: true,
        },
        {
          id: "structural-corrosion",
          label: "Corrosión estructural avanzada y excesiva",
          critical: true,
        },
      ],
    },
    {
      id: "engine-transmission-rejection",
      title: "Condiciones de Motor y Transmisión",
      icon: Wrench,
      critical: true,
      items: [
        {
          id: "major-fluid-leaks",
          label: "Fugas mayores de fluidos (aceite, agua, refrigerante, frenos, transmisión)",
          critical: true,
        },
        {
          id: "abnormal-smoke",
          label: "Humo anormal (blanco, azul o negro)",
          critical: true,
        },
        {
          id: "engine-sounds",
          label: "Sonidos anormales en el motor (Golpeteo, problemas de encendido)",
          critical: true,
        },
        {
          id: "power-loss-transmission",
          label: "Pérdida de potencia, transmisión con respuesta irregular o golpeteo (verificar en prueba de manejo)",
          critical: true,
        },
      ],
    },
    {
      id: "suspension-brakes-steering-rejection",
      title: "Suspensión, Frenos y Dirección",
      icon: Gauge,
      critical: true,
      items: [
        {
          id: "shock-leaks",
          label: "Amortiguadores con fuga",
          critical: true,
        },
        {
          id: "brake-system-issues",
          label: "Sistema de frenos con ruidos anormales, fugas mayores en mangueras y tuberías",
          critical: true,
        },
        {
          id: "steering-wear",
          label: "Dirección y tren delantero con desgaste excesivo o vibración anormal",
          critical: true,
        },
      ],
    },
    {
      id: "body-glass-rejection",
      title: "Carrocería y Cristales",
      icon: Car,
      critical: true,
      items: [
        {
          id: "body-corrosion",
          label: "Corrosión de piezas de carrocería avanzada y excesiva",
          critical: true,
        },
        {
          id: "pillar-roof-damage",
          label: "Daños visibles en pilares, techo y marcos",
          critical: true,
        },
        {
          id: "paint-loose-parts",
          label: "Daños en pintura excesivos, piezas sueltas, presencia de masilla excesiva",
          critical: true,
        },
      ],
    },
  ];

// ==========================================
// PUNTOS DE INSPECCIÓN ADICIONALES (No causales de rechazo)
// ==========================================
const additionalInspectionPoints: Array<{
  id: string;
  title: string;
  icon: typeof Shield;
  critical: boolean;
  items: Array<{ id: string; label: string; critical: boolean }>;
}> = [
    {
      id: "engine-transmission-detail",
      title: "Motor y Transmisión (Detalle)",
      icon: Wrench,
      critical: false,
      items: [
        {
          id: "engine-startup",
          label: "Encendido sin ruidos ni vibraciones anormales",
          critical: false,
        },
        {
          id: "oil-transmission-leaks",
          label: "Ausencia de fugas de aceite o líquido de transmisión",
          critical: false,
        },
        {
          id: "engine-oil-condition",
          label: "Nivel y estado del aceite del motor (color, consistencia)",
          critical: false,
        },
        {
          id: "coolant-level",
          label: "Nivel y estado del líquido refrigerante",
          critical: false,
        },
        {
          id: "exhaust-smoke",
          label: "Ausencia de humo inusual en el escape (negro, azul o blanco constante)",
          critical: false,
        },
        {
          id: "hoses-belts",
          label: "Mangueras y correas en buen estado, sin grietas ni desgaste",
          critical: false,
        },
        {
          id: "obd2-scan",
          label: "Prueba de escáner OBD2 (sin errores activos)",
          critical: false,
        },
      ],
    },
    {
      id: "brakes-suspension-detail",
      title: "Frenos y Suspensión (Detalle)",
      icon: Gauge,
      critical: false,
      items: [
        {
          id: "brake-fluid-level",
          label: "Nivel del líquido de frenos",
          critical: false,
        },
        {
          id: "brake-pads-discs",
          label: "Desgaste de pastillas y discos de freno (surcos profundos o marcas inusuales)",
          critical: false,
        },
        {
          id: "brake-lines",
          label: "Líneas, mangueras y conexiones de frenos sin fugas ni corrosión",
          critical: false,
        },
        {
          id: "brake-pedal-travel",
          label: "Recorrido del pedal de freno (altura, juego libre y distancia de reserva)",
          critical: false,
        },
        {
          id: "shocks-suspension",
          label: "Amortiguadores y suspensión (prueba de rebote, ausencia de fugas, bases de amortiguadores)",
          critical: false,
        },
        {
          id: "dust-covers-bushings",
          label: "Guardapolvos y silentblocks visibles en buen estado",
          critical: false,
        },
      ],
    },
    {
      id: "steering-tires-detail",
      title: "Tren Delantero, Dirección y Neumáticos (Detalle)",
      icon: Car,
      critical: false,
      items: [
        {
          id: "ball-joints",
          label: "Rótulas",
          critical: false,
        },
        {
          id: "bushings",
          label: "Bujes",
          critical: false,
        },
        {
          id: "cv-joints",
          label: "Puntas de flecha",
          critical: false,
        },
        {
          id: "steering-rack",
          label: "Cremallera (verificación de fugas, estado de puntas)",
          critical: false,
        },
        {
          id: "stabilizer-bar",
          label: "Barra estabilizadora",
          critical: false,
        },
        {
          id: "steering-play",
          label: "Holgura de la dirección (excesivo movimiento del volante sin respuesta)",
          critical: false,
        },
        {
          id: "tire-wear-tread",
          label: "Desgaste uniforme de los neumáticos y profundidad de la banda de rodadura adecuada",
          critical: false,
        },
        {
          id: "tire-pressure",
          label: "Presión de aire correcta en todos los neumáticos (incluida la rueda de repuesto)",
          critical: false,
        },
      ],
    },
    {
      id: "electrical-other-detail",
      title: "Sistema Eléctrico y Otros (Detalle)",
      icon: Zap,
      critical: false,
      items: [
        {
          id: "lights-interior-exterior",
          label: "Funcionamiento de todas las luces exteriores e interiores",
          critical: false,
        },
        {
          id: "battery-condition",
          label: "Estado de la batería (terminales limpios, sin corrosión)",
          critical: false,
        },
        {
          id: "ac-heating-accessories",
          label: "Funcionamiento del aire acondicionado, calefacción, radio y otros accesorios",
          critical: false,
        },
        {
          id: "wipers-washer",
          label: "Limpiaparabrisas y líquido lavaparabrisas operativos",
          critical: false,
        },
        {
          id: "horn-functional",
          label: "Bocina funcional",
          critical: false,
        },
        {
          id: "warning-lights",
          label: "Testigos activos en el tablero (Check Engine, ABS, airbag)",
          critical: false,
        },
        {
          id: "odometer-tampered",
          label: "Kilometraje alterado",
          critical: false,
        },
        {
          id: "lights-broken",
          label: "Faros, frenos o luces direccionales quebrados y opacos",
          critical: false,
        },
        {
          id: "dashboard-altered",
          label: "Tablero alterado o con señales de manipulación",
          critical: false,
        },
      ],
    },
    {
      id: "tires-condition-detail",
      title: "Estado de Llantas (Detalle)",
      icon: Gauge,
      critical: false,
      items: [
        {
          id: "uneven-tire-wear",
          label: "Llantas con desgaste irregular",
          critical: false,
        },
        {
          id: "tire-bulges-cuts",
          label: "Abultamientos o cortes laterales",
          critical: false,
        },
      ],
    },
    {
      id: "documentation",
      title: "Documentación y Legalidad",
      icon: FileText,
      critical: false,
      items: [
        {
          id: "vin-mismatch",
          label: "VIN no coincide con papelería",
          critical: false,
        },
        {
          id: "theft-report",
          label: "Vehículo con reporte de robo o antecedentes dudosos",
          critical: false,
        },
        {
          id: "pending-fines",
          label: "Multas graves pendientes o papelería incompleta",
          critical: false,
        },
      ],
    },
  ];

// Combinar todas las categorías
const inspectionCategories = [...rejectionCriteria, ...additionalInspectionPoints];

interface InspectionChecklistProps {
  onComplete?: () => void;
  isWizardMode?: boolean;
}

export default function InspectionChecklist({
  onComplete,
  isWizardMode = false
}: InspectionChecklistProps) {
  const { setChecklistItems, setSectionTimes, setRejectionEvidenceUrl, rejectionEvidenceUrl, formData: contextFormData } = useInspection();

  // Local state for evidence upload
  const [isUploadingEvidence, setIsUploadingEvidence] = useState(false);
  const evidenceInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [expandedCategories, setExpandedCategories] = useState<
    Record<string, boolean>
  >({});
  const [showOnlyCritical, setShowOnlyCritical] = useState(false);

  // Check if dev mode is enabled
  const isDevMode = import.meta.env.VITE_DEV_MODE === 'TRUE';

  // Track start times for open categories
  const categoryStartTimes = useRef<Record<string, number>>({});

  // Save accumulated time for a category
  const saveTimeForCategory = useCallback((categoryId: string) => {
    const startTime = categoryStartTimes.current[categoryId];
    if (startTime) {
      const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
      if (elapsedSeconds > 0) {
        setSectionTimes((prev: SectionTimes) => ({
          ...prev,
          [categoryId]: (prev[categoryId] || 0) + elapsedSeconds,
        }));
      }
      delete categoryStartTimes.current[categoryId];
    }
  }, [setSectionTimes]);

  // Initialize start times for categories that start expanded (default behavior)
  useEffect(() => {
    const now = Date.now();
    inspectionCategories.forEach((cat) => {
      // Categories default to expanded (expandedCategories[cat.id] ?? true)
      // If not explicitly collapsed, start tracking time
      if (expandedCategories[cat.id] === undefined || expandedCategories[cat.id]) {
        if (!categoryStartTimes.current[cat.id]) {
          categoryStartTimes.current[cat.id] = now;
        }
      }
    });
  }, []); // Only run on mount

  // Save times for all open categories on unmount
  useEffect(() => {
    return () => {
      Object.keys(categoryStartTimes.current).forEach(saveTimeForCategory);
    };
  }, [saveTimeForCategory]);

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
        // Always include the item in the checklist data
        // In the UI: checked = true means the item has issues (doesn't comply)
        // In the DB: checked = true means the issue is active/present
        checklistData.push({
          category: category.id,
          item: item.label,
          checked: items[item.id] || false, // If marked in UI, it means there's an issue (true), otherwise false
          severity: item.critical ? 'critical' : 'warning',
        });
      });
    });
    setChecklistItems(checklistData);
  };

  // Handle evidence upload
  const handleEvidenceUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploadingEvidence(true);
    const formData = new FormData();
    formData.append("file", file);
    // Usar ID real o generar uno temporal consistente con vehicle-pictures
    const vId = contextFormData?.id || `temp-${Date.now()}`;
    formData.append("vehicleId", vId);
    formData.append("category", "rejection_evidence");
    formData.append("photoType", "rejection_proof");
    formData.append("title", "Evidencia de Rechazo");
    formData.append("description", "Foto adjunta al rechazo del vehículo");

    try {
      const response = await fetch(`${import.meta.env.VITE_SERVER_URL || 'http://localhost:3000'}/api/upload-vehicle-photo`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Error al subir imagen");
      }

      const result = await response.json();
      // El backend devuelve { success: true, data: { url: ... } }
      const url = result.data?.url || result.url;

      if (url) {
        setRejectionEvidenceUrl(url);
        toast.success("Evidencia adjuntada correctamente");
      }
    } catch (error) {
      console.error("Error uploading evidence:", error);
      toast.error("Error al subir la evidencia");
    } finally {
      setIsUploadingEvidence(false);
    }
  };

  // Toggle category expansion
  const toggleCategory = (categoryId: string) => {
    setExpandedCategories((prev) => {
      const wasExpanded = prev[categoryId];
      const willExpand = !wasExpanded;

      if (willExpand) {
        // Starting to view this category - record start time
        categoryStartTimes.current[categoryId] = Date.now();
      } else {
        // Closing this category - save accumulated time
        saveTimeForCategory(categoryId);
      }

      return {
        ...prev,
        [categoryId]: willExpand,
      };
    });
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
    const now = Date.now();
    inspectionCategories.forEach((cat) => {
      expanded[cat.id] = true;
      // Start tracking time for newly expanded categories
      if (!expandedCategories[cat.id]) {
        categoryStartTimes.current[cat.id] = now;
      }
    });
    setExpandedCategories(expanded);
  };

  const collapseAll = () => {
    // Save times for all currently expanded categories
    Object.keys(expandedCategories).forEach((categoryId) => {
      if (expandedCategories[categoryId]) {
        saveTimeForCategory(categoryId);
      }
    });
    setExpandedCategories({});
  };

  // Function to fill checklist with dummy data
  const fillWithDummyData = () => {
    const dummyCheckedItems: Record<string, boolean> = {};

    // Randomly select some items to check (simulate issues found)
    // Let's check a few items to simulate a realistic inspection
    dummyCheckedItems['visible-leaks'] = true; // Minor oil leak
    dummyCheckedItems['brake-issues'] = false; // Brakes OK
    dummyCheckedItems['uneven-wear'] = true; // Uneven tire wear
    dummyCheckedItems['front-left-wheel'] = false;
    dummyCheckedItems['chassis-bent'] = false; // No structural damage
    dummyCheckedItems['warning-lights'] = false; // No warning lights

    // Set most items as OK (not checked)
    inspectionCategories.forEach((category) => {
      category.items.forEach((item) => {
        if (!(item.id in dummyCheckedItems)) {
          dummyCheckedItems[item.id] = false; // Most items are OK
        }
      });
    });

    setCheckedItems(dummyCheckedItems);
    updateChecklistContext(dummyCheckedItems);

    // Expand all categories to show the results
    expandAll();
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
            {isDevMode && (
              <Button
                variant="outline"
                size="sm"
                onClick={fillWithDummyData}
                className="gap-2"
              >
                <Sparkles className="h-4 w-4" />
                Llenar con datos de prueba
              </Button>
            )}
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
        <Card className="border-2">
          <CardContent className="py-8">
            <div className="flex flex-col items-center text-center space-y-6">
              {/* Status Icon */}
              <div className={cn(
                "w-20 h-20 rounded-full flex items-center justify-center",
                hasRejectionCriteria ? "bg-red-100" : "bg-green-100"
              )}>
                {hasRejectionCriteria ? (
                  <XCircle className="w-12 h-12 text-red-600" />
                ) : (
                  <CheckCircle className="w-12 h-12 text-green-600" />
                )}
              </div>

              {/* Status Text */}
              <div className="space-y-2">
                <h3 className="text-lg font-semibold">
                  Evaluación de Criterios Completada
                </h3>
                <p className="text-muted-foreground">
                  Basado en los criterios evaluados, el vehículo se considera:
                </p>
              </div>

              {/* Status Badge */}
              <Badge
                variant={hasRejectionCriteria ? "destructive" : "default"}
                className="text-xl px-6 py-2"
              >
                {hasRejectionCriteria ? "RECHAZADO" : "APROBADO"}
              </Badge>

              {/* Rejection Reasons if any */}
              {hasRejectionCriteria && (
                <div className="w-full max-w-md space-y-4">
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-left">
                    <p className="text-sm font-medium text-red-900 mb-2">
                      Criterios de rechazo encontrados:
                    </p>
                    <ul className="text-sm text-red-700 space-y-1">
                      {inspectionCategories
                        .flatMap(category =>
                          category.items
                            .filter(item => checkedItems[item.id] && item.critical)
                            .map(item => item.label)
                        )
                        .map((label, index) => (
                          <li key={index} className="flex items-start">
                            <span className="mr-2">•</span>
                            <span>{label}</span>
                          </li>
                        ))}
                    </ul>
                  </div>

                  {/* Evidence Upload Section */}
                  <div className="border border-dashed border-red-300 rounded-lg p-4 bg-red-50/50">
                    <div className="flex flex-col items-center gap-3">
                      <h4 className="text-sm font-medium text-red-800">Evidencia de Rechazo (Opcional)</h4>

                      {rejectionEvidenceUrl ? (
                        <div className="relative w-full aspect-video max-w-xs rounded-lg overflow-hidden border border-slate-200 bg-black">
                          <img src={rejectionEvidenceUrl} alt="Evidencia" className="object-contain w-full h-full" />
                          <Button
                            size="icon"
                            variant="destructive"
                            className="absolute top-2 right-2 h-6 w-6"
                            onClick={() => setRejectionEvidenceUrl(undefined)}
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <>
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="hidden"
                            ref={cameraInputRef}
                            onChange={handleEvidenceUpload}
                          />
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            ref={evidenceInputRef}
                            onChange={handleEvidenceUpload}
                          />
                          <div className="grid grid-cols-2 gap-3 w-full max-w-sm">
                            <Button
                              type="button"
                              variant="outline"
                              className="h-20 flex flex-col gap-2 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                              onClick={() => cameraInputRef.current?.click()}
                              disabled={isUploadingEvidence}
                            >
                              <Camera className="h-6 w-6" />
                              <span>Tomar Foto</span>
                            </Button>

                            <Button
                              type="button"
                              variant="outline"
                              className="h-20 flex flex-col gap-2 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                              onClick={() => evidenceInputRef.current?.click()}
                              disabled={isUploadingEvidence}
                            >
                              <Upload className="h-6 w-6" />
                              <span>Galería</span>
                            </Button>
                          </div>
                          {isUploadingEvidence && (
                            <p className="text-xs text-red-600 animate-pulse mt-1">
                              Subiendo evidencia...
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Action Button */}
              <Button
                onClick={onComplete}
                size="lg"
                className="mt-4"
                variant={hasRejectionCriteria ? "destructive" : "default"}
              >
                <CheckCircle className="mr-2 h-5 w-5" />
                Confirmar Evaluación y Continuar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}