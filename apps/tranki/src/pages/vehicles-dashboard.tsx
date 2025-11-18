import { useState } from "react";
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
} from "lucide-react";

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

export default function VehiclesDashboard() {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [selectedVehicle, setSelectedVehicle] = useState<
    (typeof sampleVehicles)[number] | null
  >(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isPhotosOpen, setIsPhotosOpen] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);

  // Filter vehicles based on search term and filter status
  const filteredVehicles = sampleVehicles.filter((vehicle) => {
    const matchesSearch =
      vehicle.vehicleMake.toLowerCase().includes(searchTerm.toLowerCase()) ||
      vehicle.vehicleModel.toLowerCase().includes(searchTerm.toLowerCase()) ||
      vehicle.licensePlate.toLowerCase().includes(searchTerm.toLowerCase()) ||
      vehicle.vinNumber.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus =
      filterStatus === "all" || vehicle.status === filterStatus;

    return matchesSearch && matchesStatus;
  });

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
    total: sampleVehicles.length,
    approved: sampleVehicles.filter((v) => v.status === "approved").length,
    pending: sampleVehicles.filter((v) => v.status === "pending").length,
    rejected: sampleVehicles.filter((v) => v.status === "rejected").length,
    commercial: sampleVehicles.filter((v) => v.vehicleRating === "Comercial")
      .length,
    nonCommercial: sampleVehicles.filter(
      (v) => v.vehicleRating === "No comercial"
    ).length,
    withAlerts: sampleVehicles.filter((v) => v.alerts.length > 0).length,
  };

  // Mock photos for the vehicle gallery
  const mockPhotos = [
    "/placeholder-car-1.jpg",
    "/placeholder-car-2.jpg",
    "/placeholder-car-3.jpg",
    "/placeholder-car-4.jpg",
    "/placeholder-car-5.jpg",
  ];

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

      <Tabs defaultValue="all" className="w-full">
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
                  <a href="/vehicle-inspection">Nueva Inspección</a>
                </Button>
              </div>

              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">ID</TableHead>
                      <TableHead>Vehículo</TableHead>
                      <TableHead>Placa</TableHead>
                      <TableHead>Valor Comercial</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Alertas</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredVehicles.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="h-24 text-center">
                          No se encontraron resultados.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredVehicles.map((vehicle) => (
                        <TableRow key={vehicle.id}>
                          <TableCell className="font-medium">
                            {vehicle.id}
                          </TableCell>
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
                            {format(vehicle.inspectionDate, "dd MMM yyyy", {
                              locale: es,
                            })}
                          </TableCell>
                          <TableCell>
                            {renderStatusBadge(vehicle.status)}
                          </TableCell>
                          <TableCell>
                            {vehicle.alerts.length > 0 ? (
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
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="h-8 w-8 p-0">
                                  <span className="sr-only">Abrir menú</span>
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setSelectedVehicle(vehicle);
                                    setIsDetailsOpen(true);
                                  }}
                                >
                                  Ver detalles
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setSelectedVehicle(vehicle);
                                    setIsEditOpen(true);
                                  }}
                                >
                                  Editar inspección
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => {
                                    setSelectedVehicle(vehicle);
                                    setIsPhotosOpen(true);
                                  }}
                                >
                                  Ver fotos ({vehicle.photos})
                                </DropdownMenuItem>
                                {vehicle.hasScanner && (
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setSelectedVehicle(vehicle);
                                      setIsScannerOpen(true);
                                    }}
                                  >
                                    Ver reporte de scanner
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
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
                      <TableHead className="w-[50px]">ID</TableHead>
                      <TableHead>Vehículo</TableHead>
                      <TableHead>Alertas</TableHead>
                      <TableHead>Detalles</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sampleVehicles
                      .filter((v) => v.alerts.length > 0)
                      .map((vehicle) => (
                        <TableRow key={vehicle.id}>
                          <TableCell className="font-medium">
                            {vehicle.id}
                          </TableCell>
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
                            <div className="flex flex-wrap gap-1">
                              {vehicle.alerts.map((alert, index) => (
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
                              onClick={() => {
                                setSelectedVehicle(vehicle);
                                setIsDetailsOpen(true);
                              }}
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              Ver detalles
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
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
                      <TableHead className="w-[50px]">ID</TableHead>
                      <TableHead>Vehículo</TableHead>
                      <TableHead>Valor Mercado</TableHead>
                      <TableHead>Valor Sugerido</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sampleVehicles
                      .filter((v) => v.vehicleRating === "Comercial")
                      .map((vehicle) => (
                        <TableRow key={vehicle.id}>
                          <TableCell className="font-medium">
                            {vehicle.id}
                          </TableCell>
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
                              onClick={() => {
                                setSelectedVehicle(vehicle);
                                setIsDetailsOpen(true);
                              }}
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              Ver detalles
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
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
                      <TableHead className="w-[50px]">ID</TableHead>
                      <TableHead>Vehículo</TableHead>
                      <TableHead>Razones</TableHead>
                      <TableHead>Detalles</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sampleVehicles
                      .filter((v) => v.vehicleRating === "No comercial")
                      .map((vehicle) => (
                        <TableRow key={vehicle.id}>
                          <TableCell className="font-medium">
                            {vehicle.id}
                          </TableCell>
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
                            <div className="flex flex-wrap gap-1">
                              {vehicle.alerts.map((alert, index) => (
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
                              onClick={() => {
                                setSelectedVehicle(vehicle);
                                setIsDetailsOpen(true);
                              }}
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              Ver detalles
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Vehicle Details Dialog */}
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Detalles del Vehículo</DialogTitle>
            <DialogDescription>
              Información completa del vehículo {selectedVehicle?.vehicleMake}{" "}
              {selectedVehicle?.vehicleModel}
            </DialogDescription>
          </DialogHeader>

          {selectedVehicle && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">Información General</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="text-sm font-medium">Marca:</div>
                    <div className="text-sm">{selectedVehicle.vehicleMake}</div>
                    <div className="text-sm font-medium">Modelo:</div>
                    <div className="text-sm">
                      {selectedVehicle.vehicleModel}
                    </div>
                    <div className="text-sm font-medium">Año:</div>
                    <div className="text-sm">{selectedVehicle.vehicleYear}</div>
                    <div className="text-sm font-medium">Placa:</div>
                    <div className="text-sm">
                      {selectedVehicle.licensePlate}
                    </div>
                    <div className="text-sm font-medium">VIN:</div>
                    <div className="text-sm">{selectedVehicle.vinNumber}</div>
                    <div className="text-sm font-medium">Color:</div>
                    <div className="text-sm">{selectedVehicle.color}</div>
                    <div className="text-sm font-medium">Kilometraje:</div>
                    <div className="text-sm">
                      {selectedVehicle.kmMileage} km
                    </div>
                    <div className="text-sm font-medium">Tipo:</div>
                    <div className="text-sm">{selectedVehicle.vehicleType}</div>
                    <div className="text-sm font-medium">Combustible:</div>
                    <div className="text-sm">{selectedVehicle.fuelType}</div>
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">Inspección</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="text-sm font-medium">Fecha:</div>
                    <div className="text-sm">
                      {format(selectedVehicle.inspectionDate, "dd/MM/yyyy", {
                        locale: es,
                      })}
                    </div>
                    <div className="text-sm font-medium">Técnico:</div>
                    <div className="text-sm">
                      {selectedVehicle.technicianName}
                    </div>
                    <div className="text-sm font-medium">Estado:</div>
                    <div className="text-sm">
                      {renderStatusBadge(selectedVehicle.status)}
                    </div>
                    <div className="text-sm font-medium">Prueba de manejo:</div>
                    <div className="text-sm">{selectedVehicle.testDrive}</div>
                    <div className="text-sm font-medium">
                      Testigo de airbag:
                    </div>
                    <div className="text-sm">
                      {selectedVehicle.airbagWarning}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">Valoración</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="text-sm font-medium">Calificación:</div>
                    <div
                      className={cn(
                        "text-sm font-semibold",
                        selectedVehicle.vehicleRating === "Comercial"
                          ? "text-green-500"
                          : "text-red-500"
                      )}
                    >
                      {selectedVehicle.vehicleRating}
                    </div>
                    <div className="text-sm font-medium">Valor de mercado:</div>
                    <div className="text-sm">
                      {Number(selectedVehicle.marketValue).toLocaleString(
                        "es-GT",
                        {
                          style: "currency",
                          currency: "GTQ",
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 0,
                        }
                      )}
                    </div>
                    <div className="text-sm font-medium">
                      Valor comercial sugerido:
                    </div>
                    <div className="text-sm">
                      {Number(
                        selectedVehicle.suggestedCommercialValue
                      ).toLocaleString("es-GT", {
                        style: "currency",
                        currency: "GTQ",
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      })}
                    </div>
                    <div className="text-sm font-medium">
                      Valor en condiciones actuales:
                    </div>
                    <div className="text-sm">
                      {Number(
                        selectedVehicle.currentConditionValue
                      ).toLocaleString("es-GT", {
                        style: "currency",
                        currency: "GTQ",
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      })}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">
                    Resultado de la inspección
                  </h3>
                  <p className="text-sm border rounded-md p-3 bg-muted/50">
                    {selectedVehicle.inspectionResult}
                  </p>
                </div>

                {selectedVehicle.alerts.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold text-red-500">
                      Alertas
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {selectedVehicle.alerts.map((alert, index) => (
                        <Badge
                          key={index}
                          variant="outline"
                          className="bg-red-100 text-red-800 border-red-300"
                        >
                          {alert}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDetailsOpen(false)}>
              Cerrar
            </Button>
            <Button
              onClick={() => {
                setIsDetailsOpen(false);
                setIsEditOpen(true);
              }}
            >
              Editar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Vehicle Photos Dialog */}
      <Dialog open={isPhotosOpen} onOpenChange={setIsPhotosOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Fotografías del Vehículo</DialogTitle>
            <DialogDescription>
              {selectedVehicle?.vehicleMake} {selectedVehicle?.vehicleModel} -{" "}
              {selectedVehicle?.licensePlate}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 py-4">
            {mockPhotos
              .slice(0, selectedVehicle?.photos || 0)
              .map((_photo, index) => (
                <div
                  key={index}
                  className="relative aspect-square bg-muted rounded-md overflow-hidden border"
                >
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                    <Camera className="h-10 w-10 opacity-20" />
                    <span className="absolute inset-0 flex items-center justify-center font-medium">
                      Foto {index + 1}
                    </span>
                  </div>
                </div>
              ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPhotosOpen(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Scanner Report Dialog */}
      <Dialog open={isScannerOpen} onOpenChange={setIsScannerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reporte de Scanner</DialogTitle>
            <DialogDescription>
              {selectedVehicle?.vehicleMake} {selectedVehicle?.vehicleModel} -{" "}
              {selectedVehicle?.licensePlate}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="border rounded-md p-6 flex flex-col items-center justify-center gap-4 bg-muted/50">
              <FileText className="h-16 w-16 text-muted-foreground opacity-50" />
              <div className="text-center">
                <h3 className="font-medium">
                  Reporte_Scanner_
                  {selectedVehicle?.licensePlate.replace(/[-\s]/g, "")}.pdf
                </h3>
                <p className="text-sm text-muted-foreground">
                  Archivo PDF - 2.4 MB
                </p>
              </div>
              <Button variant="outline" size="sm">
                Descargar reporte
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsScannerOpen(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Vehicle Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Editar Inspección</DialogTitle>
            <DialogDescription>
              {selectedVehicle?.vehicleMake} {selectedVehicle?.vehicleModel} -{" "}
              {selectedVehicle?.licensePlate}
            </DialogDescription>
          </DialogHeader>

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

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                // Here would be the logic to save the changes
                setIsEditOpen(false);
                // Show a success message
              }}
            >
              Guardar cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
