import { useNavigate } from "react-router-dom";
import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNexaDashboard } from "../hooks/useNexaDashboard";

// Token de Nexa del crédito, como referencia, con acceso a la pestaña Nexa.
export function NexaTokenCredito({ numeroCreditoSifco }: { numeroCreditoSifco: string }) {
  const navigate = useNavigate();
  const { data, isLoading } = useNexaDashboard({ q: numeroCreditoSifco, page: 1, pageSize: 5 });
  const credito = data?.creditos.find((c) => c.numeroCreditoSifco === numeroCreditoSifco);

  const texto = isLoading
    ? "Cargando…"
    : !credito
      ? "Este crédito no está habilitado para Nexa"
      : credito.nexaToken ?? "Habilitado para Nexa, sin token registrado";

  return (
    <div className="col-span-full p-3 rounded-lg bg-white border shadow-sm flex items-center justify-between gap-3">
      <div>
        <span className="font-bold text-blue-700 flex items-center gap-1.5">
          <Smartphone className="h-4 w-4" /> Token Nexa:
        </span>
        <p className={credito?.nexaToken ? "text-gray-800 font-mono" : "text-gray-500 text-sm"}>{texto}</p>
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
