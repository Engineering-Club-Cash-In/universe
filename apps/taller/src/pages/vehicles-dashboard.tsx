import { useState, useEffect } from "react";
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
  Hash,
} from "lucide-react";
import { getVehicleStatistics, getVehicleById } from "../services/vehicles";
import { vehiclesApi } from "../utils/orpc";
import type { Vehicle, VehicleInspection, VehiclePhoto, InspectionChecklistItem } from "../../../crm/apps/server/src/db/schema/vehicles";

// Type for what the getAll endpoint returns
type VehicleWithRelations = Vehicle & {
  inspections: (VehicleInspection & {
    checklistItems: InspectionChecklistItem[];
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
  vehicleRating: string;
  marketValue: string;
  suggestedCommercialValue: string;
  currentConditionValue: string;
  inspectionResult: string;
  airbagWarning: string;
  testDrive: string;
  status: string;
  photos: number;
  hasScanner: boolean;
  alerts: string[];
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

  return (
    <div
      key={photo.id || index}
      className="relative aspect-square bg-muted rounded-md overflow-hidden border"
    >
      <img
        src={photo.url}
        alt={photo.title || `Foto ${index + 1}`}
        className="w-full h-full object-cover"
        onError={() => setHasError(true)}
      />
      <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-1">
        <p className="text-xs text-white truncate text-center">
          {photo.title || `${photo.category} - ${photo.photoType}`}
        </p>
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

  // Pagination state
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [totalVehicles, setTotalVehicles] = useState(0);
  const [isModalLoading, setIsModalLoading] = useState(false);

  // Debounce search term
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1); // Reset to first page on search
      loadVehicles();
    }, 500);
    return () => clearTimeout(timer);
  }, [searchTerm, filterStatus, category]);

  // Load vehicles when page changes
  useEffect(() => {
    loadVehicles();
  }, [page]);

  useEffect(() => {
    loadStatistics();
  }, []);


  const transformVehicleData = (vehicle: VehicleWithRelations): DashboardVehicle => {
    // Get the latest inspection if available
    const latestInspection = vehicle.inspections?.[0] || null;

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
      vehicleRating: latestInspection?.vehicleRating || 'Pendiente',
      marketValue: latestInspection?.marketValue || '0',
      suggestedCommercialValue: latestInspection?.suggestedCommercialValue || '0',
      currentConditionValue: latestInspection?.currentConditionValue || '0',
      inspectionResult: latestInspection?.inspectionResult || 'Inspección pendiente',
      airbagWarning: latestInspection?.airbagWarning ? 'Sí' : 'No',
      testDrive: latestInspection?.testDrive ? 'Sí' : 'No',
      status: latestInspection?.status || vehicle.status || 'pending',
      photos: vehicle.photos?.length || 0,
      hasScanner: latestInspection?.scannerUsed || false,
      alerts: (latestInspection?.alerts as string[]) || [],
    };
  };

  const loadVehicles = async () => {
    setIsLoading(true);
    try {
      const offset = (page - 1) * pageSize;
      const result = await vehiclesApi.getAll({
        limit: pageSize,
        offset,
        query: searchTerm,
        status: filterStatus,
        category: category === 'all' ? undefined : category
      });

      if (result) {
        // Handle the new response format { data, total }
        // @ts-ignore - The API type might not be fully updated in the IDE context yet
        const rawData = result.data || [];
        // @ts-ignore
        const total = result.total || 0;

        setRawVehiclesData(rawData);
        const transformedVehicles = rawData.map(transformVehicleData);
        setVehicles(transformedVehicles);
        setTotalVehicles(total);
      } else {
        // Fall back to sample data if API fails
        setVehicles(sampleVehicles);
        setTotalVehicles(sampleVehicles.length);
      }
    } catch (error) {
      console.error("Error loading vehicles:", error);
      // Fall back to sample data if API fails
      setVehicles(sampleVehicles);
      setTotalVehicles(sampleVehicles.length);
    } finally {
      setIsLoading(false);
    }
  };

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

    try {
      const result = await getVehicleById(vehicle.id);
      if (result.success && result.data) {
        // Transform the full data if necessary, or just use it.
        // The modal uses selectedVehicle which is DashboardVehicle.
        // But it also accesses properties that might be on the full object.
        // Let's see what the modal uses. It uses vehicle.inspections, vehicle.photos etc.
        // DashboardVehicle has some of these but flattened.
        // The modal code does: const rawVehicle = rawVehiclesData.find(v => v.id === selectedVehicle?.id);
        // We need to update rawVehiclesData or store the full vehicle separately.
        // Better: store the full vehicle in a new state or update selectedVehicle to be the full type.
        // But selectedVehicle is typed as DashboardVehicle.
        // Let's update rawVehiclesData with the fetched vehicle to keep compatibility with existing modal code
        // that looks up rawVehiclesData.

        setRawVehiclesData(prev => {
          const index = prev.findIndex(v => v.id === vehicle.id);
          if (index >= 0) {
            const newArr = [...prev];
            newArr[index] = result.data as any;
            return newArr;
          }
          return [...prev, result.data as any];
        });

        // Also re-transform to update the dashboard view of it (e.g. if status changed)
        const transformed = transformVehicleData(result.data as any);
        setSelectedVehicle(transformed);
      }
    } catch (error) {
      console.error("Error loading vehicle details:", error);
    } finally {
      setIsModalLoading(false);
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
              <div className="flex justify-between mb-4">
                <div className="flex gap-2 w-full md:w-auto">
                  <div className="relative">
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
                    <SelectTrigger className="w-[180px]">
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
                <Button>
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
          <DialogHeader>
            <DialogTitle>
              {selectedVehicle?.vehicleMake} {selectedVehicle?.vehicleModel}
            </DialogTitle>
            <DialogDescription>
              {selectedVehicle?.licensePlate} - {selectedVehicle?.vinNumber}
            </DialogDescription>
          </DialogHeader>

          {isModalLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
              <p className="text-muted-foreground">Cargando detalles del vehículo...</p>
            </div>
          ) : (

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full pt-4">
              <TabsList>
                <TabsTrigger value="details">Detalles</TabsTrigger>
                <TabsTrigger value="photos">Fotos ({selectedVehicle?.photos || 0})</TabsTrigger>
                {selectedVehicle?.hasScanner && (
                  <TabsTrigger value="scanner">Scanner</TabsTrigger>
                )}
                <TabsTrigger value="edit">Editar</TabsTrigger>
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

                            <div className="text-muted-foreground">Modelo</div>
                            <div className="font-medium">{selectedVehicle.vehicleModel}</div>

                            <div className="text-muted-foreground">Año</div>
                            <div className="font-medium">{selectedVehicle.vehicleYear}</div>

                            <div className="text-muted-foreground">Tipo</div>
                            <div className="font-medium">{selectedVehicle.vehicleType}</div>
                          </div>

                          <div className="pt-2 border-t space-y-2">
                            <div className="flex items-center gap-2 text-sm">
                              <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-muted-foreground">Placa:</span>
                              <span className="font-mono font-medium">{selectedVehicle.licensePlate}</span>
                            </div>
                            <div className="flex items-start gap-2 text-sm">
                              <Hash className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                              <span className="text-muted-foreground">VIN:</span>
                              <span className="font-mono text-xs break-all">{selectedVehicle.vinNumber}</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                              <Palette className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-muted-foreground">Color:</span>
                              <span className="font-medium">{selectedVehicle.color}</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                              <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-muted-foreground">Kilometraje:</span>
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
                          <CardTitle className="text-base flex items-center gap-2">
                            <ClipboardCheck className="h-4 w-4" />
                            Datos de Inspección
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

                          {selectedVehicle.alerts && selectedVehicle.alerts.length > 0 && (
                            <div className="pt-3 border-t">
                              <p className="text-sm text-muted-foreground mb-2">Alertas detectadas:</p>
                              <div className="flex flex-wrap gap-1.5">
                                {selectedVehicle.alerts.map((alert: string, index: number) => (
                                  <Badge
                                    key={index}
                                    variant="outline"
                                    className="bg-red-50 text-red-700 border-red-200 text-xs"
                                  >
                                    {alert}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
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
                                {Number(selectedVehicle.marketValue).toLocaleString("es-GT", {
                                  style: "currency",
                                  currency: "GTQ",
                                  minimumFractionDigits: 0,
                                  maximumFractionDigits: 0,
                                })}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-sm text-muted-foreground">Valor comercial sugerido</span>
                              <span className="text-lg font-semibold text-primary">
                                {Number(selectedVehicle.suggestedCommercialValue).toLocaleString("es-GT", {
                                  style: "currency",
                                  currency: "GTQ",
                                  minimumFractionDigits: 0,
                                  maximumFractionDigits: 0,
                                })}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-sm text-muted-foreground">Valor actual condición</span>
                              <span className="text-lg font-semibold">
                                {Number(selectedVehicle.currentConditionValue).toLocaleString("es-GT", {
                                  style: "currency",
                                  currency: "GTQ",
                                  minimumFractionDigits: 0,
                                  maximumFractionDigits: 0,
                                })}
                              </span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>

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
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 py-4">
                  {(() => {
                    const rawVehicle = rawVehiclesData.find(v => v.id === selectedVehicle?.id);
                    const vehiclePhotos = rawVehicle?.photos || [];

                    if (vehiclePhotos.length === 0) {
                      return (
                        <div className="col-span-full text-center py-8">
                          <Camera className="h-16 w-16 mx-auto text-muted-foreground opacity-50" />
                          <p className="text-muted-foreground mt-2">No hay fotos disponibles para este vehículo</p>
                        </div>
                      );
                    }

                    return vehiclePhotos.map((photo: any, index: number) => (
                      <VehiclePhoto photo={photo} index={index} key={photo.id || index} />
                    ));
                  })()}
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
                        <Select defaultValue={selectedVehicle.vehicleRating}>
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
                        <Select defaultValue={selectedVehicle.status}>
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
                          defaultValue={selectedVehicle.marketValue}
                          type="number"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="suggestedCommercialValue">
                          Valor comercial sugerido
                        </Label>
                        <Input
                          id="suggestedCommercialValue"
                          defaultValue={selectedVehicle.suggestedCommercialValue}
                          type="number"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="currentConditionValue">
                          Valor en condiciones actuales
                        </Label>
                        <Input
                          id="currentConditionValue"
                          defaultValue={selectedVehicle.currentConditionValue}
                          type="number"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="testDrive">Prueba de manejo</Label>
                        <Select defaultValue={selectedVehicle.testDrive}>
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
                        defaultValue={selectedVehicle.inspectionResult}
                        rows={5}
                      />
                    </div>
                  </div>
                )}
                <DialogFooter className="pt-4">
                  <Button variant="outline" onClick={() => setActiveTab("details")}>
                    Cancelar
                  </Button>
                  <Button
                    onClick={() => {
                      // Here would be the logic to save the changes
                      setIsDetailsOpen(false);
                      // Show a success message
                    }}
                  >
                    Guardar cambios
                  </Button>
                </DialogFooter>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
