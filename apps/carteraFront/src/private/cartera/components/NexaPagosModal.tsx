import { useNavigate } from "react-router-dom";
import { useNexaPagosCredito } from "../hooks/useNexaDashboard";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { fmtQ } from "@/lib/moneda";
import { fmtFechaNexa } from "../services/nexaDashboard.services";

interface NexaPagosModalProps {
  credito: { creditoId: number; numeroCreditoSifco: string; cliente: string } | null;
  onClose: () => void;
}

export function NexaPagosModal({ credito, onClose }: NexaPagosModalProps) {
  const navigate = useNavigate();
  const { data, isLoading, error } = useNexaPagosCredito(credito?.creditoId ?? null);

  return (
    <Dialog open={credito !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-white text-slate-900 sm:max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pagos del crédito {credito?.numeroCreditoSifco}</DialogTitle>
          <DialogDescription>{credito?.cliente}</DialogDescription>
        </DialogHeader>

        {isLoading && <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>}
        {error && <div className="p-4 bg-red-50 border border-red-200 rounded text-red-700">{error.message}</div>}

        {data && (
          <>
            <div className="text-sm text-gray-600 mb-4">{data.pagos.length} pagos · {data.pagos.filter((p) => p.canal === "NEXA").length} por Nexa</div>

            {data.pagos.length === 0 ? (
              <div className="p-8 text-center text-gray-500">Este crédito no tiene pagos registrados</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {["Fecha", "Monto", "Canal", "Registrado por", "Estado"].map((h) => <TableHead key={h}>{h}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.pagos.map((p, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-sm">{fmtFechaNexa(p.fechaPago)}</TableCell>
                      <TableCell className="text-sm font-mono">{fmtQ(p.montoBoleta)}</TableCell>
                      <TableCell>
                        <Badge className={p.canal === "NEXA" ? "bg-green-50 text-green-700 border-green-300 border" : "bg-gray-100 text-gray-700 border-gray-300 border"}>
                          {p.canal === "NEXA" ? "Nexa" : "Manual"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{p.registradoPor ?? "--"}</TableCell>
                      <TableCell>
                        <Badge variant={p.validado ? "default" : "outline"} className={p.validado ? "" : "bg-amber-50 text-amber-700 border-amber-300"}>
                          {p.validado ? "Validado" : "Pendiente"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {data.eventosSinPago.length > 0 && (
              <div className="mt-6 space-y-2">
                <div className="text-sm font-semibold text-red-600">Intentos Nexa sin pago</div>
                {data.eventosSinPago.map((e, i) => (
                  <div key={i} className="text-sm p-2 bg-gray-50 rounded flex justify-between items-start gap-2">
                    <span>{fmtFechaNexa(e.creado)} · {e.referencia} · {fmtQ(e.monto)} · {e.estado}</span>
                    {e.error && <span className="text-red-600 font-mono text-xs whitespace-nowrap">{e.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
          <Button onClick={() => navigate(`/pagos/${credito?.numeroCreditoSifco}`)}>Ir a pagos del crédito</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
