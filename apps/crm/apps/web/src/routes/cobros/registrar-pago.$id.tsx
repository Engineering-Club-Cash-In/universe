import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, DollarSign } from "lucide-react";
import { RegistrarPagoForm } from "@/components/cobros/registrar-pago-form";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/cobros/registrar-pago/$id")({
	component: RegistrarPagoPage,
	// CB-128: preserva el "tipo" con que se llegó (mismo search param que
	// $id.tsx) para no perder el contexto de navegación al volver — un id de
	// tipo=contrato es el numeroSifco, no un casoCobroId, y $id.tsx decide con
	// tipo qué queries correr (ej. getRecuperacionVehiculo solo si tipo ===
	// "caso"). Forzar siempre "caso" al volver rompía esa distinción para
	// callers como cobros/reportes.tsx que enlazan con tipo=contrato.
	validateSearch: (search: Record<string, unknown>) => ({
		tipo: (search.tipo as "caso" | "contrato") || "caso",
	}),
});

/**
 * Página dedicada del registro de pago. Desde la Ficha 360 se abre en un modal
 * (mismo formulario, `RegistrarPagoForm`); esta ruta queda para los enlaces
 * directos.
 */
function RegistrarPagoPage() {
	const { id } = Route.useParams();
	const { tipo } = Route.useSearch();
	const navigate = useNavigate();
	const volver = () =>
		navigate({ to: "/cobros/$id", params: { id }, search: { tipo } });

	return (
		<div className="container mx-auto max-w-5xl space-y-6 p-6">
			<div className="flex items-center gap-2 text-muted-foreground text-sm">
				<Link to="/cobros/$id" params={{ id }} search={{ tipo }}>
					Cobros
				</Link>
				<span>/</span>
				<Link to="/cobros/$id" params={{ id }} search={{ tipo }}>
					Crédito {id}
				</Link>
				<span>/</span>
				<span className="text-foreground">Registrar pago</span>
			</div>

			<div className="flex items-center gap-3">
				<Button variant="ghost" size="icon" onClick={volver}>
					<ArrowLeft className="h-4 w-4" />
				</Button>
				<h1 className="flex items-center gap-2 font-bold text-2xl tracking-tight">
					<DollarSign className="h-6 w-6 text-primary" />
					Registrar pago
				</h1>
			</div>

			<RegistrarPagoForm creditoId={id} onVolver={volver} />
		</div>
	);
}
