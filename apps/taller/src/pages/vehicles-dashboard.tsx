import { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  Eye,
  Search,
  FileText,
  Camera,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Car,
  ClipboardCheck,
  DollarSign,
  User,
  Calendar,
  Gauge,
  Fuel,
  Palette,
  Sparkles,
  ShieldCheck,
  CircleDot,
  History,
  Hash,
  ExternalLink,
} from "lucide-react";
import { getVehicleStatistics, getVehicleById } from "../services/vehicles";
import { generateInspectionPdf } from "../lib/generate-inspection-pdf";
import { vehiclesApi, client } from "../utils/orpc";
import { toast } from "sonner";
import { INSPECTION_AREAS } from "../lib/inspection-data";
import ImagePreviewDialog from "@/components/ImagePreviewDialog";
import type { Vehicle, VehicleInspection, VehiclePhoto, InspectionChecklistItem, VehicleInspection360Item, ChecklistItemEvidence } from "../../../crm/apps/server/src/db/schema/vehicles";

// Type for what the getAll endpoint returns
type VehicleWithRelations = Vehicle & {
  inspections: (VehicleInspection & {
    checklistItems: (InspectionChecklistItem & {
      evidence?: ChecklistItemEvidence[];
    })[];
    inspection360Items?: VehicleInspection360Item[];
    aiValuation?: {
      suggestedValue?: number;
      reasoning?: string;
      marketAnalysis?: string;
      depreciationFactors?: string[];
      confidence?: string;
      commercialClassification?: string;
      commercialClassificationReasoning?: string;
    };
  })[];
  photos: VehiclePhoto[];
};

// Type for what the dashboard table expects
interface DashboardVehicle {
  id: string;
  technicianName: string;
  inspectionDate: Date | string | null;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: string | number;
  licensePlate: string;
  vinNumber: string;
  kmMileage: string | number;
  origin: string;
  vehicleType: string;
  color: string;
  fuelType: string;
  motorNumber?: string;
  milesMileage?: string | number;
  cylinders?: string;
  engineCC?: string;
  transmission?: string;
  vehicleRating: string;
  marketValue: string;
  suggestedCommercialValue: string;
  currentConditionValue: string;
  inspectionResult: string;
  airbagWarning: string;
  testDrive: string;
  status: string;
  photos: number;
  allPhotos?: VehiclePhoto[];
  hasScanner: boolean;
  alerts: string[];
  trim: string;
  traction: string;
  tiresCondition: number | null;
  tireConditionFrontLeft?: number;
  tireConditionFrontRight?: number;
  tireConditionRearLeft?: number;
  tireConditionRearRight?: number;
  hasSpareTire?: boolean;
  tireConditionSpare?: number;
  paintCondition: number | null;
  hasAgencyHistory: boolean | null;
  failedChecks: { area: string; checkpoint: string; status?: string; comment?: string | null; metadata?: any }[];
  all360Items?: VehicleInspection360Item[];
  checklistIssues?: { id?: string; item: string; severity: string; notes?: string | null; evidence?: ChecklistItemEvidence[] }[];
  allChecklistItems?: InspectionChecklistItem[];
  rejectionEvidenceUrl?: string | null;
  aiValuation?: {
    aiSuggestedValue?: number | null;
    aiMarketAnalysis?: string | null;
    aiDepreciationFactors?: string[] | null;
    aiConfidence?: string | number | null;
    aiCommercialClassification?: string | null;
    aiReasoning?: string | null;
    aiCommercialClassificationReasoning?: string | null;
  } | null;
}

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";

// Sample data based on the inspection schema
const sampleVehicles = [
  {
    id: "V001",
    technicianName: "Carlos Rodríguez",
    inspectionDate: new Date(2023, 10, 15),
    vehicleMake: "Toyota",
    vehicleModel: "Corolla",
    vehicleYear: "2020",
    licensePlate: "P-789ABC",
    vinNumber: "1HGCM82633A123456",
    trim: "LE",
    traction: "FWD",
    kmMileage: "45000",
    origin: "Agencia",
    vehicleType: "Sedan",
    color: "Blanco",
    fuelType: "Gasolina",
    vehicleRating: "Comercial",
    marketValue: "220000",
    suggestedCommercialValue: "205000",
    currentConditionValue: "195000",
    inspectionResult:
      "Vehículo en excelentes condiciones. Motor en buen estado, carrocería sin daños relevantes.",
    airbagWarning: "No",
    testDrive: "Sí",
    status: "approved",
    photos: 8,
    hasScanner: true,
    alerts: [],
    tiresCondition: 85,
    paintCondition: 90,
    hasAgencyHistory: true,
    failedChecks: [],
  },
  {
    id: "V002",
    technicianName: "Ana Martínez",
    inspectionDate: new Date(2023, 10, 18),
    vehicleMake: "Honda",
    vehicleModel: "CR-V",
    vehicleYear: "2018",
    licensePlate: "P-456DEF",
    vinNumber: "2HKRW7H8XJH123456",
    trim: "Touring",
    traction: "FWD",
    kmMileage: "72000",
    origin: "Rodado",
    vehicleType: "SUV",
    color: "Gris",
    fuelType: "Gasolina",
    vehicleRating: "Comercial",
    marketValue: "250000",
    suggestedCommercialValue: "230000",
    currentConditionValue: "215000",
    inspectionResult:
      "Vehículo en buenas condiciones. Presenta desgaste normal por uso. Requiere cambio de frenos próximamente.",
    airbagWarning: "No",
    testDrive: "Sí",
    status: "pending",
    photos: 6,
    hasScanner: true,
    alerts: ["Frenos"],
    tiresCondition: 60,
    paintCondition: 75,
    hasAgencyHistory: false,
    failedChecks: [{ area: "Frenos", checkpoint: "Pastillas de freno", comment: "Desgaste avanzado" }],
  },
  {
    id: "V003",
    technicianName: "Roberto Sánchez",
    inspectionDate: new Date(2023, 10, 20),
    vehicleMake: "Nissan",
    vehicleModel: "Sentra",
    vehicleYear: "2017",
    licensePlate: "P-123GHI",
    vinNumber: "3N1AB7AP7HY123456",
    trim: "Advance",
    traction: "FWD",
    kmMileage: "95000",
    origin: "Rodado",
    vehicleType: "Sedan",
    color: "Azul",
    fuelType: "Gasolina",
    vehicleRating: "No comercial",
    marketValue: "150000",
    suggestedCommercialValue: "135000",
    currentConditionValue: "120000",
    inspectionResult:
      "Vehículo con múltiples problemas. Transmisión con fallos, sistema eléctrico requiere revisión. Carrocería con óxido en varias áreas.",
    airbagWarning: "Sí",
    testDrive: "No",
    status: "rejected",
    photos: 10,
    hasScanner: true,
    alerts: ["Airbag", "Transmisión", "Sistema eléctrico", "Óxido"],
    tiresCondition: 30,
    paintCondition: 25,
    hasAgencyHistory: false,
    failedChecks: [
      { area: "Transmisión", checkpoint: "Caja de cambios", comment: "Fallos al cambiar" },
      { area: "Eléctrico", checkpoint: "Sistema eléctrico", comment: "Requiere revisión" },
    ],
  },
  {
    id: "V004",
    technicianName: "María López",
    inspectionDate: new Date(2023, 10, 22),
    vehicleMake: "Ford",
    vehicleModel: "Escape",
    vehicleYear: "2019",
    licensePlate: "P-789JKL",
    vinNumber: "1FMCU0F73KUA12345",
    trim: "Titanium",
    traction: "AWD",
    kmMileage: "55000",
    origin: "Agencia",
    vehicleType: "SUV",
    color: "Rojo",
    fuelType: "Gasolina",
    vehicleRating: "Comercial",
    marketValue: "270000",
    suggestedCommercialValue: "255000",
    currentConditionValue: "245000",
    inspectionResult:
      "Vehículo en muy buenas condiciones. Mantenimiento al día según bitácora.",
    airbagWarning: "No",
    testDrive: "Sí",
    status: "approved",
    photos: 9,
    hasScanner: true,
    alerts: [],
    tiresCondition: 80,
    paintCondition: 85,
    hasAgencyHistory: true,
    failedChecks: [],
  },
  {
    id: "V005",
    technicianName: "Javier Mendoza",
    inspectionDate: new Date(2023, 10, 25),
    vehicleMake: "Mazda",
    vehicleModel: "CX-5",
    vehicleYear: "2020",
    licensePlate: "P-456MNO",
    vinNumber: "JM3KFBDL9L0123456",
    trim: "Grand Touring",
    traction: "AWD",
    kmMileage: "32000",
    origin: "Agencia",
    vehicleType: "SUV",
    color: "Negro",
    fuelType: "Gasolina",
    vehicleRating: "Comercial",
    marketValue: "290000",
    suggestedCommercialValue: "280000",
    currentConditionValue: "275000",
    inspectionResult:
      "Vehículo en excelentes condiciones. Sin problemas detectados.",
    airbagWarning: "No",
    testDrive: "Sí",
    status: "approved",
    photos: 7,
    hasScanner: true,
    alerts: [],
    tiresCondition: 95,
    paintCondition: 92,
    hasAgencyHistory: true,
    failedChecks: [],
  },
];

const VehiclePhoto = ({ photo, index }: { photo: any; index: number }) => {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <svg className="h-10 w-10 mx-auto opacity-20" fill="currentColor" viewBox="0 0 24 24">
            <path d="M9 2C7.89 2 7 2.89 7 4V20C7 21.11 7.89 22 9 22H15C16.11 22 17 21.11 17 20V4C17 2.89 16.11 2 15 2H9Z" />
          </svg>
          <span className="text-xs font-medium">Error cargando</span>
        </div>
      </div>
    );
  }

  const comment = photo.valuatorComment?.trim();

  return (
    <div
      key={photo.id || index}
      className="relative aspect-square bg-muted rounded-md overflow-hidden border group"
    >
      <img
        src={photo.url}
        alt={photo.title || `Foto ${index + 1}`}
        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        onError={() => setHasError(true)}
      />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-2 pt-6 flex flex-col justify-end">
        <p className="text-[11px] font-semibold text-white truncate text-center">
          {photo.title || `${photo.category} - ${photo.photoType}`}
        </p>
        {comment && (
          <p className="text-[10px] text-slate-300 line-clamp-3 mt-1 text-center leading-snug break-words">
            {comment}
          </p>
        )}
        {photo.noCommentsChecked && !comment && (
          <p className="text-[10px] text-slate-400/80 italic mt-0.5 text-center px-1">
            Sin comentarios
          </p>
        )}
      </div>
    </div>
  );
};

export default function VehiclesDashboard() {
  const [vehicles, setVehicles] = useState<DashboardVehicle[]>([]);
  const [rawVehiclesData, setRawVehiclesData] = useState<VehicleWithRelations[]>([]);
  const [statistics, setStatistics] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [selectedVehicle, setSelectedVehicle] = useState<DashboardVehicle | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("details");
  const [photoGalleryFilter, setPhotoGalleryFilter] = useState("all");

  // Pagination state
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [totalVehicles, setTotalVehicles] = useState(0);
  const [isModalLoading, setIsModalLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [previewImages, setPreviewImages] = useState<string[]>([]);

  // Edit form state
  const [editForm, setEditForm] = useState({
    vehicleRating: "",
    status: "",
    marketValue: "",
    suggestedCommercialValue: "",
    currentConditionValue: "",
    testDrive: "",
    inspectionResult: "",
  });

  const transformVehicleData = useCallback((vehicle: VehicleWithRelations): DashboardVehicle => {
    // Get the latest inspection if available - sorted by date/createdAt descending
    const latestInspection = vehicle.inspections && vehicle.inspections.length > 0
      ? [...vehicle.inspections].sort((a, b) => {
          const dateA = a.inspectionDate ? new Date(a.inspectionDate).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
          const dateB = b.inspectionDate ? new Date(b.inspectionDate).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
          return dateB - dateA;
        })[0]
      : null;

    const aiVal = latestInspection ? (
      (latestInspection as any).aiSuggestedValue ?? 
      (latestInspection as any).ai_suggested_value ?? 
      latestInspection.aiValuation?.suggestedValue
    ) : null;

    return {
      id: vehicle.id,
      technicianName: latestInspection?.technicianName || 'N/A',
      inspectionDate: latestInspection?.inspectionDate || vehicle.createdAt,
      vehicleMake: vehicle.make || '',
      vehicleModel: vehicle.model || '',
      vehicleYear: vehicle.year?.toString() || '',
      licensePlate: vehicle.licensePlate || '',
      vinNumber: vehicle.vinNumber || '',
      kmMileage: vehicle.kmMileage?.toString() || '',
      origin: vehicle.origin || '',
      vehicleType: vehicle.vehicleType || '',
      color: vehicle.color || '',
      fuelType: vehicle.fuelType || '',
      motorNumber: vehicle.motorNumber || '',
      milesMileage: vehicle.milesMileage?.toString() || '',
      cylinders: vehicle.cylinders || '',
      engineCC: vehicle.engineCC || '',
      transmission: vehicle.transmission || '',
      vehicleRating: latestInspection?.vehicleRating || 'Pendiente',
      marketValue: latestInspection?.marketValue || '0',
      suggestedCommercialValue: latestInspection?.suggestedCommercialValue || '0',
      currentConditionValue: latestInspection?.currentConditionValue || '0',
      inspectionResult: latestInspection?.inspectionResult || 'Inspección pendiente',
      airbagWarning: latestInspection?.airbagWarning ? 'Sí' : 'No',
      testDrive: latestInspection?.testDrive ? 'Sí' : 'No',
      status: latestInspection?.status || vehicle.status || 'pending',
      photos: vehicle.photos?.length || 0,
      allPhotos: latestInspection && vehicle.photos ? vehicle.photos.filter((p: any) => p.inspectionId === latestInspection.id || !p.inspectionId) : vehicle.photos || [],
      hasScanner: latestInspection?.scannerUsed || false,
      alerts: (latestInspection?.alerts as string[]) || [],
      trim: vehicle.trim || '',
      traction: vehicle.traction || '',
      tiresCondition: latestInspection?.tiresCondition ?? null,
      tireConditionFrontLeft: latestInspection?.tireConditionFrontLeft ?? undefined,
      tireConditionFrontRight: latestInspection?.tireConditionFrontRight ?? undefined,
      tireConditionRearLeft: latestInspection?.tireConditionRearLeft ?? undefined,
      tireConditionRearRight: latestInspection?.tireConditionRearRight ?? undefined,
      hasSpareTire: latestInspection?.hasSpareTire ?? undefined,
      tireConditionSpare: latestInspection?.tireConditionSpare ?? undefined,
      paintCondition: latestInspection?.paintCondition ?? null,
      hasAgencyHistory: latestInspection?.hasAgencyHistory ?? null,
      aiValuation: latestInspection && aiVal != null
        ? {
            aiSuggestedValue: aiVal != null ? Number(aiVal) : null,
            aiMarketAnalysis: (latestInspection as any).aiMarketAnalysis ?? (latestInspection as any).ai_market_analysis ?? latestInspection.aiValuation?.marketAnalysis ?? null,
            aiDepreciationFactors: (latestInspection as any).aiDepreciationFactors ?? (latestInspection as any).ai_depreciation_factors ?? latestInspection.aiValuation?.depreciationFactors ?? null,
            aiConfidence: (latestInspection as any).aiConfidence ?? (latestInspection as any).ai_confidence ?? latestInspection.aiValuation?.confidence ?? null,
            aiCommercialClassification: (latestInspection as any).aiCommercialClassification ?? (latestInspection as any).ai_commercial_classification ?? latestInspection.aiValuation?.commercialClassification ?? null,
            aiReasoning: (latestInspection as any).aiReasoning ?? (latestInspection as any).ai_reasoning ?? latestInspection.aiValuation?.reasoning ?? null,
            aiCommercialClassificationReasoning: (latestInspection as any).aiCommercialClassificationReasoning ?? (latestInspection as any).ai_commercial_classification_reasoning ?? latestInspection.aiValuation?.commercialClassificationReasoning ?? null,
          }
        : null,
      failedChecks: latestInspection?.inspection360Items
        ? latestInspection.inspection360Items
          .filter(item => item.status !== 'OK' && item.status !== 'GOOD')
          .map(item => ({
            area: item.area,
            checkpoint: item.checkpoint,
            status: item.status,
            comment: item.comment,
            metadata: item.metadata,
          }))
        : [],
      checklistIssues: latestInspection?.checklistItems
        ? latestInspection.checklistItems
          .filter(item => item.checked)
          .map(item => ({
            id: item.id,
            item: item.item,
            severity: item.severity,
            notes: item.notes,
            evidence: item.evidence || [],
          }))
        : [],
      all360Items: latestInspection?.inspection360Items || [],
      allChecklistItems: latestInspection?.checklistItems || [],
      rejectionEvidenceUrl: latestInspection?.rejectionEvidenceUrl,
    };
  }, []);

  const loadVehicles = useCallback(async () => {
    setIsLoading(true);
    try {
      const offset = (page - 1) * pageSize;
      const result = await vehiclesApi.getAll({
        limit: pageSize,
        offset,
        query: searchTerm,
        status: filterStatus,
        category: category === 'all' ? undefined : category
      }) as unknown as { data: VehicleWithRelations[], total: number };

      if (result) {
        setRawVehiclesData(result.data || []);
        const transformedVehicles = (result.data || []).map(transformVehicleData);
        setVehicles(transformedVehicles);
        setTotalVehicles(result.total || 0);
      } else {
        setVehicles([]);
        setTotalVehicles(0);
      }
    } catch (error) {
      console.error("Error loading vehicles:", error);
      toast.error("Hubo un error al cargar los vehículos.");
      setVehicles([]);
      setTotalVehicles(0);
    } finally {
      setIsLoading(false);
    }
  }, [page, pageSize, searchTerm, filterStatus, category, transformVehicleData]);

  // Debounce search term
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1); // Reset to first page on search
      // We pass the latest state context via the useCallback loadVehicles effect or call it directly:
      // However since React sets state asynchronously, calling loadVehicles() here would use old page values unless we pass it.
      // Easiest is to let the 'page' effect handle it, but wait: if page is ALREADY 1, the page effect won't trigger!
      // So we must manually trigger loadVehicles if page === 1
      setPage((prevPage) => {
        if (prevPage === 1) {
          loadVehicles(); // trigger it manualy since effect won't
        }
        return 1;
      });
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, filterStatus, category]);

  // Load vehicles when page changes
  useEffect(() => {
    loadVehicles();
  }, [page, loadVehicles]);

  useEffect(() => {
    loadStatistics();
  }, []);

  const loadStatistics = async () => {
    try {
      const result = await getVehicleStatistics();
      if (result.success) {
        setStatistics(result.data);
      }
    } catch (error) {
      console.error("Error loading statistics:", error);
    }
  };

  const handleViewDetails = async (vehicle: DashboardVehicle) => {
    setSelectedVehicle(vehicle);
    setIsDetailsOpen(true);
    setIsModalLoading(true);
    setActiveTab("details");
    setPhotoGalleryFilter("all");

    // Initialize edit form with current values
    setEditForm({
      vehicleRating: vehicle.vehicleRating,
      status: vehicle.status,
      marketValue: vehicle.marketValue,
      suggestedCommercialValue: vehicle.suggestedCommercialValue,
      currentConditionValue: vehicle.currentConditionValue,
      testDrive: vehicle.testDrive,
      inspectionResult: vehicle.inspectionResult,
    });

    try {
      const result = await getVehicleById(vehicle.id);
      if (result.success && result.data) {
        setRawVehiclesData(prev => {
          const index = prev.findIndex(v => v.id === vehicle.id);
          if (index >= 0) {
            const newArr = [...prev];
            newArr[index] = result.data as any;
            return newArr;
          }
          return [...prev, result.data as any];
        });

        const transformed = transformVehicleData(result.data as any);
        setSelectedVehicle(transformed);

        // Update edit form with fresh data
        setEditForm({
          vehicleRating: transformed.vehicleRating,
          status: transformed.status,
          marketValue: transformed.marketValue,
          suggestedCommercialValue: transformed.suggestedCommercialValue,
          currentConditionValue: transformed.currentConditionValue,
          testDrive: transformed.testDrive,
          inspectionResult: transformed.inspectionResult,
        });
      }
    } catch (error) {
      console.error("Error loading vehicle details:", error);
    } finally {
      setIsModalLoading(false);
    }
  };

  const handleSaveChanges = async () => {
    if (!selectedVehicle) return;

    setIsSaving(true);
    try {
      await vehiclesApi.update(selectedVehicle.id, {
        status: editForm.status as "pending" | "available" | "sold" | "maintenance" | "auction",
      });

      // Get the raw vehicle to update its inspection
      const rawVehicle = rawVehiclesData.find(v => v.id === selectedVehicle.id);
      const inspectionId = rawVehicle?.inspections?.[0]?.id;

      if (inspectionId) {
        // Update the inspection data via the API
        await client.updateVehicleInspection({
          id: inspectionId,
          data: {
            vehicleRating: editForm.vehicleRating,
            marketValue: editForm.marketValue,
            suggestedCommercialValue: editForm.suggestedCommercialValue,
            currentConditionValue: editForm.currentConditionValue,
            testDrive: editForm.testDrive === "Sí",
            inspectionResult: editForm.inspectionResult,
            status: editForm.status as "pending" | "auction" | "approved" | "rejected",
          },
        });
      }

      // Update local state
      setSelectedVehicle(prev => prev ? {
        ...prev,
        ...editForm,
      } : null);

      // Refresh the vehicles list
      await loadVehicles();

      toast.success("Cambios guardados correctamente");
      setActiveTab("details");
    } catch (error) {
      console.error("Error saving changes:", error);
      toast.error("Error al guardar los cambios");
    } finally {
      setIsSaving(false);
    }
  };

  // No longer needed as we do server-side filtering
  const filteredVehicles = vehicles;

  // Function to render the status badge
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case "approved":
        return (
          <Badge className="bg-green-500">
            <CheckCircle className="w-3.5 h-3.5 mr-1" />
            Aprobado
          </Badge>
        );
      case "pending":
        return (
          <Badge className="bg-yellow-500">
            <AlertTriangle className="w-3.5 h-3.5 mr-1" />
            Pendiente
          </Badge>
        );
      case "rejected":
        return (
          <Badge className="bg-red-500">
            <XCircle className="w-3.5 h-3.5 mr-1" />
            Rechazado
          </Badge>
        );
      default:
        return null;
    }
  };

  // Statistics calculation
  const stats = {
    total: statistics?.totalVehicles || 0,
    approved: statistics?.approvedInspections || 0, // Using inspections count as proxy or need vehicle status count
    pending: statistics?.pendingVehicles || 0,
    rejected: statistics?.rejectedInspections || 0,
    commercial: statistics?.commercialVehicles || 0,
    nonCommercial: statistics?.nonCommercialVehicles || 0,
    withAlerts: statistics?.vehiclesWithAlerts || 0,
  };

  const getAreaLabel = (rawArea: string) => {
    // Try to find by exact title match first (case insensitive)
    const found = INSPECTION_AREAS.find(a =>
      a.title.toLowerCase() === rawArea.toLowerCase() ||
      a.id === rawArea
    );
    return found ? found.title : rawArea; // Fallback to raw if not found
  };


  return (
    <div className="flex flex-col p-6 gap-4">
      <div className="flex justify-between items-center w-full">
        <h1 className="text-4xl font-bold">Panel de Vehículos</h1>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total de Inspecciones
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Aprobados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">
              {stats.approved}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pendientes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-500">
              {stats.pending}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Rechazados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-500">
              {stats.rejected}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="all" className="w-full" onValueChange={(val) => {
        setCategory(val);
        setPage(1);
      }}>
        <TabsList className="mb-4">
          <TabsTrigger value="all">Todos</TabsTrigger>
          <TabsTrigger value="alerts">
            Con Alertas ({stats.withAlerts})
          </TabsTrigger>
          <TabsTrigger value="commercial">
            Comerciales ({stats.commercial})
          </TabsTrigger>
          <TabsTrigger value="non-commercial">
            No Comerciales ({stats.nonCommercial})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Listado de Vehículos</CardTitle>
              <CardDescription>
                Información sobre los vehículos inspeccionados
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col md:flex-row justify-between gap-4 mb-4">
                <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
                  <div className="relative w-full sm:w-auto">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="search"
                      placeholder="Buscar vehículo..."
                      className="pl-8 w-full md:w-[300px]"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                  <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger className="w-full sm:w-[180px]">
                      <SelectValue placeholder="Filtrar por estado" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="approved">Aprobados</SelectItem>
                      <SelectItem value="pending">Pendientes</SelectItem>
                      <SelectItem value="rejected">Rechazados</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button className="w-full md:w-auto" asChild>
                  <a href="/vehicle-inspection" target="_blank" rel="noopener noreferrer">
                    Nueva Inspección
                  </a>
                </Button>
              </div>

              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vehículo</TableHead>
                      <TableHead>Placa</TableHead>
                      <TableHead>Técnico</TableHead>
                      <TableHead>Valor Comercial</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Alertas</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={8} className="h-24 text-center">
                          <div className="flex justify-center items-center gap-2">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            <span className="text-muted-foreground">Cargando vehículos...</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : filteredVehicles.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="h-24 text-center">
                          No se encontraron resultados.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredVehicles.map((vehicle) => (
                        <TableRow key={vehicle.id}>
                          <TableCell>
                            <div className="font-medium">
                              {vehicle.vehicleMake} {vehicle.vehicleModel}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {vehicle.vehicleYear} - {vehicle.color}
                            </div>
                          </TableCell>
                          <TableCell>{vehicle.licensePlate}</TableCell>
                          <TableCell>
                            <div className="text-sm">
                              {vehicle.technicianName}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">
                              {Number(
                                vehicle.suggestedCommercialValue
                              ).toLocaleString("es-GT", {
                                style: "currency",
                                currency: "GTQ",
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 0,
                              })}
                            </div>
                            <div
                              className={cn(
                                "text-sm",
                                vehicle.vehicleRating === "Comercial"
                                  ? "text-green-500"
                                  : "text-red-500"
                              )}
                            >
                              {vehicle.vehicleRating}
                            </div>
                          </TableCell>
                          <TableCell>
                            {vehicle.inspectionDate ?
                              format(
                                typeof vehicle.inspectionDate === 'string'
                                  ? new Date(vehicle.inspectionDate)
                                  : vehicle.inspectionDate,
                                "dd MMM yyyy",
                                { locale: es }
                              ) : 'N/A'
                            }
                          </TableCell>
                          <TableCell>
                            {renderStatusBadge(vehicle.status)}
                          </TableCell>
                          <TableCell>
                            {(vehicle.alerts && vehicle.alerts.length > 0) ? (
                              <Badge
                                variant="outline"
                                className="bg-red-100 text-red-800 border-red-300"
                              >
                                {vehicle.alerts.length}{" "}
                                {vehicle.alerts.length === 1
                                  ? "alerta"
                                  : "alertas"}
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="bg-green-100 text-green-800 border-green-300"
                              >
                                Sin alertas
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              onClick={() => handleViewDetails(vehicle)}
                            >
                              <span className="sr-only">Ver detalles</span>
                              <Eye className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination Controls */}
              <div className="flex items-center justify-between space-x-2 py-4">
                <div className="text-sm text-muted-foreground">
                  Mostrando {((page - 1) * pageSize) + 1} a {Math.min(page * pageSize, totalVehicles)} de {totalVehicles} vehículos
                </div>
                <div className="space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1 || isLoading}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => p + 1)}
                    disabled={page * pageSize >= totalVehicles || isLoading}
                  >
                    Siguiente
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alerts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Vehículos con Alertas</CardTitle>
              <CardDescription>
                Listado de vehículos que requieren atención
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vehículo</TableHead>
                      <TableHead>Técnico</TableHead>
                      <TableHead>Alertas</TableHead>
                      <TableHead>Detalles</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="h-24 text-center">
                          <div className="flex justify-center items-center gap-2">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            <span className="text-muted-foreground">Cargando vehículos...</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : vehicles.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="h-24 text-center">
                          No se encontraron resultados.
                        </TableCell>
                      </TableRow>
                    ) : (
                      vehicles.map((vehicle) => (
                        <TableRow key={vehicle.id}>
                          <TableCell>
                            <div className="font-medium">
                              {vehicle.vehicleMake} {vehicle.vehicleModel} (
                              {vehicle.vehicleYear})
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {vehicle.licensePlate}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              {vehicle.technicianName}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {(vehicle.alerts || []).map((alert, index) => (
                                <Badge
                                  key={index}
                                  variant="outline"
                                  className="bg-red-100 text-red-800 border-red-300"
                                >
                                  {alert}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[300px]">
                            <div className="text-sm line-clamp-2">
                              {vehicle.inspectionResult}
                            </div>
                          </TableCell>
                          <TableCell>
                            {renderStatusBadge(vehicle.status)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleViewDetails(vehicle)}
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              Ver detalles
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              {/* Pagination Controls for Alerts */}
              <div className="flex items-center justify-between space-x-2 py-4">
                <div className="text-sm text-muted-foreground">
                  Mostrando {((page - 1) * pageSize) + 1} a {Math.min(page * pageSize, totalVehicles)} de {totalVehicles} vehículos
                </div>
                <div className="space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1 || isLoading}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => p + 1)}
                    disabled={page * pageSize >= totalVehicles || isLoading}
                  >
                    Siguiente
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="commercial" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Vehículos Comerciales</CardTitle>
              <CardDescription>
                Listado de vehículos calificados como comerciales
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vehículo</TableHead>
                      <TableHead>Técnico</TableHead>
                      <TableHead>Valor Mercado</TableHead>
                      <TableHead>Valor Sugerido</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="h-24 text-center">
                          <div className="flex justify-center items-center gap-2">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            <span className="text-muted-foreground">Cargando vehículos...</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : vehicles.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="h-24 text-center">
                          No se encontraron resultados.
                        </TableCell>
                      </TableRow>
                    ) : (
                      vehicles.map((vehicle) => (
                        <TableRow key={vehicle.id}>
                          <TableCell>
                            <div className="font-medium">
                              {vehicle.vehicleMake} {vehicle.vehicleModel} (
                              {vehicle.vehicleYear})
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {vehicle.licensePlate}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              {vehicle.technicianName}
                            </div>
                          </TableCell>
                          <TableCell>
                            {Number(vehicle.marketValue).toLocaleString(
                              "es-GT",
                              {
                                style: "currency",
                                currency: "GTQ",
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 0,
                              }
                            )}
                          </TableCell>
                          <TableCell>
                            {Number(
                              vehicle.suggestedCommercialValue
                            ).toLocaleString("es-GT", {
                              style: "currency",
                              currency: "GTQ",
                              minimumFractionDigits: 0,
                              maximumFractionDigits: 0,
                            })}
                          </TableCell>
                          <TableCell>
                            {renderStatusBadge(vehicle.status)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleViewDetails(vehicle)}
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              Ver detalles
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              {/* Pagination Controls for Commercial */}
              <div className="flex items-center justify-between space-x-2 py-4">
                <div className="text-sm text-muted-foreground">
                  Mostrando {((page - 1) * pageSize) + 1} a {Math.min(page * pageSize, totalVehicles)} de {totalVehicles} vehículos
                </div>
                <div className="space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1 || isLoading}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => p + 1)}
                    disabled={page * pageSize >= totalVehicles || isLoading}
                  >
                    Siguiente
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="non-commercial" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Vehículos No Comerciales</CardTitle>
              <CardDescription>
                Listado de vehículos calificados como no comerciales
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vehículo</TableHead>
                      <TableHead>Técnico</TableHead>
                      <TableHead>Razones</TableHead>
                      <TableHead>Detalles</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={5} className="h-24 text-center">
                          <div className="flex justify-center items-center gap-2">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            <span className="text-muted-foreground">Cargando vehículos...</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : vehicles.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="h-24 text-center">
                          No se encontraron resultados.
                        </TableCell>
                      </TableRow>
                    ) : (
                      vehicles.map((vehicle) => (
                        <TableRow key={vehicle.id}>
                          <TableCell>
                            <div className="font-medium">
                              {vehicle.vehicleMake} {vehicle.vehicleModel} (
                              {vehicle.vehicleYear})
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {vehicle.licensePlate}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              {vehicle.technicianName}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {(vehicle.alerts || []).map((alert, index) => (
                                <Badge
                                  key={index}
                                  variant="outline"
                                  className="bg-red-100 text-red-800 border-red-300"
                                >
                                  {alert}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[300px]">
                            <div className="text-sm line-clamp-2">
                              {vehicle.inspectionResult}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleViewDetails(vehicle)}
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              Ver detalles
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              {/* Pagination Controls for Non-Commercial */}
              <div className="flex items-center justify-between space-x-2 py-4">
                <div className="text-sm text-muted-foreground">
                  Mostrando {((page - 1) * pageSize) + 1} a {Math.min(page * pageSize, totalVehicles)} de {totalVehicles} vehículos
                </div>
                <div className="space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1 || isLoading}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => p + 1)}
                    disabled={page * pageSize >= totalVehicles || isLoading}
                  >
                    Siguiente
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Unified Vehicle Details Dialog */}
      <Dialog
        open={isDetailsOpen}
        onOpenChange={(open) => {
          setIsDetailsOpen(open);
          if (!open) {
            setActiveTab("details"); // Reset to default tab when closing
          }
        }}
      >
        <DialogContent className="min-w-[90vw] max-w-7xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="flex flex-row items-start justify-between pr-8">
            <div>
              <DialogTitle>
                {selectedVehicle?.vehicleMake} {selectedVehicle?.vehicleModel}
              </DialogTitle>
              <DialogDescription>
                {selectedVehicle?.licensePlate} - {selectedVehicle?.vinNumber}
              </DialogDescription>
            </div>
            {selectedVehicle && (
              <Button
                variant="outline"
                size="sm"
                className="mt-0!"
                disabled={isModalLoading}
                onClick={async () => {
                  try {
                    await generateInspectionPdf(selectedVehicle);
                  } catch (e) {
                    console.error("Error al generar el informe de inspección en PDF:", e);
                    toast.error("No se pudo generar el informe PDF. Inténtalo de nuevo más tarde.");
                  }
                }}
              >
                <FileText className="h-4 w-4 mr-2" />
                Descargar Informe PDF
              </Button>
            )}
          </DialogHeader>

          {isModalLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
              <p className="text-muted-foreground">Cargando detalles del vehículo...</p>
            </div>
          ) : (

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full pt-4">
              <TabsList className="w-full">
                <TabsTrigger value="details" className="flex-1">Detalles</TabsTrigger>
                <TabsTrigger value="photos" className="flex-1">Fotos ({selectedVehicle?.photos || 0})</TabsTrigger>
                {selectedVehicle?.hasScanner && (
                  <TabsTrigger value="scanner" className="flex-1">Scanner</TabsTrigger>
                )}
                <TabsTrigger value="edit" className="flex-1">Editar</TabsTrigger>
              </TabsList>

              <TabsContent value="details" className="mt-4">
                {selectedVehicle && (
                  <div className="space-y-6 py-4">
                    {/* Header con estado y calificación */}
                    <div className="flex flex-wrap items-center gap-3 pb-4 border-b">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Estado:</span>
                        {renderStatusBadge(selectedVehicle.status)}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Calificación:</span>
                        <Badge
                          variant="outline"
                          className={cn(
                            selectedVehicle.vehicleRating === "Comercial"
                              ? "bg-green-100 text-green-800 border-green-300"
                              : "bg-red-100 text-red-800 border-red-300"
                          )}
                        >
                          {selectedVehicle.vehicleRating}
                        </Badge>
                      </div>
                      {selectedVehicle.alerts && selectedVehicle.alerts.length > 0 && (
                        <Badge variant="outline" className="bg-red-100 text-red-800 border-red-300">
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          {selectedVehicle.alerts.length} {selectedVehicle.alerts.length === 1 ? "alerta" : "alertas"}
                        </Badge>
                      )}

                      {/* Botón de Evidencia (Si existe) */}

                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      {/* Información del Vehículo */}
                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base flex items-center gap-2">
                            <Car className="h-4 w-4" />
                            Información del Vehículo
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                            <div className="text-muted-foreground">Marca</div>
                            <div className="font-medium">{selectedVehicle.vehicleMake}</div>

                            <div className="text-muted-foreground">Línea del vehículo</div>
                            <div className="font-medium">{selectedVehicle.vehicleModel}</div>

                            <div className="text-muted-foreground">Versión/Equipamiento</div>
                            <div className="font-medium">{selectedVehicle.trim || "N/A"}</div>

                            <div className="text-muted-foreground">Año</div>
                            <div className="font-medium">{selectedVehicle.vehicleYear}</div>

                            <div className="text-muted-foreground">Procedencia</div>
                            <div className="font-medium">{selectedVehicle.origin || "N/A"}</div>

                            <div className="text-muted-foreground">Tipo de vehículo</div>
                            <div className="font-medium">{selectedVehicle.vehicleType}</div>
                            
                            <div className="text-muted-foreground">Transmisión</div>
                            <div className="font-medium">{selectedVehicle.transmission || "N/A"}</div>

                            <div className="text-muted-foreground">Tracción</div>
                            <div className="font-medium">{selectedVehicle.traction || "N/A"}</div>
                            
                            <div className="text-muted-foreground">Cilindros</div>
                            <div className="font-medium">{selectedVehicle.cylinders || "N/A"}</div>
                            
                            <div className="text-muted-foreground">Motor (CC)</div>
                            <div className="font-medium">{selectedVehicle.engineCC || "N/A"}</div>
                          </div>

                          <div className="pt-2 border-t space-y-2">
                            <div className="flex items-center gap-2 text-sm">
                              <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-muted-foreground">No. de placa:</span>
                              <span className="font-mono font-medium">{selectedVehicle.licensePlate}</span>
                            </div>
                            <div className="flex items-start gap-2 text-sm">
                              <Hash className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                              <span className="text-muted-foreground">No. VIN/Chasis:</span>
                              <span className="font-mono text-xs break-all">{selectedVehicle.vinNumber}</span>
                            </div>
                            <div className="flex items-start gap-2 text-sm">
                              <Hash className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                              <span className="text-muted-foreground">No. de Motor:</span>
                              <span className="font-mono text-xs break-all">{selectedVehicle.motorNumber || "N/A"}</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                              <Palette className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-muted-foreground">Color:</span>
                              <span className="font-medium">{selectedVehicle.color}</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                              <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-muted-foreground">Millas recorridas:</span>
                              <span className="font-medium">{selectedVehicle.milesMileage ? `${Number(selectedVehicle.milesMileage).toLocaleString()} mi` : "N/A"}</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                              <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-muted-foreground">Kilómetros recorridos:</span>
                              <span className="font-medium">{Number(selectedVehicle.kmMileage).toLocaleString()} km</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                              <Fuel className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-muted-foreground">Combustible:</span>
                              <span className="font-medium">{selectedVehicle.fuelType}</span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      {/* Datos de Inspección */}
                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base flex justify-between items-center w-full">
                            <div className="flex items-center gap-2">
                              <ClipboardCheck className="h-4 w-4" />
                              Datos de Inspección
                            </div>
                            {selectedVehicle.rejectionEvidenceUrl && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs px-2 text-red-600 border-red-300 hover:bg-red-50 hover:text-red-700"
                                onClick={() => setPreviewImages(selectedVehicle.rejectionEvidenceUrl ? [selectedVehicle.rejectionEvidenceUrl] : [])}
                              >
                                <ExternalLink className="h-3 w-3 mr-1.5" />
                                Ver evidencia
                              </Button>
                            )}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="flex items-center gap-2 text-sm">
                            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-muted-foreground">Fecha:</span>
                            <span className="font-medium">
                              {selectedVehicle.inspectionDate ?
                                format(
                                  typeof selectedVehicle.inspectionDate === 'string'
                                    ? new Date(selectedVehicle.inspectionDate)
                                    : selectedVehicle.inspectionDate,
                                  "dd 'de' MMMM, yyyy",
                                  { locale: es }
                                ) : 'N/A'
                              }
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-muted-foreground">Técnico:</span>
                            <span className="font-medium">{selectedVehicle.technicianName}</span>
                          </div>

                          <div className="pt-2 border-t grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                            <div className="text-muted-foreground">Prueba de manejo</div>
                            <div className="font-medium">{selectedVehicle.testDrive}</div>

                            <div className="text-muted-foreground">Testigo airbag</div>
                            <div className={cn(
                              "font-medium",
                              selectedVehicle.airbagWarning === "Sí" && "text-red-600"
                            )}>{selectedVehicle.airbagWarning}</div>

                            <div className="text-muted-foreground">Scanner</div>
                            <div className="font-medium">{selectedVehicle.hasScanner ? "Sí" : "No"}</div>

                            <div className="text-muted-foreground">Fotos</div>
                            <div className="font-medium">{selectedVehicle.photos}</div>


                          </div>

                          <div className="pt-3 border-t space-y-6">
                            {/* Estado de Neumáticos */}
                            <div className="space-y-3">
                              <div className="flex items-center gap-2 border-b border-blue-100 pb-1">
                                <CircleDot className="h-4 w-4 text-blue-500" />
                                <h4 className="text-[10px] font-bold uppercase tracking-wider text-blue-600/80">Estado de Neumáticos</h4>
                              </div>
                              <div className="grid grid-cols-2 gap-x-6 gap-y-3 pt-1">
                                <div className="space-y-1">
                                  <div className="flex justify-between text-[10px] font-medium px-0.5 text-muted-foreground uppercase">
                                    <span>Frontal Izquierda</span>
                                    <span className="font-bold text-foreground">{selectedVehicle.tireConditionFrontLeft || 0}%</span>
                                  </div>
                                  <Progress value={selectedVehicle.tireConditionFrontLeft || 0} className="h-1.5 bg-slate-100 [&>div]:bg-slate-900" />
                                </div>
                                <div className="space-y-1">
                                  <div className="flex justify-between text-[10px] font-medium px-0.5 text-muted-foreground uppercase">
                                    <span>Frontal Derecha</span>
                                    <span className="font-bold text-foreground">{selectedVehicle.tireConditionFrontRight || 0}%</span>
                                  </div>
                                  <Progress value={selectedVehicle.tireConditionFrontRight || 0} className="h-1.5 bg-slate-100 [&>div]:bg-slate-900" />
                                </div>
                                <div className="space-y-1">
                                  <div className="flex justify-between text-[10px] font-medium px-0.5 text-muted-foreground uppercase">
                                    <span>Trasera Izquierda</span>
                                    <span className="font-bold text-foreground">{selectedVehicle.tireConditionRearLeft || 0}%</span>
                                  </div>
                                  <Progress value={selectedVehicle.tireConditionRearLeft || 0} className="h-1.5 bg-slate-100 [&>div]:bg-slate-900" />
                                </div>
                                <div className="space-y-1">
                                  <div className="flex justify-between text-[10px] font-medium px-0.5 text-muted-foreground uppercase">
                                    <span>Trasera Derecha</span>
                                    <span className="font-bold text-foreground">{selectedVehicle.tireConditionRearRight || 0}%</span>
                                  </div>
                                  <Progress value={selectedVehicle.tireConditionRearRight || 0} className="h-1.5 bg-slate-100 [&>div]:bg-slate-900" />
                                </div>
                                {selectedVehicle.hasSpareTire && (
                                  <div className="space-y-1">
                                    <div className="flex justify-between text-[10px] font-medium px-0.5 text-muted-foreground uppercase">
                                      <span>Neumático de Repuesto</span>
                                      <span className="font-bold text-foreground">{selectedVehicle.tireConditionSpare || 0}%</span>
                                    </div>
                                    <Progress value={selectedVehicle.tireConditionSpare || 0} className="h-1.5 bg-slate-100 [&>div]:bg-slate-900" />
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Condiciones Generales */}
                            <div className="space-y-3">
                              <div className="flex items-center gap-2 border-b border-blue-100 pb-1">
                                <History className="h-4 w-4 text-blue-500" />
                                <h4 className="text-[10px] font-bold uppercase tracking-wider text-blue-600/80">Condiciones Generales</h4>
                              </div>
                              <div className="grid grid-cols-2 gap-6 pt-1">
                                <div className="space-y-1.5">
                                  <div className="flex justify-between items-end">
                                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight">Pintura</span>
                                    <span className="text-xs font-bold">{selectedVehicle.paintCondition || 0}%</span>
                                  </div>
                                  <Progress
                                    value={selectedVehicle.paintCondition || 0}
                                    className="h-1.5 bg-slate-100 [&>div]:bg-slate-900"
                                  />
                                </div>
                                <div className="flex flex-col gap-1.5">
                                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight">Historial Agencia</span>
                                  <div className="flex items-center gap-2">
                                    <Badge
                                      variant={selectedVehicle.hasAgencyHistory === true ? "default" : selectedVehicle.hasAgencyHistory === false ? "secondary" : "outline"}
                                      className={cn(
                                        "text-[10px] px-2 py-0 font-bold",
                                        selectedVehicle.hasAgencyHistory === true ? "bg-green-600 hover:bg-green-700" :
                                          selectedVehicle.hasAgencyHistory === false ? "text-muted-foreground bg-muted" :
                                            "text-yellow-600 border-yellow-200 bg-yellow-50"
                                      )}
                                    >
                                      {selectedVehicle.hasAgencyHistory === true ? "CON HISTORIAL" : selectedVehicle.hasAgencyHistory === false ? "SIN HISTORIAL" : "N/A"}
                                    </Badge>
                                    {selectedVehicle.hasAgencyHistory === true && <ShieldCheck className="h-4 w-4 text-green-600" />}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      {/* Valoración */}
                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base flex items-center gap-2">
                            <DollarSign className="h-4 w-4" />
                            Valoración
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="space-y-3">
                            <div className="flex justify-between items-center">
                              <span className="text-sm text-muted-foreground">Valor de mercado</span>
                              <span className="text-lg font-semibold">
                                {selectedVehicle.marketValue && !isNaN(Number(selectedVehicle.marketValue))
                                  ? Number(selectedVehicle.marketValue).toLocaleString("es-GT", {
                                      style: "currency",
                                      currency: "GTQ",
                                      minimumFractionDigits: 0,
                                      maximumFractionDigits: 0,
                                    })
                                  : "N/A"}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-sm text-muted-foreground">Valor comercial sugerido</span>
                              <span className="text-lg font-semibold text-primary">
                                {selectedVehicle.suggestedCommercialValue && !isNaN(Number(selectedVehicle.suggestedCommercialValue))
                                  ? Number(selectedVehicle.suggestedCommercialValue).toLocaleString("es-GT", {
                                      style: "currency",
                                      currency: "GTQ",
                                      minimumFractionDigits: 0,
                                      maximumFractionDigits: 0,
                                    })
                                  : "N/A"}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-sm text-muted-foreground">Valor actual condición</span>
                              <span className="text-lg font-semibold">
                                {selectedVehicle.currentConditionValue && !isNaN(Number(selectedVehicle.currentConditionValue))
                                  ? Number(selectedVehicle.currentConditionValue).toLocaleString("es-GT", {
                                      style: "currency",
                                      currency: "GTQ",
                                      minimumFractionDigits: 0,
                                      maximumFractionDigits: 0,
                                    })
                                  : "N/A"}
                              </span>
                            </div>
                          </div>


                        </CardContent>
                      </Card>
                    </div>

                    {/* Hallazgos Críticos (Check 360) */}
                    {selectedVehicle.failedChecks && selectedVehicle.failedChecks.length > 0 && (
                      <Card className="border-orange-200 bg-orange-50/30">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base flex items-center gap-2 text-orange-800">
                            <AlertTriangle className="h-4 w-4" />
                            Hallazgos del Check 360
                            <Badge variant="outline" className="ml-2 h-5 text-[10px] px-1.5 bg-background text-orange-800 border-orange-300">
                              {selectedVehicle.failedChecks.length}
                            </Badge>
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="max-h-[300px] overflow-y-auto pr-2 space-y-2">
                            {selectedVehicle.failedChecks.map((check, idx) => {
                              const isBad = check.status === 'bad' || check.status === 'legacy_bad' || check.status === 'BAD' || check.status === 'LEGACY_BAD';
                              const isRegular = check.status === 'regular' || check.status === 'REGULAR';
                              const isNA = check.status === 'na' || check.status === 'NA';
                              
                              return (
                                <div
                                  key={idx}
                                  className={cn("flex gap-3 p-3 rounded-md border shadow-sm bg-white", 
                                    isBad ? "border-red-200" : isRegular ? "border-orange-200" : "border-slate-200"
                                  )}
                                >
                                  <div className="mt-0.5 shrink-0">
                                    {isBad && <XCircle className="h-4 w-4 text-red-500" />}
                                    {isRegular && <AlertTriangle className="h-4 w-4 text-orange-500" />}
                                    {isNA && <span className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-100 text-[9px] font-bold text-slate-500">NA</span>}
                                  </div>
                                  <div className="flex-1 space-y-1 min-w-0">
                                    <div className="font-medium text-sm text-foreground flex items-center flex-wrap gap-1">
                                      <span className="text-muted-foreground mr-1">{getAreaLabel(check.area)}:</span>
                                      <span>{check.checkpoint}</span>
                                      
                                      {isBad && <Badge variant="outline" className="ml-1 text-[9px] px-1 py-0 h-4 border-red-200 text-red-600 bg-red-50">Malo</Badge>}
                                      {isRegular && <Badge variant="outline" className="ml-1 text-[9px] px-1 py-0 h-4 border-orange-200 text-orange-600 bg-orange-50">Regular</Badge>}
                                    </div>
                                    {check.comment && (
                                      <p className="text-sm text-muted-foreground break-all">
                                        {check.comment}
                                      </p>
                                    )}
                                    {check.metadata && check.checkpoint.toLowerCase().includes("compresiones") && (() => {
                                      try {
                                        const mData = typeof check.metadata === 'string' ? JSON.parse(check.metadata) : check.metadata;
                                        let cylCount = 8;
                                        if (selectedVehicle.cylinders) {
                                           const parsed = parseInt(selectedVehicle.cylinders.toString().replace(/\D/g, ''), 10);
                                           if (!isNaN(parsed) && parsed > 0 && parsed <= 16) cylCount = parsed;
                                        }

                                        const validPts = [];
                                        for (let i = 1; i <= cylCount; i++) {
                                          const val = mData[`c${i}`];
                                          if (val !== undefined && val !== null && val !== 0 && val !== "0" && val !== "") {
                                             validPts.push({ c: i, val });
                                          }
                                        }

                                        if (validPts.length === 0) return null;

                                        return (
                                          <div className="mt-2 text-xs">
                                            <div className="font-semibold text-slate-700 mb-1">Presiones Registradas:</div>
                                            <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 border-t border-slate-100 pt-2">
                                              {validPts.map((pt) => (
                                                <div key={pt.c} className="text-center bg-slate-50 rounded flex flex-col items-center border border-slate-200 shadow-sm py-1.5 transition-colors hover:border-blue-200 hover:bg-blue-50/50">
                                                  <p className="text-[10px] text-blue-600 font-semibold mb-0.5">C{pt.c}</p>
                                                  <p className="font-mono text-xs font-bold text-slate-700">{String(pt.val)} <span className="text-[9px] font-normal text-slate-500">PSI</span></p>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        );
                                      } catch(e) { return null; }
                                    })()}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* Puntos Críticos (Checklist) */}
                    {selectedVehicle.checklistIssues && selectedVehicle.checklistIssues.length > 0 && (
                      <Card className="border-amber-200 bg-amber-50/20">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base flex items-center gap-2 text-amber-800">
                            <ClipboardCheck className="h-4 w-4" />
                            Puntos de Revisión Adicionales
                            <Badge variant="outline" className="ml-2 h-5 text-[10px] px-1.5 bg-background text-amber-800 border-amber-300">
                              {selectedVehicle.checklistIssues.length}
                            </Badge>
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="max-h-[300px] overflow-y-auto pr-2 space-y-2">
                            {selectedVehicle.checklistIssues.map((issue, idx) => {
                              const isCritical = issue.severity === 'critical';
                              
                              return (
                                <div
                                  key={idx}
                                  className={cn("flex flex-col sm:flex-row gap-3 p-3 rounded-md border shadow-sm bg-white", 
                                    isCritical ? "border-red-200" : "border-amber-200"
                                  )}
                                >
                                  <div className="mt-0.5 shrink-0">
                                    <AlertTriangle className={cn("h-4 w-4", isCritical ? "text-red-500" : "text-amber-500")} />
                                  </div>
                                  <div className="flex-1 space-y-1 min-w-0">
                                    <div className="font-medium text-sm text-foreground flex items-start sm:items-center justify-between flex-wrap gap-2">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <span>{issue.item}</span>
                                        <Badge variant="outline" className={cn("text-[9px] px-1 py-0 h-4", 
                                          isCritical ? "border-red-200 text-red-600 bg-red-50" : "border-amber-200 text-amber-600 bg-amber-50"
                                        )}>
                                          {isCritical ? "Crítico" : "Advertencia"}
                                        </Badge>
                                      </div>
                                      
                                      {issue.evidence && issue.evidence.length > 0 && (
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="h-6 text-xs px-2 shrink-0 border-slate-200 text-slate-600 hover:bg-slate-50"
                                          onClick={() => setPreviewImages(issue.evidence?.map((e: any) => e.url) || [])}
                                        >
                                          <Camera className="h-3 w-3 mr-1" />
                                          Ver evidencia ({issue.evidence.length})
                                        </Button>
                                      )}
                                    </div>
                                    {issue.notes && (
                                      <p className="text-sm text-muted-foreground break-all bg-slate-50 p-2 rounded border border-slate-100 mt-2">
                                        {issue.notes}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* Resultado de Inspección */}
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                          <FileText className="h-4 w-4" />
                          Resultado de la Inspección
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm leading-relaxed">
                          {selectedVehicle.inspectionResult}
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="photos" className="mt-4">
                <div className="py-2">
                  <div className="flex flex-wrap gap-2 mb-6 border-b pb-4">
                    {[
                      { id: "all", label: "Todos" },
                      { id: "exterior", label: "Exterior" },
                      { id: "wheels", label: "Llantas" },
                      { id: "interior", label: "Interior" },
                      { id: "engine", label: "Motor" },
                      { id: "damage", label: "Daños" },
                    ].map((btn) => (
                      <Button
                        key={btn.id}
                        variant={photoGalleryFilter === btn.id ? "secondary" : "ghost"}
                        size="sm"
                        className={cn(
                          "h-8 px-3 text-xs font-medium rounded-full",
                          photoGalleryFilter === btn.id ? "bg-primary/10 text-primary hover:bg-primary/20" : ""
                        )}
                        onClick={() => setPhotoGalleryFilter(btn.id)}
                      >
                        {btn.label}
                      </Button>
                    ))}
                  </div>

                  <div className="space-y-8">
                    {(() => {
                      const rawVehicle = rawVehiclesData.find(v => v.id === selectedVehicle?.id);
                      const vehiclePhotos = rawVehicle?.photos || [];

                      if (vehiclePhotos.length === 0) {
                        return (
                          <div className="col-span-full text-center py-12 border border-dashed rounded-lg bg-muted/20">
                            <Camera className="h-16 w-16 mx-auto text-muted-foreground opacity-30 mb-4" />
                            <p className="text-muted-foreground font-medium">No hay fotos disponibles para este vehículo</p>
                          </div>
                        );
                      }

                      // Group photos by category
                      const groupedPhotos = vehiclePhotos.reduce((acc: any, photo: any) => {
                        const cat = photo.category || "other";
                        if (!acc[cat]) acc[cat] = [];
                        acc[cat].push(photo);
                        return acc;
                      }, {});

                      const categoriesToShow = photoGalleryFilter === 'all' 
                        ? Object.entries(groupedPhotos)
                        : Object.entries(groupedPhotos).filter(([cat]) => cat === photoGalleryFilter);

                      if (categoriesToShow.length === 0 && photoGalleryFilter !== 'all') {
                        return (
                          <div className="text-center py-12">
                            <Camera className="h-12 w-12 mx-auto text-muted-foreground opacity-20 mb-2" />
                            <p className="text-muted-foreground">No hay fotos en la categoría "{photoGalleryFilter}"</p>
                          </div>
                        );
                      }

                      return categoriesToShow.map(([category, catPhotos]: [string, any]) => (
                        <div key={category} className="space-y-4">
                          <div className="flex items-center gap-2 border-b pb-2">
                            <Camera className="h-4 w-4 text-primary" />
                            <h3 className="font-semibold text-lg capitalize">
                              {category === "exterior" ? "Exterior" :
                               category === "wheels" ? "Llantas y Rines" :
                               category === "interior" ? "Interior" :
                               category === "engine" ? "Motor" :
                               category === "damage" ? "Daños y Detalles" :
                               category.replace(/_/g, " ")}
                            </h3>
                            <Badge variant="secondary" className="ml-auto">
                              {catPhotos.length} {catPhotos.length === 1 ? "foto" : "fotos"}
                            </Badge>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                            {catPhotos.map((photo: any, index: number) => (
                              <VehiclePhoto photo={photo} index={index} key={photo.id || index} />
                            ))}
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="scanner" className="mt-4">
                <div className="py-4">
                  {(() => {
                    const rawVehicle = rawVehiclesData.find(v => v.id === selectedVehicle?.id);
                    const latestInspection = rawVehicle?.inspections?.[0];
                    const scannerUrl = latestInspection?.scannerResultUrl;

                    if (!scannerUrl) {
                      return (
                        <div className="border rounded-md p-6 flex flex-col items-center justify-center gap-4 bg-muted/50">
                          <FileText className="h-16 w-16 text-muted-foreground opacity-30" />
                          <div className="text-center">
                            <h3 className="font-medium text-muted-foreground">
                              No hay reporte de scanner disponible
                            </h3>
                            <p className="text-sm text-muted-foreground">
                              El reporte no fue cargado durante la inspección
                            </p>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div className="border rounded-md p-6 flex flex-col items-center justify-center gap-4 bg-muted/50">
                        <FileText className="h-16 w-16 text-primary opacity-70" />
                        <div className="text-center">
                          <h3 className="font-medium">
                            Reporte de Scanner - {selectedVehicle?.licensePlate}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            Archivo PDF
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.open(scannerUrl, "_blank")}
                        >
                          <FileText className="h-4 w-4 mr-2" />
                          Ver reporte
                        </Button>
                      </div>
                    );
                  })()}
                </div>
              </TabsContent>

              <TabsContent value="edit" className="mt-4">
                {selectedVehicle && (
                  <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="vehicleRating">
                          Calificación del vehículo
                        </Label>
                        <Select
                          value={editForm.vehicleRating}
                          onValueChange={(value) => setEditForm(prev => ({ ...prev, vehicleRating: value }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar calificación" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Comercial">Comercial</SelectItem>
                            <SelectItem value="No comercial">No comercial</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="status">Estado</Label>
                        <Select
                          value={editForm.status}
                          onValueChange={(value) => setEditForm(prev => ({ ...prev, status: value }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar estado" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="approved">Aprobado</SelectItem>
                            <SelectItem value="pending">Pendiente</SelectItem>
                            <SelectItem value="rejected">Rechazado</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="marketValue">Valor de mercado</Label>
                        <Input
                          id="marketValue"
                          value={editForm.marketValue}
                          onChange={(e) => setEditForm(prev => ({ ...prev, marketValue: e.target.value }))}
                          type="number"
                          readOnly
                          className="bg-slate-50 cursor-not-allowed border-green-200"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="suggestedCommercialValue">
                          Valor comercial sugerido
                        </Label>
                        <Input
                          id="suggestedCommercialValue"
                          value={editForm.suggestedCommercialValue}
                          onChange={(e) => setEditForm(prev => ({ ...prev, suggestedCommercialValue: e.target.value }))}
                          type="number"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="currentConditionValue">
                          Valor en condiciones actuales
                        </Label>
                        <Input
                          id="currentConditionValue"
                          value={editForm.currentConditionValue}
                          onChange={(e) => setEditForm(prev => ({ ...prev, currentConditionValue: e.target.value }))}
                          type="number"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="testDrive">Prueba de manejo</Label>
                        <Select
                          value={editForm.testDrive}
                          onValueChange={(value) => setEditForm(prev => ({ ...prev, testDrive: value }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Sí">Sí</SelectItem>
                            <SelectItem value="No">No</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="inspectionResult">
                        Resultado de la inspección
                      </Label>
                      <Textarea
                        id="inspectionResult"
                        value={editForm.inspectionResult}
                        onChange={(e) => setEditForm(prev => ({ ...prev, inspectionResult: e.target.value }))}
                        rows={5}
                      />
                    </div>
                  </div>
                )}
                <DialogFooter className="pt-4">
                  <Button variant="outline" onClick={() => setActiveTab("details")} disabled={isSaving}>
                    Cancelar
                  </Button>
                  <Button onClick={handleSaveChanges} disabled={isSaving}>
                    {isSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Guardando...
                      </>
                    ) : (
                      "Guardar cambios"
                    )}
                  </Button>
                </DialogFooter>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      <ImagePreviewDialog
        isOpen={previewImages.length > 0}
        onClose={() => setPreviewImages([])}
        images={previewImages}
        title="Evidencia de Rechazo / Daño"
      />
    </div>
  );
}
