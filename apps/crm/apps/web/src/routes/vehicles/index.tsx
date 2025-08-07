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
  Plus,
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
  const [isPhotosOpen, setIsPhotosOpen] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);

  // Fetch vehicles
  const { data: vehicles, isLoading } = useQuery(orpc.getVehicles.queryOptions());
  const { data: statistics } = useQuery(orpc.getVehicleStatistics.queryOptions());

  // Mutations
  const updateInspectionMutation = useMutation({
    mutationFn: async (params: { id: string; data: any }) => {
      return await client.updateVehicleInspection(params);
    },
    onSuccess: () => {
      toast.success("Inspección actualizada correctamente");
      setIsEditOpen(false);
    },
    onError: () => {
      toast.error("Error al actualizar la inspección");
    },
  });

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

  const handleEditSave = async (data: any) => {
    if (!selectedVehicle?.inspections?.[0]) return;

    await updateInspectionMutation.mutateAsync({
      id: selectedVehicle.inspections[0].id,
      data,
    });
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
        <Button onClick={() => navigate({ to: "/vehicles/inspection" })}>
          <Plus className="mr-2 h-4 w-4" />
          Nueva Inspección
        </Button>
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
            <div className="text-2xl font-bold">{statistics?.totalVehicles || 0}</div>
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
                                    Q{Number(
                                      latestInspection.suggestedCommercialValue
                                    ).toLocaleString("es-GT")}
                                  </div>
                                  <div
                                    className={
                                      latestInspection.vehicleRating === "Comercial"
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
                              {latestInspection ? (
                                format(
                                  new Date(latestInspection.inspectionDate),
                                  "dd MMM yyyy",
                                  { locale: es }
                                )
                              ) : (
                                "-"
                              )}
                            </TableCell>
                            <TableCell>
                              {latestInspection
                                ? renderStatusBadge(latestInspection.status)
                                : renderStatusBadge("pending")}
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
                                    Ver fotos
                                  </DropdownMenuItem>
                                  {latestInspection?.scannerUsed && (
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
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Detalles del Vehículo</DialogTitle>
            <DialogDescription>
              Información completa del vehículo {selectedVehicle?.make}{" "}
              {selectedVehicle?.model}
            </DialogDescription>
          </DialogHeader>

          {selectedVehicle && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">Información General</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="text-sm font-medium">Marca:</div>
                    <div className="text-sm">{selectedVehicle.make}</div>
                    <div className="text-sm font-medium">Modelo:</div>
                    <div className="text-sm">{selectedVehicle.model}</div>
                    <div className="text-sm font-medium">Año:</div>
                    <div className="text-sm">{selectedVehicle.year}</div>
                    <div className="text-sm font-medium">Placa:</div>
                    <div className="text-sm">{selectedVehicle.licensePlate}</div>
                    <div className="text-sm font-medium">VIN:</div>
                    <div className="text-sm">{selectedVehicle.vinNumber}</div>
                    <div className="text-sm font-medium">Color:</div>
                    <div className="text-sm">{selectedVehicle.color}</div>
                    <div className="text-sm font-medium">Kilometraje:</div>
                    <div className="text-sm">{selectedVehicle.kmMileage} km</div>
                    <div className="text-sm font-medium">Tipo:</div>
                    <div className="text-sm">{selectedVehicle.vehicleType}</div>
                    <div className="text-sm font-medium">Combustible:</div>
                    <div className="text-sm">{selectedVehicle.fuelType}</div>
                  </div>
                </div>
              </div>

              {selectedVehicle.inspections?.[0] && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold">Valoración</h3>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="text-sm font-medium">Calificación:</div>
                      <div
                        className={
                          selectedVehicle.inspections[0].vehicleRating === "Comercial"
                            ? "text-sm font-semibold text-green-500"
                            : "text-sm font-semibold text-red-500"
                        }
                      >
                        {selectedVehicle.inspections[0].vehicleRating}
                      </div>
                      <div className="text-sm font-medium">Valor de mercado:</div>
                      <div className="text-sm">
                        Q{Number(selectedVehicle.inspections[0].marketValue).toLocaleString(
                          "es-GT"
                        )}
                      </div>
                      <div className="text-sm font-medium">
                        Valor comercial sugerido:
                      </div>
                      <div className="text-sm">
                        Q{Number(
                          selectedVehicle.inspections[0].suggestedCommercialValue
                        ).toLocaleString("es-GT")}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold">
                      Resultado de la inspección
                    </h3>
                    <p className="text-sm border rounded-md p-3 bg-muted/50">
                      {selectedVehicle.inspections[0].inspectionResult}
                    </p>
                  </div>
                </div>
              )}
            </div>
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