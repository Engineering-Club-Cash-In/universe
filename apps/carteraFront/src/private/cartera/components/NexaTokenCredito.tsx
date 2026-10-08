import { useNavigate } from "react-router-dom";
import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNexaDashboard } from "../hooks/useNexaDashboard";
import { textoTokenNexa } from "@/lib/textoTokenNexa";

// Token de Nexa del crédito, como referencia, con acceso a la pestaña Nexa.
export function NexaTokenCredito({ numeroCreditoSifco }: { numeroCreditoSifco: string }) {
  const navigate = useNavigate();
  const { data, isLoading, error } = useNexaDashboard({ q: numeroCreditoSifco, page: 1, pageSize: 100, desde: "", hasta: "", medio: "", cuotaMes: "" });
  const credito = data?.creditos.find((c) => c.numeroCreditoSifco === numeroCreditoSifco);

  const { texto, tono } = textoTokenNexa({ isLoading, error, credito });

  return (
    <div className="col-span-full p-3 rounded-lg bg-white border shadow-sm flex items-center justify-between gap-3">
      <div>
        <span className="font-bold text-blue-700 flex items-center gap-1.5">
          <Smartphone className="h-4 w-4" /> Token Nexa:
        </span>
        <p className={tono === "error" ? "text-red-600 text-sm" : tono === "token" ? "text-gray-800 font-mono" : "text-gray-500 text-sm"}>{texto}</p>
      </div>
      {credito && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(`/nexa?q=${encodeURIComponent(numeroCreditoSifco)}`)}
        >
          Ver en Nexa
        </Button>
      )}
    </div>
  );
}
