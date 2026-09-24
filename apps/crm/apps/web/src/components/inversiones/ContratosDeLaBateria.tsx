import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Ban,
	ExternalLink,
	FileSignature,
	FileText,
	Loader2,
	RefreshCw,
	Send,
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
 * Antes del "Listo" es la vista previa de lo que va a salir en el correo:
 * refleja los reemplazos y lo subido a mano, que los resultados del wizard no.
 *
 * Mientras falte alguna firma se puede reemplazar y anular. Un contrato
 * firmado no tiene acciones: WeeTrust no deja borrar un documento completo. Y
 * cuando están firmados todos, la batería se cierra sola.
 */
export function ContratosDeLaBateria({
	batchId,
	estadoDeLaBateria,
	onReemplazar,
	onListo,
	mandando = false,
}: {
	batchId: string;
	/** Antes del "Listo" es la vista previa; después, lo que ya salió. */
	estadoDeLaBateria: string;
	/** Abre la subida con ese tipo ya elegido, que es lo que reemplaza. */
	onReemplazar: (contractType: string) => void;
	/**
	 * Manda estos contratos al hilo de la compra y pasa la batería a "Por
	 * firmar". Vive acá porque esta lista es la vista previa: lo que se ve acá,
	 * con los reemplazos y lo subido a mano, es exactamente lo que se manda.
	 */
	onListo?: () => void;
	/** Si el correo está saliendo, para no mandarlo dos veces. */
	mandando?: boolean;
}) {
	const queryClient = useQueryClient();

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
								<AccionesDelContrato
									contrato={contrato}
									onReemplazar={onReemplazar}
									onAnulado={refrescar}
								/>
							)}
						</div>
					);
				})}
			</CardContent>

			{/* Antes del Listo esta lista es la vista previa del correo; después,
			    lo que se agrega o reemplaza sale solo al mismo hilo. */}
			{estadoDeLaBateria === "pendiente" && onListo && vigentes.length > 0 && (
				<CardContent className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
					<p className="max-w-2xl text-muted-foreground text-sm">
						¿Están bien todos? Se mandan al hilo del correo de la compra, con
						los PDF adjuntos y los enlaces de firma de cada persona, y la
						batería pasa a «Por firmar».
					</p>
					<Button
						onClick={onListo}
						disabled={mandando}
						className="bg-green-600 hover:bg-green-700"
					>
						{mandando ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<Send className="mr-2 h-4 w-4" />
						)}
						Listo
					</Button>
				</CardContent>
			)}
			{estadoDeLaBateria === "en_proceso" && (
				<CardContent className="border-t pt-3 text-muted-foreground text-sm">
					Ya se mandaron al hilo de la compra. Lo que agregues o reemplaces se
					manda solo al mismo hilo.
				</CardContent>
			)}
		</Card>
	);
}

/**
 * Lo que jurídico puede hacerle a un contrato mientras falte firmar:
 * reemplazarlo o anularlo.
 *
 * Va igual en las tarjetas de arriba —lo recién emitido, que es la vista
 * previa del correo— y en la lista de la batería, que es por donde se entra al
 * volver otro día.
 */
export function AccionesDelContrato({
	contrato,
	onReemplazar,
	onAnulado,
}: {
	contrato: {
		id: string;
		contractName: string;
		contractType: string;
		firmantes?: Array<{ status?: string | null }> | null;
	};
	/** Abre la subida con ese tipo ya elegido, que es lo que reemplaza. */
	onReemplazar: (contractType: string) => void;
	onAnulado: () => void;
}) {
	const [anulando, setAnulando] = useState(false);

	return (
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
				onClick={() => setAnulando(true)}
			>
				<Ban className="mr-1 h-3 w-3" />
				Anular
			</Button>

			{anulando && (
				<AnularContratoDialog
					contractId={contrato.id}
					contractName={contrato.contractName}
					hayFirmas={(contrato.firmantes ?? []).some(
						(f) => f.status === "signed",
					)}
					open
					onOpenChange={(abierto) => {
						if (!abierto) setAnulando(false);
					}}
					anular={(motivo: keyof typeof MOTIVOS_DE_ANULACION) =>
						client.cancelInvestorContract({
							contractId: contrato.id,
							motivo,
						})
					}
					onAnulado={() => {
						setAnulando(false);
						onAnulado();
					}}
				/>
			)}
		</>
	);
}
