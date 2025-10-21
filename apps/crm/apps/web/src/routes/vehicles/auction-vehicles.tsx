import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, Car, AlertTriangle, CheckCircle, XCircle, Camera } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { orpc } from "@/utils/orpc";
import { renderInspectionStatusBadge } from "@/lib/vehicle-utils";

export const Route = createFileRoute("/vehicles/auction-vehicles")({
  component: AuctionsDashboard,
});

function AuctionsDashboard() {
  const [selectedAuction, setSelectedAuction] = useState<any>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [finalPrice, setFinalPrice] = useState<number | null>(null);
  const [isPhotosOpen, setIsPhotosOpen] = useState(false);
  const [photosVehicle, setPhotosVehicle] = useState<any>(null);
  const queryClient = useQueryClient();

  // Fetch auctions
  const { data: auctions, isLoading } = useQuery(
    orpc.getAuctions.queryOptions({
      input: { page: 1, limit: 20 },
    })
  );

  // Mutation para cerrar subasta
  const closeAuctionMutation = useMutation(
    orpc.closeAuction.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: orpc.getAuctions.queryKey({
            input: { page: 1, limit: 20 },
          }),
        });
        setIsDetailsOpen(false);
        setFinalPrice(null);
      },
    })
  );

  // Mutation para cancelar subasta
  const cancelAuctionMutation = useMutation(
    orpc.cancelAuction.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: orpc.getAuctions.queryKey({
            input: { page: 1, limit: 20 },
          }),
        });
        setIsDetailsOpen(false);
      },
    })
  );

  const renderAuctionStatus = (status: string) => {
    switch (status) {
      case "pending":
        return (
          <Badge className="bg-yellow-500">
            <AlertTriangle className="w-3.5 h-3.5 mr-1" />
            Pendiente
          </Badge>
        );
      case "sold":
        return (
          <Badge className="bg-purple-500">
            <CheckCircle className="w-3.5 h-3.5 mr-1" />
            Vendido
          </Badge>
        );
      case "auction":
        return (
          <Badge className="bg-pink-500">
            <Car className="w-3.5 h-3.5 mr-1" />
            En Remate
          </Badge>
        );
      default:
        return (
          <Badge className="bg-gray-400">
            <XCircle className="w-3.5 h-3.5 mr-1" />
            {status}
          </Badge>
        );
    }
  };

  return (
    <div className="flex flex-col p-6 gap-4">
      <h1 className="text-4xl font-bold mb-4">Vehículos en Remate</h1>

      <Card>
        <CardHeader>
          <CardTitle>Listado de Remates</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vehículo</TableHead>
                  <TableHead>Placa</TableHead>
                  <TableHead>Valor Mercado</TableHead>
                  <TableHead>Precio Remate</TableHead>
                  <TableHead>Pérdida</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center">
                      Cargando...
                    </TableCell>
                  </TableRow>
                ) : auctions?.data?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center">
                      No hay vehículos en remate
                    </TableCell>
                  </TableRow>
                ) : (
                  auctions?.data?.map((auction: any) => {
                    const latestInspection = auction.inspections?.[0]; // la primera inspección o usa .at(-1) si quieres la última
                    return (
                      <TableRow key={auction.auctionId}>
                        <TableCell>
                          {auction.vehicle.model} ({auction.vehicle.year})
                        </TableCell>
                        <TableCell>{auction.vehicle.licensePlate}</TableCell>
                        <TableCell>
                          {latestInspection ? (
                            <>Q{Number(latestInspection.marketValue).toLocaleString("es-GT")}</>
                          ) : (
                            <span className="text-gray-400">N/A</span>
                          )}
                        </TableCell>
                        <TableCell>
                          Q{Number(auction.auctionPrice).toLocaleString("es-GT")}
                        </TableCell>
                        <TableCell className="text-red-600 font-medium">
                          Q{Number(auction.lossValue).toLocaleString("es-GT")}
                        </TableCell>
                        <TableCell>
                          {renderAuctionStatus(auction.auctionStatus)}
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
                                  setSelectedAuction(auction);
                                  setIsDetailsOpen(true);
                                }}
                              >
                                <Eye className="mr-2 h-4 w-4" />
                                Ver detalles
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setPhotosVehicle(auction);
                                  setIsPhotosOpen(true);
                                }}
                              >
                                <Camera className="mr-2 h-4 w-4" />
                                Ver fotografías / inspecciones
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

      {/* Modal de detalles */}
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Detalles del Remate</DialogTitle>
            <DialogDescription>
              Información completa del vehículo y opciones de gestión
            </DialogDescription>
          </DialogHeader>

          {selectedAuction && (
            <div className="space-y-6">
              <div className="bg-muted/40 p-3 rounded-md">
                <h3 className="text-lg font-semibold mb-2">
                  {selectedAuction.vehicle.model} ({selectedAuction.vehicle.year}) -{" "}
                  {selectedAuction.vehicle.licensePlate}
                </h3>
                <p>
                  <strong>Descripción:</strong> {selectedAuction.description}
                </p>
                <p>
                  <strong>Estado actual:</strong>{" "}
                  {renderAuctionStatus(selectedAuction.auctionStatus)}
                </p>
              </div>

              <div className="p-3 border rounded-md">
                {selectedAuction.auctionStatus === "sold" ? (
                  <p className="font-medium text-green-600">
                    <strong>Precio Final de Venta:</strong> Q
                    {Number(selectedAuction.auctionPrice).toLocaleString("es-GT")}
                  </p>
                ) : (
                  <>
                    <label className="block font-medium mb-1">
                      Precio Final de Venta
                    </label>
                    <Input
                      type="number"
                      placeholder="Ingrese el precio final"
                      value={finalPrice ?? ""}
                      onChange={(e) => setFinalPrice(Number(e.target.value))}
                    />
                  </>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDetailsOpen(false)}>
              Cerrar
            </Button>
            {selectedAuction && selectedAuction.auctionStatus !== "sold" && (
              <>
                <Button
                  variant="default"
                  disabled={!finalPrice}
                  onClick={() =>
                    closeAuctionMutation.mutate({
                      vehicleId: selectedAuction.vehicle.id,
                      auctionPrice: finalPrice!.toString(),
                    })
                  }
                >
                  Confirmar Venta
                </Button>
                <Button
                  variant="destructive"
                  onClick={() =>
                    cancelAuctionMutation.mutate({
                      vehicleId: selectedAuction.vehicle.id,
                    })
                  }
                >
                  Cancelar Remate
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal con pestañas */}
<Dialog open={isPhotosOpen} onOpenChange={setIsPhotosOpen}>
  <DialogContent className="min-w-[90vw] max-w-7xl max-h-[90vh] overflow-y-auto">
    <DialogHeader>
      <DialogTitle>
        Fotografías e Inspecciones de {photosVehicle?.vehicle?.make}{" "}
        {photosVehicle?.vehicle?.model} {photosVehicle?.vehicle?.year}
      </DialogTitle>
      <DialogDescription>
        Navega entre la galería de fotos y el historial de inspecciones
      </DialogDescription>
    </DialogHeader>

    <Tabs defaultValue="photos" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="photos">Fotografías</TabsTrigger>
        <TabsTrigger value="inspections">Inspecciones</TabsTrigger>
      </TabsList>

      {/* Tab Fotografías */}
      <TabsContent value="photos" className="space-y-4 mt-4">
        {photosVehicle?.photos?.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {photosVehicle.photos.map((photo: any, index: number) => (
              <Card key={photo.id || index}>
                <CardContent className="p-2">
                  <div className="w-full h-[220px] bg-gray-100 rounded-md overflow-hidden flex items-center justify-center">
                    <img
                      src={photo.url || "/placeholder.svg"}
                      alt={photo.title || `Foto ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <p className="text-sm font-medium mt-2 text-center">
                    {photo.title}
                  </p>
                  <p className="text-xs text-muted-foreground text-center">
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

      {/* Tab Inspecciones */}
      <TabsContent value="inspections" className="space-y-4 mt-4">
        {photosVehicle?.inspections?.length > 0 ? (
          <div className="space-y-4">
            {photosVehicle.inspections.map((inspection: any, index: number) => (
              <Card key={inspection.id || index}>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-base">
                      Inspección #{index + 1}
                    </CardTitle>
                    {renderInspectionStatusBadge(inspection.status)}
                  </div>
                  <DialogDescription>
                    Realizada por {inspection.technicianName || "N/A"} el{" "}
                    {inspection.date
                      ? new Date(inspection.date).toLocaleDateString("es-GT")
                      : "N/A"}
                  </DialogDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <p>
                      <strong>Valor mercado:</strong> Q
                      {Number(inspection.marketValue).toLocaleString("es-GT")}
                    </p>
                    <p>
                      <strong>Valor comercial:</strong> Q
                      {Number(
                        inspection.suggestedCommercialValue
                      ).toLocaleString("es-GT")}
                    </p>
                    <p>
                      <strong>Valor bancario:</strong> Q
                      {Number(inspection.bankValue).toLocaleString("es-GT")}
                    </p>
                    <p>
                      <strong>Calificación:</strong> {inspection.rating}
                    </p>
                    <p>
                      <strong>Resultado:</strong> {inspection.result}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="text-center py-8">
              <p className="text-muted-foreground">
                No hay inspecciones registradas
              </p>
            </CardContent>
          </Card>
        )}
      </TabsContent>
    </Tabs>

    <DialogFooter>
      <Button variant="outline" onClick={() => setIsPhotosOpen(false)}>
        Cerrar
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>



    </div>
  );
}
