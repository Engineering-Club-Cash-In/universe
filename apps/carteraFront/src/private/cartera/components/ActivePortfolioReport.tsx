import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Download, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { descargarReporteCarteraActiva } from "../services/activePortfolioReport.services";

function errMsg(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message || fallback;
  return fallback;
}

export function ActivePortfolioReport() {
  const [loading, setLoading] = useState(false);

  const descargar = async () => {
    try {
      setLoading(true);
      const blob = await descargarReporteCarteraActiva();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "reporte-cartera-activa.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Reporte descargado");
    } catch (e: unknown) {
      toast.error(errMsg(e, "Error descargando reporte"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-x-0 top-16 xl:top-20 bottom-0 overflow-auto bg-gradient-to-br from-blue-50 to-white px-4 sm:px-6 lg:px-8 pt-8 pb-8">
      <div className="w-full max-w-3xl mx-auto">
        <div className="flex flex-col items-center mb-6">
          <h1 className="text-3xl font-extrabold text-blue-700 text-center">Reporte cartera activa</h1>
          <p className="text-gray-600 mt-2 text-center">
            Descarga la cartera activa actual con placa, chasis, cuota interna, cliente y número de crédito.
          </p>
        </div>

        <Card className="border-blue-100 shadow-lg bg-white/90">
          <CardContent className="p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-blue-100 p-3 text-blue-700">
                <FileSpreadsheet className="h-6 w-6" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900">Cartera activa a la fecha</h2>
                <p className="text-sm text-gray-600 mt-1">Incluye créditos ACTIVO, MOROSO y EN_CONVENIO.</p>
              </div>
            </div>
            <Button onClick={descargar} disabled={loading} className="gap-2">
              <Download className="h-4 w-4" />
              {loading ? "Generando..." : "Descargar Excel"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
