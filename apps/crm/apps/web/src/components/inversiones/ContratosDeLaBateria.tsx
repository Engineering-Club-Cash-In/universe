import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Ban,
	Check,
	ExternalLink,
	FileSignature,
	FileText,
	Loader2,
	RefreshCw,
} from "lucide-react";
import { useState } from "react";
import type { MOTIVOS_DE_ANULACION } from "server/src/lib/contratos-anulacion";
import { AnularContratoDialog } from "@/components/contracts/AnularContratoDialog";
import { EtiquetaSubidoAMano } from "@/components/contracts/SubidoAMano";
import { EtiquetaIdentidadOmitida } from "@/components/contracts/VerificacionFacialFallida";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	ETIQUETA_IDENTIDAD_FALLIDA,
	ETIQUETA_SIN_CERRAR,
	estaAnulado,
	firmadoSinCerrar,
	identidadesFallidas,
} from "@/lib/contract-signers-display";
import { client, orpc } from "@/utils/orpc";

/** Lo que contesta WeeTrust de un documento, tal como lo relaya el CRM. */
type EstadoEnWeeTrust = Awaited<
	ReturnType<typeof client.getInvestorContractSigningStatus>
>;

const ESTADO: Record<string, { label: string; className: string }> = {
	pending: {
		label: "En firma",
		className: "border-blue-200 text-blue-700 dark:text-blue-400",
	},
	signed: {
		label: "Firmado",
		className: "border-green-200 text-green-700 dark:text-green-400",
	},
	cancelled: {
		label: "Anulado",
		className: "border-muted text-muted-foreground",
	},
};

/**
 * Los contratos que la batería ya tiene, con lo que jurídico todavía puede
 * hacerles.
 *
 * Es lo que hace falta al volver a una batería de otro día: los resultados del
 * wizard son de la sesión en la que se emitieron, y sin esto un contrato con un
 * error emitido ayer no tenía desde dónde corregirse.
 *
 * Mientras falte alguna firma se puede reemplazar y anular. Firmado por todos
 * no aparece ninguna acción: WeeTrust no deja borrar un documento completo, y
 * la batería ya salió de la lista de jurídico.
 */
export function ContratosDeLaBateria({
	batchId,
	onReemplazar,
	onListo,
	avisando = false,
}: {
	batchId: string;
	/** Abre la subida con ese tipo ya elegido, que es lo que reemplaza. */
	onReemplazar: (contractType: string) => void;
	/**
	 * Cierra la batería y le avisa a inversiones.
	 *
	 * Vive acá y no sólo en los resultados del wizard porque hay baterías que se
	 * arman entera con contratos subidos a mano —ahí no hay pantalla de
	 * resultados— y porque un contrato que falló se puede resolver subiéndolo,
	 * y entonces el "Listo" de allá ya no sirve.
	 */
	onListo?: () => void;
	/** Si el aviso está en curso, para no mandarlo dos veces. */
	avisando?: boolean;
}) {
	const queryClient = useQueryClient();
	const [anulando, setAnulando] = useState<{
		id: string;
		nombre: string;
		hayFirmas: boolean;
	} | null>(null);

	const contratosQuery = useQuery(
		orpc.listInvestorContracts.queryOptions({ input: { batchId } }),
	);

	const refrescar = () =>
		queryClient.invalidateQueries({
			predicate: (query) =>
				JSON.stringify(query.queryKey).includes("InvestorContract"),
		});

	const contratos = contratosQuery.data ?? [];
	const vigentes = contratos.filter((c) => !estaAnulado(c));
	const anulados = contratos.filter((c) => estaAnulado(c));

	// Los que tienen todas las firmas y WeeTrust igual no cerró. Se les pregunta
	// solo: o acaban de cerrar —y la batería sale de la lista de jurídico— o no
	// van a cerrar, y entonces hay que decir por qué. Se apaga en los dos casos.
	const sinCerrar = vigentes.filter((c) =>
		firmadoSinCerrar(c.status, c.firmantes),
	);
	const cierreQuery = useQuery({
		queryKey: ["cierre-de-bateria", sinCerrar.map((c) => c.id).join(",")],
		queryFn: async () => {
			const porContrato: Record<string, EstadoEnWeeTrust> = {};
			let alguno = false;
			for (const contrato of sinCerrar) {
				const enWeeTrust = await client.getInvestorContractSigningStatus({
					contractId: contrato.id,
				});
				porContrato[contrato.id] = enWeeTrust;
				if (enWeeTrust.status === "COMPLETED") alguno = true;
			}
			if (alguno) refrescar();
			return porContrato;
		},
		enabled: sinCerrar.length > 0,
		refetchInterval: (query) => {
			const datos = Object.values(query.state.data ?? {});
			if (datos.length === 0) return 20_000;
			// Cerrado, o con la identidad fallida, ya no cambia solo.
			const resueltos = datos.every(
				(d) =>
					d.status === "COMPLETED" ||
					identidadesFallidas(d.signatories).length > 0,
			);
			return resueltos ? false : 20_000;
		},
		// Sólo con la pantalla a la vista: cada consulta llega hasta WeeTrust.
		refetchIntervalInBackground: false,
		retry: false,
	});

	if (contratosQuery.isLoading) {
		return (
			<Card>
				<CardContent className="flex items-center gap-2 p-6 text-muted-foreground text-sm">
					<Loader2 className="h-4 w-4 animate-spin" />
					Cargando los contratos de la batería...
				</CardContent>
			</Card>
		);
	}

	if (contratos.length === 0) return null;

	return (
		<Card>
			<CardHeader className="pb-3">
				<CardTitle className="flex items-center gap-2 text-base">
					<FileSignature className="h-4 w-4" />
					Contratos de esta batería
				</CardTitle>
				<CardDescription>
					Mientras falte firmar se pueden corregir. Los enlaces de cada firmante
					están en la ficha del inversionista.
				</CardDescription>
			</CardHeader>

			<CardContent className="space-y-2">
				{[...vigentes, ...anulados].map((contrato) => {
					const inactivo = estaAnulado(contrato);
					const abierto = firmadoSinCerrar(contrato.status, contrato.firmantes);
					// Sólo el badge: qué hacer con la identidad lo resuelve inversiones
					// desde la ficha; jurídico reemplaza o anula. Y sólo mientras el
					// documento siga sin cerrar: lo que contestó WeeTrust se queda en
					// caché, y el badge seguía en rojo en un contrato ya firmado.
					const fallaronIdentidad = abierto
						? identidadesFallidas(cierreQuery.data?.[contrato.id]?.signatories)
						: [];
					const estado = !abierto
						? (ESTADO[contrato.status] ?? ESTADO.pending)
						: fallaronIdentidad.length > 0
							? ETIQUETA_IDENTIDAD_FALLIDA
							: ETIQUETA_SIN_CERRAR;
					const firmado = contrato.status === "signed";

					return (
						<div
							key={contrato.id}
							className={`flex flex-wrap items-center gap-2 rounded-md border p-3 ${
								inactivo ? "opacity-60" : ""
							}`}
						>
							<div className="min-w-0 flex-1">
								<p className="truncate font-medium text-sm">
									{contrato.contractName}
								</p>
								{inactivo && contrato.cancellationReason && (
									<p className="truncate text-muted-foreground text-xs">
										{contrato.cancellationReason}
									</p>
								)}
							</div>

							<EtiquetaSubidoAMano apiResponse={contrato.apiResponse} />
							<EtiquetaIdentidadOmitida apiResponse={contrato.apiResponse} />
							<Badge
								variant="outline"
								className={`${estado.className} text-xs`}
								title={"title" in estado ? estado.title : undefined}
							>
								{estado.label}
							</Badge>

							{contrato.pdfUrl && (
								<Button variant="outline" size="sm" asChild className="h-7">
									<a
										href={contrato.pdfUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="flex items-center gap-1"
									>
										<FileText className="h-3 w-3" />
										PDF
										<ExternalLink className="h-3 w-3" />
									</a>
								</Button>
							)}

							{/* Un documento firmado por todos ya no se toca: allá no se puede
							    borrar y acá no habría qué corregir. */}
							{!inactivo && !firmado && (
								<>
									<Button
										variant="ghost"
										size="sm"
										className="h-7 text-xs"
										onClick={() => onReemplazar(contrato.contractType)}
									>
										<RefreshCw className="mr-1 h-3 w-3" />
										Reemplazar
									</Button>
									<Button
										variant="ghost"
										size="sm"
										className="h-7 text-destructive text-xs hover:text-destructive"
										onClick={() =>
											setAnulando({
												id: contrato.id,
												nombre: contrato.contractName,
												hayFirmas: (contrato.firmantes ?? []).some(
													(f) => f.status === "signed",
												),
											})
										}
									>
										<Ban className="mr-1 h-3 w-3" />
										Anular
									</Button>
								</>
							)}
						</div>
					);
				})}
			</CardContent>

			{/* Lo que cierra el trabajo de jurídico. Sale de acá, que es lo que de
			    verdad tiene la batería, y no de lo que haya pasado en la sesión del
			    wizard. */}
			{onListo && vigentes.length > 0 && (
				<CardContent className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
					<p className="text-muted-foreground text-sm">
						¿Ya está toda la papelería? Se cierra la batería y se le avisa a
						inversiones.
					</p>
					<Button
						onClick={onListo}
						disabled={avisando}
						className="bg-green-600 hover:bg-green-700"
					>
						{avisando ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<Check className="mr-2 h-4 w-4" />
						)}
						Listo
					</Button>
				</CardContent>
			)}

			{anulando && (
				<AnularContratoDialog
					contractId={anulando.id}
					contractName={anulando.nombre}
					hayFirmas={anulando.hayFirmas}
					open
					onOpenChange={(abierto) => {
						if (!abierto) setAnulando(null);
					}}
					anular={(motivo: keyof typeof MOTIVOS_DE_ANULACION) =>
						client.cancelInvestorContract({
							contractId: anulando.id,
							motivo,
						})
					}
					onAnulado={() => {
						setAnulando(null);
						refrescar();
					}}
				/>
			)}
		</Card>
	);
}
