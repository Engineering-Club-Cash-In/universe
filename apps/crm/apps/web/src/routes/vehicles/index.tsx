import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
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
  Car,
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
import { Skeleton } from "@/components/ui/skeleton";
import { client, orpc } from "@/utils/orpc";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

export const Route = createFileRoute("/vehicles/")({
  component: VehiclesDashboard,
});

function VehiclesDashboard() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [selectedVehicle, setSelectedVehicle] = useState<any>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("general");

  // Fetch vehicles
  const { data: vehicles, isLoading } = useQuery(
    orpc.getVehicles.queryOptions(),
  );
  const { data: statistics } = useQuery(
    orpc.getVehicleStatistics.queryOptions(),
  );

  // Filter vehicles based on search term and filter status
  const filteredVehicles = vehicles?.filter((vehicle: any) => {
    const latestInspection = vehicle.inspections?.[0];

    const matchesSearch =
      vehicle.make.toLowerCase().includes(searchTerm.toLowerCase()) ||
      vehicle.model.toLowerCase().includes(searchTerm.toLowerCase()) ||
      vehicle.licensePlate.toLowerCase().includes(searchTerm.toLowerCase()) ||
      vehicle.vinNumber.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus =
      filterStatus === "all" ||
      (latestInspection && latestInspection.status === filterStatus);

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

  if (isLoading) {
    return (
      <div className="flex flex-col p-6 gap-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-32" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

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
              Total de Vehículos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statistics?.totalVehicles || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Disponibles
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">
              {statistics?.availableVehicles || 0}
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
              {statistics?.pendingInspections || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Con Alertas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-500">
              {statistics?.vehiclesWithAlerts || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="all" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="all">Todos</TabsTrigger>
          <TabsTrigger value="alerts">
            Con Alertas ({statistics?.vehiclesWithAlerts || 0})
          </TabsTrigger>
          <TabsTrigger value="commercial">
            Comerciales ({statistics?.commercialVehicles || 0})
          </TabsTrigger>
          <TabsTrigger value="non-commercial">
            No Comerciales ({statistics?.nonCommercialVehicles || 0})
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
              </div>

              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
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
                    {filteredVehicles?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="h-24 text-center">
                          No se encontraron resultados.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredVehicles?.map((vehicle: any) => {
                        const latestInspection = vehicle.inspections?.[0];
                        return (
                          <TableRow key={vehicle.id}>
                            <TableCell>
                              <div className="font-medium">
                                {vehicle.make} {vehicle.model}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {vehicle.year} - {vehicle.color}
                              </div>
                            </TableCell>
                            <TableCell>{vehicle.licensePlate}</TableCell>
                            <TableCell>
                              {latestInspection ? (
                                <>
                                  <div className="font-medium">
                                    Q
                                    {Number(
                                      latestInspection.suggestedCommercialValue,
                                    ).toLocaleString("es-GT")}
                                  </div>
                                  <div
                                    className={
                                      latestInspection.vehicleRating ===
                                      "Comercial"
                                        ? "text-sm text-green-500"
                                        : "text-sm text-red-500"
                                    }
                                  >
                                    {latestInspection.vehicleRating}
                                  </div>
                                </>
                              ) : (
                                <span className="text-muted-foreground">
                                  Sin inspección
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              {latestInspection
                                ? format(
                                    new Date(latestInspection.inspectionDate),
                                    "dd MMM yyyy",
                                    { locale: es },
                                  )
                                : "-"}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                {latestInspection
                                  ? renderStatusBadge(latestInspection.status)
                                  : renderStatusBadge("pending")}
                                {(vehicle as any).hasPaymentAgreement && (
                                  <Badge
                                    variant="outline"
                                    className="bg-blue-100 text-blue-800 border-blue-300 text-xs"
                                  >
                                    Convenio de Pago
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {latestInspection?.alerts?.length > 0 ? (
                                <Badge
                                  variant="outline"
                                  className="bg-red-100 text-red-800 border-red-300"
                                >
                                  {latestInspection.alerts.length}{" "}
                                  {latestInspection.alerts.length === 1
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
                                  <Button
                                    variant="ghost"
                                    className="h-8 w-8 p-0"
                                  >
                                    <span className="sr-only">Abrir menú</span>
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuLabel>
                                    Acciones
                                  </DropdownMenuLabel>
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setSelectedVehicle(vehicle);
                                      setActiveTab("general");
                                      setIsDetailsOpen(true);
                                    }}
                                  >
                                    <Eye className="mr-2 h-4 w-4" />
                                    Ver detalles completos
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setSelectedVehicle(vehicle);
                                      setActiveTab("photos");
                                      setIsDetailsOpen(true);
                                    }}
                                  >
                                    <Camera className="mr-2 h-4 w-4" />
                                    Ver fotografías
                                  </DropdownMenuItem>
                                  {latestInspection?.scannerUsed &&
                                    latestInspection?.scannerResultUrl && (
                                      <DropdownMenuItem
                                        onClick={() => {
                                          window.open(
                                            latestInspection.scannerResultUrl,
                                            "_blank",
                                          );
                                        }}
                                      >
                                        <FileText className="mr-2 h-4 w-4" />
                                        Ver reporte de scanner
                                      </DropdownMenuItem>
                                    )}
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => {
                                      // Copy VIN to clipboard
                                      navigator.clipboard.writeText(
                                        vehicle.vinNumber,
                                      );
                                      toast.success(
                                        "VIN copiado al portapapeles",
                                      );
                                    }}
                                  >
                                    <FileText className="mr-2 h-4 w-4" />
                                    Copiar VIN
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Vehicle Details Dialog */}
      <Dialog
        open={isDetailsOpen}
        onOpenChange={(open) => {
          setIsDetailsOpen(open);
          if (!open) {
            setActiveTab("general"); // Reset tab when closing
          }
        }}
      >
        <DialogContent className="min-w-[90vw] max-w-7xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalles del Vehículo</DialogTitle>
            <DialogDescription>
              Información completa del vehículo {selectedVehicle?.make}{" "}
              {selectedVehicle?.model} {selectedVehicle?.year}
            </DialogDescription>
          </DialogHeader>

          {selectedVehicle && (
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="general">Información General</TabsTrigger>
                <TabsTrigger value="inspections">Inspecciones</TabsTrigger>
                <TabsTrigger value="photos">Fotografías</TabsTrigger>
              </TabsList>

              <TabsContent value="general" className="space-y-4 mt-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">
                        Datos del Vehículo
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="text-sm font-medium">Marca:</div>
                        <div className="text-sm">{selectedVehicle.make}</div>
                        <div className="text-sm font-medium">Modelo:</div>
                        <div className="text-sm">{selectedVehicle.model}</div>
                        <div className="text-sm font-medium">Año:</div>
                        <div className="text-sm">{selectedVehicle.year}</div>
                        <div className="text-sm font-medium">Placa:</div>
                        <div className="text-sm">
                          {selectedVehicle.licensePlate}
                        </div>
                        <div className="text-sm font-medium">VIN:</div>
                        <div className="text-sm">
                          {selectedVehicle.vinNumber}
                        </div>
                        <div className="text-sm font-medium">Color:</div>
                        <div className="text-sm">{selectedVehicle.color}</div>
                        <div className="text-sm font-medium">Tipo:</div>
                        <div className="text-sm">
                          {selectedVehicle.vehicleType}
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">
                        Especificaciones Técnicas
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="text-sm font-medium">Kilometraje:</div>
                        <div className="text-sm">
                          {selectedVehicle.kmMileage?.toLocaleString()} km
                        </div>
                        {selectedVehicle.milesMileage && (
                          <>
                            <div className="text-sm font-medium">Millaje:</div>
                            <div className="text-sm">
                              {selectedVehicle.milesMileage?.toLocaleString()}{" "}
                              mi
                            </div>
                          </>
                        )}
                        <div className="text-sm font-medium">Origen:</div>
                        <div className="text-sm">{selectedVehicle.origin}</div>
                        <div className="text-sm font-medium">Cilindros:</div>
                        <div className="text-sm">
                          {selectedVehicle.cylinders}
                        </div>
                        <div className="text-sm font-medium">Motor (CC):</div>
                        <div className="text-sm">
                          {selectedVehicle.engineCC}
                        </div>
                        <div className="text-sm font-medium">Combustible:</div>
                        <div className="text-sm">
                          {selectedVehicle.fuelType}
                        </div>
                        <div className="text-sm font-medium">Transmisión:</div>
                        <div className="text-sm">
                          {selectedVehicle.transmission}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="inspections" className="space-y-4 mt-4">
                {selectedVehicle.inspections &&
                selectedVehicle.inspections.length > 0 ? (
                  <div className="space-y-4">
                    {selectedVehicle.inspections.map(
                      (inspection: any, index: number) => {
                        console.log("Inspection data:", inspection);
                        return (
                          <Card key={inspection.id || index}>
                            <CardHeader>
                              <div className="flex justify-between items-center">
                                <CardTitle className="text-lg">
                                  Inspección #{index + 1}
                                </CardTitle>
                                <Badge
                                  variant={
                                    inspection.status === "approved"
                                      ? "default"
                                      : inspection.status === "rejected"
                                        ? "destructive"
                                        : "secondary"
                                  }
                                >
                                  {inspection.status === "approved"
                                    ? "Aprobada"
                                    : inspection.status === "rejected"
                                      ? "Rechazada"
                                      : "Pendiente"}
                                </Badge>
                              </div>
                              <CardDescription>
                                Realizada por {inspection.technicianName} el{" "}
                                {inspection.inspectionDate
                                  ? format(
                                      new Date(inspection.inspectionDate),
                                      "PPP",
                                      { locale: es },
                                    )
                                  : "N/A"}
                              </CardDescription>
                            </CardHeader>
                            <CardContent>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-4">
                                  <div>
                                    <h4 className="font-semibold mb-2">
                                      Valoración
                                    </h4>
                                    <div className="grid grid-cols-2 gap-2 text-sm">
                                      <div className="font-medium">
                                        Calificación:
                                      </div>
                                      <div
                                        className={
                                          inspection.vehicleRating ===
                                          "Comercial"
                                            ? "font-semibold text-green-600"
                                            : "font-semibold text-red-600"
                                        }
                                      >
                                        {inspection.vehicleRating}
                                      </div>
                                      <div className="font-medium">
                                        Valor de mercado:
                                      </div>
                                      <div>
                                        Q
                                        {Number(
                                          inspection.marketValue,
                                        ).toLocaleString("es-GT")}
                                      </div>
                                      <div className="font-medium">
                                        Valor comercial:
                                      </div>
                                      <div>
                                        Q
                                        {Number(
                                          inspection.suggestedCommercialValue,
                                        ).toLocaleString("es-GT")}
                                      </div>
                                      <div className="font-medium">
                                        Valor bancario:
                                      </div>
                                      <div>
                                        Q
                                        {Number(
                                          inspection.bankValue,
                                        ).toLocaleString("es-GT")}
                                      </div>
                                      <div className="font-medium">
                                        Valor actual:
                                      </div>
                                      <div>
                                        Q
                                        {Number(
                                          inspection.currentConditionValue,
                                        ).toLocaleString("es-GT")}
                                      </div>
                                    </div>
                                  </div>

                                  <div>
                                    <h4 className="font-semibold mb-2">
                                      Diagnóstico
                                    </h4>
                                    <div className="grid grid-cols-2 gap-2 text-sm">
                                      <div className="font-medium">
                                        Escáner usado:
                                      </div>
                                      <div>
                                        {inspection.scannerUsed ? "Sí" : "No"}
                                      </div>
                                      <div className="font-medium">
                                        Testigo airbag:
                                      </div>
                                      <div>
                                        {inspection.airbagWarning ? "Sí" : "No"}
                                      </div>
                                      {inspection.missingAirbag && (
                                        <>
                                          <div className="font-medium">
                                            Airbag faltante:
                                          </div>
                                          <div>{inspection.missingAirbag}</div>
                                        </>
                                      )}
                                      <div className="font-medium">
                                        Prueba de manejo:
                                      </div>
                                      <div>
                                        {inspection.testDrive ? "Sí" : "No"}
                                      </div>
                                      {inspection.noTestDriveReason && (
                                        <>
                                          <div className="font-medium">
                                            Razón sin prueba:
                                          </div>
                                          <div>
                                            {inspection.noTestDriveReason}
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <div className="space-y-4">
                                  <div>
                                    <h4 className="font-semibold mb-2">
                                      Equipamiento
                                    </h4>
                                    <p className="text-sm text-muted-foreground">
                                      {inspection.vehicleEquipment ||
                                        "No especificado"}
                                    </p>
                                  </div>

                                  <div>
                                    <h4 className="font-semibold mb-2">
                                      Consideraciones Importantes
                                    </h4>
                                    <p className="text-sm text-muted-foreground">
                                      {inspection.importantConsiderations ||
                                        "Sin observaciones adicionales"}
                                    </p>
                                  </div>

                                  <div>
                                    <h4 className="font-semibold mb-2">
                                      Resultado de Inspección
                                    </h4>
                                    <p className="text-sm bg-muted/50 p-3 rounded-md">
                                      {inspection.inspectionResult}
                                    </p>
                                  </div>

                                  {inspection.alerts &&
                                    inspection.alerts.length > 0 && (
                                      <div>
                                        <h4 className="font-semibold mb-2 text-red-600">
                                          Alertas
                                        </h4>
                                        <div className="space-y-1">
                                          {inspection.alerts.map(
                                            (alert: string, idx: number) => (
                                              <Badge
                                                key={idx}
                                                variant="destructive"
                                                className="mr-2"
                                              >
                                                {alert}
                                              </Badge>
                                            ),
                                          )}
                                        </div>
                                      </div>
                                    )}
                                </div>
                              </div>

                              {/* Checklist Section */}
                              {inspection.checklistItems &&
                                inspection.checklistItems.length > 0 && (
                                  <div className="mt-6 pt-6 border-t">
                                    <h4 className="font-semibold mb-4">
                                      Evaluación de Criterios
                                    </h4>
                                    <div className="space-y-4">
                                      {/* Group checklist items by category */}
                                      {Object.entries(
                                        inspection.checklistItems.reduce(
                                          (acc: any, item: any) => {
                                            if (!acc[item.category]) {
                                              acc[item.category] = [];
                                            }
                                            acc[item.category].push(item);
                                            return acc;
                                          },
                                          {},
                                        ),
                                      ).map(
                                        ([category, items]: [string, any]) => (
                                          <div
                                            key={category}
                                            className="space-y-2"
                                          >
                                            <h5 className="text-sm font-medium text-muted-foreground capitalize">
                                              {category.replace(/_/g, " ")}
                                            </h5>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                              {items.map(
                                                (item: any, idx: number) => (
                                                  <div
                                                    key={idx}
                                                    className="flex items-center justify-between p-2 rounded-md border bg-muted/20"
                                                  >
                                                    <span className="text-sm">
                                                      {item.item}
                                                    </span>
                                                    <Badge
                                                      variant={
                                                        item.checked
                                                          ? "default"
                                                          : !item.checked &&
                                                              item.severity ===
                                                                "critical"
                                                            ? "destructive"
                                                            : "secondary"
                                                      }
                                                      className="text-xs"
                                                    >
                                                      {item.checked
                                                        ? "✓ Cumple"
                                                        : "✗ No cumple"}
                                                    </Badge>
                                                  </div>
                                                ),
                                              )}
                                            </div>
                                          </div>
                                        ),
                                      )}

                                      {/* Summary of critical issues */}
                                      {inspection.checklistItems.some(
                                        (item: any) =>
                                          !item.checked &&
                                          item.severity === "critical",
                                      ) && (
                                        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
                                          <h5 className="text-sm font-semibold text-red-900 mb-2">
                                            Criterios Críticos de Rechazo
                                          </h5>
                                          <ul className="text-sm text-red-700 space-y-1">
                                            {inspection.checklistItems
                                              .filter(
                                                (item: any) =>
                                                  !item.checked &&
                                                  item.severity === "critical",
                                              )
                                              .map((item: any, idx: number) => (
                                                <li
                                                  key={idx}
                                                  className="flex items-start"
                                                >
                                                  <span className="mr-2">
                                                    •
                                                  </span>
                                                  <span>{item.item}</span>
                                                </li>
                                              ))}
                                          </ul>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                            </CardContent>
                          </Card>
                        );
                      },
                    )}
                  </div>
                ) : (
                  <Card>
                    <CardContent className="text-center py-8">
                      <p className="text-muted-foreground">
                        No hay inspecciones registradas para este vehículo
                      </p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="photos" className="space-y-4 mt-4">
                {selectedVehicle.photos && selectedVehicle.photos.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {selectedVehicle.photos.map((photo: any, index: number) => (
                      <Card key={photo.id || index}>
                        <CardContent className="p-2">
                          <img
                            src={photo.url || "/placeholder.svg"}
                            alt={photo.title || `Foto ${index + 1}`}
                            className="w-full h-40 object-cover rounded-md"
                          />
                          <p className="text-sm font-medium mt-2">
                            {photo.title}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {photo.category}
                          </p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <Card>
                    <CardContent className="text-center py-8">
                      <Camera className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                      <p className="text-muted-foreground">
                        No hay fotografías disponibles
                      </p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            </Tabs>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDetailsOpen(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
