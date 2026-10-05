import { useQuery } from "@tanstack/react-query";
import { differenceInCalendarDays } from "date-fns";
import { Lock, LockOpen, PhoneCall, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { orpcAparte } from "@/utils/orpc";

const TIPO_TEXTO = {
	por_ejecutar: {
		titulo: "Registrar la confirmación de LEGION",
		detalle: (accion: string) =>
			`Solicitud de ${accion === "apagado" ? "apagado" : "reactivación"} aprobada: pida a LEGION que la aplique y registre su confirmación.`,
		boton: "Registrar confirmación",
		Icono: Lock,
	},
	llamar_cliente: {
		titulo: "Llamar al cliente",
		detalle: (accion: string) =>
			accion === "apagado"
				? "Se ejecutó el apagado: llame al cliente y registre la llamada."
				: "Se ejecutó la reactivación: llame al cliente y registre la llamada.",
		boton: "Registrar llamada",
		Icono: PhoneCall,
	},
	rechazada: {
		titulo: "Solicitud rechazada",
		detalle: (accion: string) =>
			`El supervisor rechazó ${accion === "apagado" ? "el apagado" : "la reactivación"}: revise el motivo y vuelva a solicitar.`,
		boton: "Ver motivo",
		Icono: RotateCcw,
	},
} as const;

function antiguedad(desde: Date | string | null): string | null {
	if (!desde) return null;
	const dias = differenceInCalendarDays(new Date(), new Date(desde));
	if (dias <= 0) return "Hoy";
	return `Hace ${dias} día${dias === 1 ? "" : "s"}`;
}

/**
 * Mi día: trámites de apagado/reactivación que esperan al asesor (confirmar a
 * LEGION, llamar al cliente o corregir un rechazo). Sin pendientes no se muestra.
 */
export function MisPendientesInmovilizacion({
	onVerCaso,
}: {
	/** Abre la Ficha 360 del crédito en la sección de apagado/reactivación. */
	onVerCaso: (sifco: string) => void;
}) {
	const { data } = useQuery({
		...orpcAparte.getMisPendientesInmovilizacion.queryOptions(),
		refetchInterval: 60_000,
	});
	const pendientes = data?.pendientes ?? [];
	if (pendientes.length === 0) return null;

	return (
		<Card className="border-sky-200 bg-sky-50/40 dark:border-sky-900/40 dark:bg-sky-950/20">
			<CardContent className="p-4">
				<div className="mb-3 flex items-center gap-2">
					<LockOpen className="h-4 w-4 text-sky-600 dark:text-sky-400" />
					<span className="font-semibold text-sm">
						Apagado y reactivación: pendientes
					</span>
					<Badge variant="secondary">{pendientes.length}</Badge>
				</div>
				<div className="space-y-2">
					{pendientes.map((p) => {
						const t = TIPO_TEXTO[p.tipo];
						const cuanto = antiguedad(p.desde);
						return (
							<div
								className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background p-3"
								key={`${p.inmovilizacionId}:${p.tipo}`}
							>
								<div className="flex min-w-0 flex-1 items-start gap-2">
									<t.Icono className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
									<div className="min-w-0">
										<p className="font-medium text-sm">
											{t.titulo}
											{p.numeroCreditoSifco && (
												<span className="ml-2 font-normal text-muted-foreground text-xs">
													Crédito {p.numeroCreditoSifco}
												</span>
											)}
										</p>
										<p className="text-muted-foreground text-xs">
											{t.detalle(p.accion)}
										</p>
									</div>
								</div>
								<div className="flex shrink-0 items-center gap-2">
									{cuanto && (
										<span className="text-muted-foreground text-xs">
											{cuanto}
										</span>
									)}
									{p.numeroCreditoSifco && (
										<Button
											className="h-7 text-xs"
											onClick={() => onVerCaso(p.numeroCreditoSifco as string)}
											size="sm"
											variant="outline"
										>
											{t.boton}
										</Button>
									)}
								</div>
							</div>
						);
					})}
				</div>
			</CardContent>
		</Card>
	);
}
