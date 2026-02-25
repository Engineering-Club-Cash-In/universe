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
import { toast } from "sonner";

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
        {
          id: "structural-other",
          label: "Otros (especificar)",
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
        {
          id: "engine-transmission-other",
          label: "Otros (especificar)",
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
        {
          id: "suspension-brakes-steering-other",
          label: "Otros (especificar)",
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
        {
          id: "body-glass-other",
          label: "Otros (especificar)",
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
        {
          id: "documentation-other",
          label: "Otros (especificar)",
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
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [itemEvidence, setItemEvidence] = useState<Record<string, Array<{url: string, mimeType: string, originalName: string}>>>({});
  const [isUploadingItemEvidence, setIsUploadingItemEvidence] = useState<Record<string, boolean>>({});
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
    setCheckedItems((prev) => ({
      ...prev,
      [itemId]: !prev[itemId], // Toggle state
    }));
  };

  // Sync local changes to context automatically
  useEffect(() => {
    const checklistData: Array<{
      category: string;
      item: string;
      checked: boolean;
      severity: string;
      notes?: string;
      evidence?: Array<any>;
    }> = [];
    inspectionCategories.forEach((category) => {
      category.items.forEach((item) => {
        checklistData.push({
          category: category.id,
          item: item.label,
          checked: checkedItems[item.id] || false,
          severity: item.critical ? 'critical' : 'warning',
          notes: itemNotes[item.id],
          evidence: itemEvidence[item.id] || [],
        });
      });
    });
    setChecklistItems(checklistData);
  }, [checkedItems, itemNotes, itemEvidence, setChecklistItems]);

  const handleItemNoteChange = (itemId: string, note: string) => {
    setItemNotes(prev => ({ ...prev, [itemId]: note }));
  };

  const handleItemEvidenceUpload = async (itemId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const maxSize = 10 * 1024 * 1024; // 10MB
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];

    if (file.size > maxSize) {
      toast.error("File exceeds the maximum limit of 10MB.");
      event.target.value = '';
      return;
    }

    if (!allowedTypes.includes(file.type)) {
      toast.error("Invalid format. Use JPG, PNG or WEBP.");
      event.target.value = '';
      return;
    }

    setIsUploadingItemEvidence(prev => ({ ...prev, [itemId]: true }));
    const formData = new FormData();
    formData.append("file", file);
    const vId = contextFormData?.id || `temp-${Date.now()}`;
    formData.append("vehicleId", vId);
    formData.append("category", "checklist_evidence");
    formData.append("photoType", "checklist_item_proof");
    formData.append("title", "Evidencia de inspección");

    try {
      const response = await fetch(`${import.meta.env.VITE_SERVER_URL || 'http://localhost:3000'}/api/upload-vehicle-photo`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to upload file");
      }

      const result = await response.json();
      const url = result.data?.url || result.url;

      if (url) {
        setItemEvidence(prev => {
          const currentList = prev[itemId] || [];
          return {
            ...prev,
            [itemId]: [...currentList, { url, mimeType: file.type, originalName: file.name }]
          };
        });
        toast.success("Evidence attached to item successfully");
      }
    } catch (error: any) {
      console.error("Item evidence upload error:", error);
      toast.error(error.message || "Failed to upload item evidence. Please try again.");
    } finally {
      setIsUploadingItemEvidence(prev => ({ ...prev, [itemId]: false }));
      event.target.value = '';
    }
  };

  const deleteItemEvidence = (itemId: string, indexToRemove: number) => {
    setItemEvidence(prev => {
      const currentList = prev[itemId] || [];
      const updatedList = currentList.filter((_, idx) => idx !== indexToRemove);
      return { ...prev, [itemId]: updatedList };
    });
  };

  // Handle evidence upload
  const handleEvidenceUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validación de seguridad
    const maxSize = 10 * 1024 * 1024; // 10MB
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

    if (file.size > maxSize) {
      toast.error("Archivo demasiado grande. El máximo permitido es 10MB.");
      if (evidenceInputRef.current) evidenceInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      return;
    }

    if (!allowedTypes.includes(file.type)) {
      toast.error("Tipo de archivo no válido. Use JPG, PNG o WebP.");
      if (evidenceInputRef.current) evidenceInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      return;
    }

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
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Error al subir imagen");
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
      const errorMsg = error instanceof Error ? error.message : 'Error desconocido';

      if (errorMsg.includes('size')) {
        toast.error("El archivo excede el límite permitido por el servidor.");
      } else if (errorMsg.includes('network') || errorMsg.includes('fetch')) {
        toast.error("Error de conexión. Verifique su internet e intente de nuevo.");
      } else {
        toast.error("Error al subir la evidencia. Intente nuevamente.");
      }
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
    inspectionCategories.forEach((category, cIdx) => {
      if (cIdx < 2 && category.items.length > 0) {
        dummyCheckedItems[category.items[0].id] = true;
      }
    });
    setCheckedItems(dummyCheckedItems);
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
                            "flex flex-col gap-3 p-3 rounded-lg border transition-colors",
                            checkedItems[item.id]
                              ? "bg-destructive/10 border-destructive/30"
                              : "hover:bg-muted/50"
                          )}
                        >
                          <div className="flex items-start gap-3">
                            <Checkbox
                              id={item.id}
                              checked={checkedItems[item.id] || false}
                              onCheckedChange={() => toggleItem(item.id)}
                              className="mt-0.5"
                            />
                            <label
                              htmlFor={item.id}
                              className="flex-1 cursor-pointer text-sm font-medium"
                            >
                              {item.label}
                              {item.critical && (
                                <Badge
                                  variant="outline"
                                  className="ml-2 text-xs px-1.5 py-0 border-red-200 text-red-600 bg-red-50"
                                >
                                  Crítico
                                </Badge>
                              )}
                            </label>
                          </div>
                          
                          {checkedItems[item.id] && (
                            <div className="ml-7 space-y-4 mt-1 border-t border-destructive/20 pt-3">
                              {item.id.endsWith("-other") && (
                                <div className="space-y-1.5 w-full max-w-sm">
                                  <label className="text-xs font-semibold text-muted-foreground">Descripción del problema *</label>
                                  <textarea
                                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[60px]"
                                    placeholder="Detalles sobre el daño o problema encontrado..."
                                    value={itemNotes[item.id] || ""}
                                    onChange={(e) => handleItemNoteChange(item.id, e.target.value)}
                                  />
                                </div>
                              )}
                              
                              <div className="space-y-2">
                                <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                                  <Camera className="h-3 w-3" /> Evidencia Fotográfica
                                </label>
                                
                                <div className="flex flex-wrap gap-2">
                                  {itemEvidence[item.id]?.map((ev, idx) => (
                                    <div key={idx} className="relative w-16 h-16 rounded-md border border-border overflow-hidden group bg-black/5 flex items-center justify-center">
                                      {ev.mimeType.startsWith('video/') ? (
                                        <div className="flex flex-col items-center justify-center text-[10px] text-muted-foreground">
                                          <Upload className="h-4 w-4 mb-1" />
                                          Video
                                        </div>
                                      ) : (
                                        <img src={ev.url} alt="Evidencia" className="object-cover w-full h-full" />
                                      )}
                                      <Button
                                        size="icon"
                                        variant="destructive"
                                        type="button"
                                        className="absolute top-0 right-0 h-5 w-5 rounded-none rounded-bl-md opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={() => deleteItemEvidence(item.id, idx)}
                                      >
                                        <XCircle className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  ))}
                                  
                                  <div className="flex gap-2">
                                    <label title="Tomar Foto" className={cn("cursor-pointer flex items-center justify-center w-16 h-16 rounded-md border border-dashed border-muted-foreground/50 hover:bg-muted/50 transition-colors text-muted-foreground/70 hover:text-foreground", isUploadingItemEvidence[item.id] && "opacity-50 cursor-not-allowed")}>
                                      <input 
                                        type="file" 
                                        accept="image/*" //,video/*" 
                                        capture="environment" 
                                        className="hidden" 
                                        onChange={(e) => handleItemEvidenceUpload(item.id, e)}
                                        disabled={isUploadingItemEvidence[item.id]}
                                      />
                                      <Camera className="h-6 w-6" />
                                    </label>
                                    
                                    <label title="Subir Archivo" className={cn("cursor-pointer flex items-center justify-center w-16 h-16 rounded-md border border-dashed border-muted-foreground/50 hover:bg-muted/50 transition-colors text-muted-foreground/70 hover:text-foreground", isUploadingItemEvidence[item.id] && "opacity-50 cursor-not-allowed")}>
                                      <input 
                                        type="file" 
                                        accept="image/*" //,video/*" 
                                        className="hidden" 
                                        onChange={(e) => handleItemEvidenceUpload(item.id, e)}
                                        disabled={isUploadingItemEvidence[item.id]}
                                      />
                                      <Upload className="h-6 w-6" />
                                    </label>
                                  </div>
                                </div>
                                {isUploadingItemEvidence[item.id] && (
                                  <p className="text-[10px] text-muted-foreground animate-pulse mt-1">
                                    Subiendo archivo...
                                  </p>
                                )}
                              </div>
                            </div>
                          )}
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

                  {/* Removed Evidence Upload Section per user request */}
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