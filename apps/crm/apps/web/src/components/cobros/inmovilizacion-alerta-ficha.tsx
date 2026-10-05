import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	leTocaAlUsuario,
	rechazadaReciente,
	siguientePaso,
} from "@/lib/inmovilizacion-siguiente-paso";
import { orpc } from "@/utils/orpc";

/**
 * Aviso en el "Resumen" de la Ficha 360 cuando hay un apagado o reactivación
 * que espera algo del usuario (decidir, registrar la confirmación de LEGION,
 * llamar al cliente, corregir un rechazo). Así no hay que entrar a
 * "Vehículo / GPS" para enterarse. Comparte la consulta (y su caché) con la
 * tarjeta de inmovilización.
 */
function usePasoPendiente(casoCobroId: string, esSupervisor: boolean) {
	const { data } = useQuery({
		...orpc.getInmovilizacionesCaso.queryOptions({ input: { casoCobroId } }),
		staleTime: 30_000,
		refetchOnWindowFocus: false,
		enabled: !!casoCobroId,
	});
	if (!data) return null;
	const paso = siguientePaso({
		solicitudAbierta: data.solicitudAbierta,
		pendienteLlamar: !!data.pendienteLlamar,
		pendienteLlamarReactivacion: !!data.pendienteLlamarReactivacion,
		rechazadaReciente: rechazadaReciente(
			data.historial,
			!!data.solicitudAbierta,
		),
		esSupervisor,
	});
	// Solo lo que le toca a ESTE usuario: esperar a otro, o lo que debe hacer el
	// asesor cuando mira un supervisor, no es un aviso.
	return leTocaAlUsuario(paso, esSupervisor) ? paso : null;
}

/** Punto en la pestaña "Vehículo / GPS" cuando hay un trámite que espera al usuario. */
export function PuntoPendienteInmovilizacion({
	casoCobroId,
	esSupervisor,
}: {
	casoCobroId: string;
	esSupervisor: boolean;
}) {
	const paso = usePasoPendiente(casoCobroId, esSupervisor);
	if (!paso) return null;
	return (
		<span
			aria-label="Hay un trámite de la unidad pendiente"
			className="ml-1.5 inline-block h-2 w-2 rounded-full bg-sky-500"
			role="img"
		/>
	);
}

export function InmovilizacionAlertaFicha({
	casoCobroId,
	esSupervisor,
	onVer,
}: {
	casoCobroId: string;
	esSupervisor: boolean;
	/** Lleva a la pestaña "Apagado y reactivación de la unidad". */
	onVer: () => void;
}) {
	const paso = usePasoPendiente(casoCobroId, esSupervisor);
	if (!paso) return null;

	return (
		<div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm dark:border-sky-900 dark:bg-sky-950/30">
			<div className="flex items-start gap-2">
				<Lock className="mt-0.5 h-4 w-4 shrink-0 text-sky-700 dark:text-sky-300" />
				<div>
					<p className="font-medium">
						Unidad {paso.accion === "apagado" ? "(apagado)" : "(reactivación)"}:{" "}
						{paso.titulo}
					</p>
					<p className="text-muted-foreground">{paso.instruccion}</p>
				</div>
			</div>
			<Button onClick={onVer} size="sm" variant="outline">
				Ir al trámite
				<ArrowRight className="ml-2 h-4 w-4" />
			</Button>
		</div>
	);
}
