import { useMutation, useQuery } from "@tanstack/react-query";
import {
	CheckCircle2,
	Loader2,
	RefreshCw,
	ShieldAlert,
	ShieldBan,
	ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { PERMISSIONS } from "@/lib/roles";
import { client, orpc, queryClient } from "@/utils/orpc";
import {
	CoincidenciasBuroInterno,
	SeveridadBadge,
} from "./CoincidenciasBuroInterno";

const MOTIVO_MIN = 10;

/**
 * Coincidencias de la solicitud (titular, codeudores y referencias) con el
 * buró interno. Las de severidad alta frenan la aprobación hasta que análisis
 * las autorice con un motivo.
 */
export function BuroInternoAnalisis({
	opportunityId,
	currentUserRole,
	onBloqueoChange,
}: {
	opportunityId: string;
	/** Solo admin/analyst pueden levantar el bloqueo */
	currentUserRole?: string | null;
	/** Avisa a la página si el buró interno está frenando la aprobación */
	onBloqueoChange?: (bloquea: boolean) => void;
}) {
	const [dialogoAbierto, setDialogoAbierto] = useState(false);
	const [motivo, setMotivo] = useState("");

	const evaluacion = useQuery(
		orpc.getBuroInternoOportunidad.queryOptions({ input: { opportunityId } }),
	);

	const coincidencias = evaluacion.data?.coincidencias ?? [];
	const autorizaciones = evaluacion.data?.autorizaciones ?? [];
	const bloqueantes = evaluacion.data?.bloqueantes ?? [];
	const bloquea = evaluacion.data?.bloqueaAprobacion ?? false;
	const evaluados = evaluacion.data?.evaluados;
	const peor = coincidencias[0]?.severidad;
	const puedeAutorizar = PERMISSIONS.canOverrideValidacionManual(
		currentUserRole ?? "",
	);

	useEffect(() => {
		onBloqueoChange?.(bloquea);
	}, [bloquea, onBloqueoChange]);

	const autorizar = useMutation({
		mutationFn: () =>
			client.autorizarBuroInternoOportunidad({ opportunityId, motivo }),
		onSuccess: () => {
			toast.success("Bloqueo del buró interno autorizado");
			queryClient.invalidateQueries({
				queryKey: orpc.getBuroInternoOportunidad.key(),
			});
			setDialogoAbierto(false);
			setMotivo("");
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const resumenEvaluados = evaluados
		? [
				"titular",
				evaluados.codeudor > 0 &&
					`${evaluados.codeudor} ${evaluados.codeudor === 1 ? "codeudor" : "codeudores"}`,
				evaluados.referencia > 0 &&
					`${evaluados.referencia} ${evaluados.referencia === 1 ? "referencia" : "referencias"}`,
			]
				.filter(Boolean)
				.join(", ")
		: null;

	return (
		<Card className={coincidencias.length > 0 ? "border-red-300" : undefined}>
			<CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
				<div className="space-y-1">
					<CardTitle className="flex items-center gap-2">
						{coincidencias.length > 0 ? (
							<ShieldAlert className="h-5 w-5 text-red-600" />
						) : (
							<ShieldBan className="h-5 w-5 text-muted-foreground" />
						)}
						Buró interno
						{peor && <SeveridadBadge severidad={peor} />}
					</CardTitle>
					<CardDescription>
						Personas que cobros marcó como mal pagadoras.
						{resumenEvaluados && ` Se revisó: ${resumenEvaluados}.`} Las
						coincidencias de severidad alta frenan la aprobación; las demás solo
						avisan.
					</CardDescription>
				</div>
				<Button
					variant="ghost"
					size="icon"
					title="Volver a revisar"
					disabled={evaluacion.isFetching}
					onClick={() => evaluacion.refetch()}
				>
					<RefreshCw
						className={`h-4 w-4 ${evaluacion.isFetching ? "animate-spin" : ""}`}
					/>
				</Button>
			</CardHeader>
			<CardContent className="space-y-4">
				{evaluacion.isLoading ? (
					<Skeleton className="h-16 w-full" />
				) : evaluacion.isError ? (
					<p className="text-red-700 text-sm">
						No se pudo revisar el buró interno: {evaluacion.error.message}
					</p>
				) : coincidencias.length === 0 ? (
					<p className="flex items-center gap-2 text-green-700 text-sm">
						<CheckCircle2 className="h-4 w-4" />
						Sin coincidencias.
					</p>
				) : (
					<>
						{bloquea && (
							<div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-red-300 bg-red-50 p-4">
								<div className="flex items-start gap-2 text-sm">
									<ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
									<div>
										<p className="font-medium text-red-800">
											No se puede aprobar:{" "}
											{bloqueantes.length === 1
												? "esta persona está"
												: "estas personas están"}{" "}
											en el buró interno.
										</p>
										<p className="text-red-700">
											{bloqueantes.map((b) => b.nombreCompleto).join(", ")}
										</p>
										<p className="mt-1 text-red-700 text-xs">
											Si no corresponde (un homónimo, alguien que ya pagó),
											autorizalo con una justificación. Queda en la bitácora del
											buró.
										</p>
									</div>
								</div>
								{puedeAutorizar && (
									<Button
										variant="outline"
										onClick={() => setDialogoAbierto(true)}
									>
										<ShieldCheck className="mr-2 h-4 w-4" />
										Autorizar y continuar
									</Button>
								)}
							</div>
						)}

						{!bloquea && autorizaciones.length > 0 && (
							<p className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-green-800 text-sm">
								<ShieldCheck className="h-4 w-4 shrink-0" />
								El bloqueo del buró interno fue autorizado para esta
								oportunidad.
							</p>
						)}

						<CoincidenciasBuroInterno
							coincidencias={coincidencias}
							autorizaciones={autorizaciones}
							marcarBloqueo
						/>
					</>
				)}
			</CardContent>

			<Dialog open={dialogoAbierto} onOpenChange={setDialogoAbierto}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Aprobar pese al buró interno</DialogTitle>
						<DialogDescription>
							{bloqueantes.map((b) => b.nombreCompleto).join(", ")} dejan de
							frenar esta oportunidad. La persona sigue en el buró interno para
							las demás.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-2">
						<Label htmlFor="motivo-buro-interno">
							¿Por qué se aprueba igual? *
						</Label>
						<Textarea
							id="motivo-buro-interno"
							rows={3}
							placeholder="Ej.: es homónimo, el DPI y el teléfono son distintos; verificado con el cliente"
							value={motivo}
							onChange={(e) => setMotivo(e.target.value)}
						/>
						<p className="text-muted-foreground text-xs">
							Mínimo {MOTIVO_MIN} caracteres. Queda registrado con tu nombre y
							la fecha.
						</p>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setDialogoAbierto(false)}>
							Cancelar
						</Button>
						<Button
							disabled={
								motivo.trim().length < MOTIVO_MIN || autorizar.isPending
							}
							onClick={() => autorizar.mutate()}
						>
							{autorizar.isPending && (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							)}
							Autorizar
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Card>
	);
}
