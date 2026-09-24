import { useMutation, useQuery } from "@tanstack/react-query";
import {
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Clock,
	Copy,
	ExternalLink,
	Eye,
	FileSignature,
	FileText,
	Loader2,
	RefreshCw,
	Trash2,
	TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { esFirmaFisica } from "server/src/lib/contract-signature-mode";
import { ETAPA_EN_FIRMA } from "server/src/lib/contratos-anulacion";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
	ETIQUETA_IDENTIDAD_FALLIDA,
	ETIQUETA_SIN_CERRAR,
	estaAnulado,
	type FirmanteDeContrato,
	firmadoSinCerrar,
	firmantesEnFicha,
	identidadesFallidas,
} from "@/lib/contract-signers-display";
import { getContractTypeLabel } from "@/lib/crm-formatters";
import { client } from "@/utils/orpc";
import { AnularContratoDialog } from "./AnularContratoDialog";
import { CartasDelPaquete } from "./CartasDelPaquete";
import { DescargarFirmadoButton } from "./DescargarFirmadoButton";
import { ReenviarWhatsappDialog } from "./ReenviarWhatsappDialog";
import { RegenerarEnlacesDialog } from "./RegenerarEnlacesDialog";
import { EtiquetaSubidoAMano, RevisarSubidoAMano } from "./SubidoAMano";
import {
	EtiquetaIdentidadOmitida,
	VerificacionFacialFallida,
} from "./VerificacionFacialFallida";

/**
 * La card de "Contratos Legales" que aparece en el detalle de una oportunidad.
 *
 * Vive acá porque se muestra en dos lados (el modal de detalle de CRM y el de
 * oportunidades) y estaba duplicada: cada copia se fue quedando con una versión
 * distinta de los enlaces de firma.
 */

interface ContratoDeOportunidad {
	id: string;
	contractName: string;
	contractType: string;
	status: "pending" | "signed" | "cancelled";
	pdfLink?: string | null;
	opportunityId?: string | null;
	clientSigningLink: string | null;
	representativeSigningLink: string | null;
	additionalSigningLinks: string[] | null;
	/** Cuándo se consultó por última vez a WeeTrust cómo va la firma. */
	signingStatusCheckedAt?: Date | string | null;
	/** Enlace de observador: ver el documento y su avance sin poder firmar. */
	observerUrl?: string | null;
	/** `documenso` cuando WeeTrust falló y se usó el fallback. */
	signingProvider?: string | null;
	/** Cómo se firma, según quedó guardado al generarlo. */
	signatureMode?: string | null;
	/**
	 * La respuesta del generador tal como se guardó. De ahí sale qué cartas trae
	 * un paquete de cartas.
	 */
	apiResponse?: unknown;
	/**
	 * El contrato que lo reemplaza. Puede estar puesto con el estado todavía en
	 * `pending`: el reemplazo lo reclama al confirmar y el anulado en WeeTrust
	 * viene después.
	 */
	replacedByContractId?: string | null;
}

/** Un contrato para el reenvío por WhatsApp: el id y cómo se llama. */
type ContratoAReenviar = { id: string; nombre: string };

export interface FilaDeContrato {
	contract: ContratoDeOportunidad;
	signatories?: FirmanteDeContrato[];
}

interface OpportunityContractsCardProps {
	contracts: FilaDeContrato[] | undefined;
	isLoading?: boolean;
	/**
	 * Si quien mira puede regenerar enlaces. Es de análisis: ventas y
	 * contabilidad ven la card pero no ese botón.
	 */
	puedeRegenerar?: boolean;
	/**
	 * Si quien mira puede anular un contrato. Va aparte de `puedeRegenerar`:
	 * anular lo descarta sin reemplazarlo, y lo pueden hacer tanto análisis como
	 * jurídico, mientras que regenerar es sólo de análisis.
	 */
	puedeAnular?: boolean;
	/** Se llama cuando cambia el estado, para refrescar la lista. */
	onUpdate?: () => void;
}

const ESTADO = {
	pending: {
		label: "Pendiente",
		className:
			"border-yellow-500/50 bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
	},
	signed: {
		label: "Firmado",
		className:
			"border-green-500/50 bg-green-500/15 text-green-700 dark:text-green-400",
	},
	cancelled: {
		label: "Cancelado",
		className: "border-red-500/50 bg-red-500/15 text-red-700 dark:text-red-400",
	},
} as const;

export function OpportunityContractsCard({
	contracts,
	isLoading = false,
	puedeRegenerar = false,
	puedeAnular = false,
	onUpdate,
}: OpportunityContractsCardProps) {
	// Los anulados se conservan (dicen qué se descartó y si alguien lo había
	// firmado), pero van aparte: cada reemplazo deja uno y taparían los vigentes.
	const [verAnulados, setVerAnulados] = useState(false);
	// Con qué oportunidad se abre la pregunta de reenviar por WhatsApp.
	//
	// Vive acá y no en la fila que la dispara: regenerar crea un contrato NUEVO
	// y manda el viejo a "Ver anulados", que viene colapsado. Como cada fila se
	// monta con su propio `id`, la que abrió el diálogo desaparecía de la lista
	// un instante después y se llevaba el diálogo puesto: alcanzaba a verse un
	// segundo y se cerraba solo, como si la página se hubiera recargado.
	const [reenviarDeOportunidad, setReenviarDeOportunidad] = useState<
		string | null
	>(null);
	// Y qué contratos: sólo el que se acaba de renovar, no la batería entera.
	const [contratosAReenviar, setContratosAReenviar] = useState<
		ContratoAReenviar[] | undefined
	>(undefined);
	const preguntarReenvio = (
		opportunityId: string | null,
		contratos?: ContratoAReenviar[],
	) => {
		setContratosAReenviar(contratos);
		setReenviarDeOportunidad(opportunityId);
	};
	const vigentes = contracts?.filter((f) => !estaAnulado(f.contract)) ?? [];
	const anulados = contracts?.filter((f) => estaAnulado(f.contract)) ?? [];

	const fila = (f: FilaDeContrato) => (
		<ContratoFila
			key={f.contract.id}
			fila={f}
			puedeRegenerar={puedeRegenerar}
			puedeAnular={puedeAnular}
			onUpdate={onUpdate}
			onPreguntarReenvio={preguntarReenvio}
		/>
	);

	return (
		<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
			<div className="flex items-center gap-2">
				<FileSignature className="h-5 w-5 text-muted-foreground" />
				<Label className="font-semibold text-muted-foreground text-sm">
					Contratos Legales
				</Label>
				{vigentes.length > 0 && (
					<span className="text-muted-foreground text-xs">
						{vigentes.length}
					</span>
				)}
			</div>

			{isLoading ? (
				<p className="text-muted-foreground text-sm">Cargando contratos...</p>
			) : !contracts || contracts.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No hay contratos asociados a esta oportunidad
				</p>
			) : (
				<>
					{vigentes.length > 0 ? (
						<div className="space-y-2">{vigentes.map(fila)}</div>
					) : (
						<p className="text-muted-foreground text-sm">
							No hay contratos vigentes en esta oportunidad
						</p>
					)}

					{anulados.length > 0 && (
						<div className="space-y-2">
							<Button
								variant="ghost"
								size="sm"
								className="h-6 px-1.5 text-muted-foreground text-xs hover:text-foreground"
								onClick={() => setVerAnulados((v) => !v)}
							>
								{verAnulados ? (
									<ChevronDown className="mr-1 h-3 w-3" />
								) : (
									<ChevronRight className="mr-1 h-3 w-3" />
								)}
								{verAnulados
									? "Ocultar anulados"
									: `Ver anulados (${anulados.length})`}
							</Button>
							{verAnulados && (
								<div className="space-y-2 opacity-75">{anulados.map(fila)}</div>
							)}
						</div>
					)}
				</>
			)}

			<ReenviarWhatsappDialog
				opportunityId={reenviarDeOportunidad}
				contratos={contratosAReenviar}
				open={reenviarDeOportunidad !== null}
				onOpenChange={(abierto) => {
					if (!abierto) setReenviarDeOportunidad(null);
				}}
			/>
		</div>
	);
}

/**
 * Un contrato de la lista, con el estado de cada firmante y las acciones.
 *
 * Es un componente aparte porque cada contrato tiene sus propias consultas en
 * vuelo: refrescar el estado de uno no tiene por qué poner a girar los botones
 * de los demás.
 */
function ContratoFila({
	fila,
	puedeRegenerar: tienePermiso,
	puedeAnular,
	onUpdate,
	onPreguntarReenvio,
}: {
	fila: FilaDeContrato;
	puedeRegenerar: boolean;
	puedeAnular: boolean;
	onUpdate?: () => void;
	/**
	 * Avisa que hay que preguntar si se reenvían los enlaces. Lo resuelve la
	 * card, no la fila: después de regenerar, esta fila deja de existir.
	 */
	onPreguntarReenvio: (
		opportunityId: string | null,
		contratos?: ContratoAReenviar[],
	) => void;
}) {
	const { contract, signatories } = fila;
	// Manda lo guardado: una declaración de vendedor generada antes de que se
	// firmara en papel ya tiene sus links, y hay que seguir mostrándolos.
	const firmaEnPapel = contract.signatureMode
		? contract.signatureMode === "fisica"
		: esFirmaFisica(contract.contractType);
	const reemplazado = !!contract.replacedByContractId;
	const inactivo = estaAnulado(contract);
	// Uno en papel no está "pendiente" de nadie en WeeTrust: se imprime y se
	// firma a mano. Anulado sí se muestra como anulado.
	// Firmado por todos y sin cerrar allá: WeeTrust no cierra el documento hasta
	// que la verificación facial salga válida. "Pendiente" ahí parece que falta
	// que alguien firme, y no falta nadie.
	const sinCerrar =
		!reemplazado &&
		!firmaEnPapel &&
		contract.signingProvider !== "documenso" &&
		firmadoSinCerrar(contract.status, signatories);

	// Con todo firmado y el contrato en pendiente, la ficha le pregunta sola a
	// WeeTrust: o el documento acaba de cerrar —y hay que refrescar— o no va a
	// cerrar nunca porque no le creyó la identidad a alguien, y hay que decir
	// quién. Se apaga en los dos casos.
	const cierreQuery = useQuery({
		queryKey: ["cierre-de-contrato-de-venta", contract.id],
		queryFn: async () => {
			const respuesta = await client.getContractSigningStatus({
				contractId: contract.id,
			});
			if (respuesta.status === "COMPLETED") onUpdate?.();
			return respuesta;
		},
		enabled: sinCerrar,
		refetchInterval: (query) => {
			const datos = query.state.data;
			if (!datos) return 20_000;
			if (datos.status === "COMPLETED") return false;
			return identidadesFallidas(datos.signatories).length > 0 ? false : 20_000;
		},
		// Sólo con la ficha a la vista: cada consulta llega hasta WeeTrust.
		refetchIntervalInBackground: false,
		retry: false,
	});
	// Sólo mientras siga sin cerrar: la respuesta se queda en caché después.
	const fallaronIdentidad = sinCerrar
		? identidadesFallidas(cierreQuery.data?.signatories)
		: [];

	const estado =
		reemplazado && contract.status === "pending"
			? { label: "Reemplazado", className: ESTADO.cancelled.className }
			: firmaEnPapel && contract.status === "pending"
				? {
						label: "Firma en papel",
						className:
							"border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-400",
					}
				: sinCerrar
					? fallaronIdentidad.length > 0
						? ETIQUETA_IDENTIDAD_FALLIDA
						: ETIQUETA_SIN_CERRAR
					: ESTADO[contract.status];
	const firmantes = firmaEnPapel ? [] : firmantesEnFicha(signatories, contract);

	const hayVencidos = firmantes.some((f) => f.vencido);
	const todosFirmaron =
		firmantes.length > 0 && firmantes.every((f) => f.estado === "signed");
	const alguienFirmo = firmantes.some((f) => f.estado === "signed");

	// Regenerar aparece una vez que alguien firmó, incluso si ya firmaron todos:
	// es el caso en que la firma existe pero no sirve (por ejemplo, una
	// identificación que no era la del cliente). También si algún enlace venció,
	// que si no dejaría a esa persona sin forma de firmar.
	// Los que cayeron al fallback de Documenso no tienen documento en WeeTrust:
	// consultar o regenerar sólo devolvería un error.
	const enWeeTrust = contract.signingProvider !== "documenso";
	// Un anulado ya fue reemplazado por otro: reemitirlo lo resucitaría.
	const puedeRegenerar =
		tienePermiso && enWeeTrust && !inactivo && (alguienFirmo || hayVencidos);

	const actualizarEstado = useMutation({
		mutationFn: () =>
			client.getContractSigningStatus({ contractId: contract.id }),
		onSuccess: (data) => {
			const firmados = data.signatories.filter((f) => f.isSigned).length;
			const cuenta = `${firmados} de ${data.signatories.length} firmaron (${data.status})`;
			// Si la verificación facial de alguien no pasó, WeeTrust no cierra el
			// documento: hay que decirlo, porque "2 de 2 firmaron (PENDING)" no lo
			// explica.
			const fallaron = identidadesFallidas(data.signatories);
			if (fallaron.length > 0) {
				toast.warning(
					`${cuenta}, pero la verificación facial de ${fallaron
						.map((f) => f.name)
						.join(", ")} no pasó`,
				);
			} else {
				toast.success(cuenta);
			}
			onUpdate?.();
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const [regenerando, setRegenerando] = useState(false);
	const [anulando, setAnulando] = useState(false);

	const ocupado = actualizarEstado.isPending;

	// Descartar el documento sin reemplazarlo. Va también en los de papel: un
	// contrato impreso equivocado se anula igual, y la fila queda con su motivo.
	// No para los del respaldo de Documenso: anularlo acá no cancela sus enlaces
	// allá, y el cliente podría seguir firmando uno que el CRM da por anulado.
	// Gris como las otras acciones de la fila, y rojo sólo al pasar encima: en
	// rojo fijo, repetido en cada contrato, se robaba la atención de la ficha.
	// Lo que protege de un clic de más es el diálogo, que pide el motivo.
	const botonAnular = puedeAnular && !inactivo && enWeeTrust && (
		<Button
			variant="ghost"
			size="sm"
			className="h-6 px-1.5 text-muted-foreground text-xs hover:text-destructive"
			disabled={ocupado}
			onClick={() => setAnulando(true)}
			title="Descarta el contrato sin reemplazarlo: se borra de la plataforma de firma salvo que ya lo hayan firmado todos. Queda en «Ver anulados» con el motivo."
		>
			<Trash2 className="mr-1 h-3 w-3" />
			Anular
		</Button>
	);

	return (
		<div className="rounded-md border bg-background p-3">
			{/* Encabezado: qué contrato es y cómo va */}
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="truncate font-medium text-sm">
						{contract.contractName}
					</p>
					<p className="truncate text-muted-foreground text-xs">
						{getContractTypeLabel(contract.contractType)}
					</p>
					<CartasDelPaquete
						contractType={contract.contractType}
						apiResponse={contract.apiResponse}
					/>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<EtiquetaSubidoAMano apiResponse={contract.apiResponse} />
					<EtiquetaIdentidadOmitida apiResponse={contract.apiResponse} />
					<Badge
						variant="outline"
						className={`${estado.className} text-xs`}
						title={"title" in estado ? estado.title : undefined}
					>
						{estado.label}
					</Badge>
					{/* El de observador es el link que importa acá: muestra el documento
					    y cómo va la firma, y es el único que se puede abrir sin quedar
					    firmando en nombre de alguien. */}
					{contract.observerUrl && (
						<Button
							variant="outline"
							size="sm"
							asChild
							className="h-7 text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300"
						>
							<a
								href={contract.observerUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-1"
								title="Ver el documento y cómo va la firma (no permite firmar)"
							>
								<Eye className="h-3 w-3" />
								Seguimiento
							</a>
						</Button>
					)}
					{/* El documento con las firmas puestas. Sólo existe cuando lo
					    firmaron todos: antes de eso WeeTrust todavía guarda el mismo
					    archivo que le subimos. Los de papel no tienen: su firma está en
					    la hoja impresa. Y los del respaldo de Documenso tampoco: el PDF
					    firmado se baja de WeeTrust. */}
					{contract.status === "signed" && !firmaEnPapel && enWeeTrust && (
						<DescargarFirmadoButton contractId={contract.id} />
					)}
					{contract.pdfLink && (
						<Button variant="outline" size="sm" asChild className="h-7">
							<a
								href={contract.pdfLink}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-1"
							>
								<FileText className="h-3 w-3" />
								{/* Ya firmado, decir sólo "PDF" hacía creer que éste era el
								    documento con las firmas. Es el borrador. */}
								{contract.status === "signed" ? "Sin firmas" : "PDF"}
							</a>
						</Button>
					)}
				</div>
			</div>

			{firmaEnPapel ? (
				<div className="mt-3 flex items-center justify-between gap-2 border-t pt-2">
					<p className="text-amber-700 text-xs dark:text-amber-400">
						Se firma en papel. No lleva enlace de firma.
					</p>
					{botonAnular}
				</div>
			) : (
				<div className="mt-3 space-y-2 border-t pt-2">
					{/* Por qué un contrato con todas las firmas no cierra, y las dos
					    salidas, sobre el mismo documento. Antes sólo había "Renovar
					    enlaces", que reemite y tumba todas las firmas. */}
					{fallaronIdentidad.length > 0 && !inactivo && (
						<VerificacionFacialFallida
							firmantes={fallaronIdentidad}
							puedeResolver={tienePermiso}
							resolver={(accion) =>
								client.retryContractBiometric({
									contractId: contract.id,
									accion,
								})
							}
							onResuelto={() => {
								cierreQuery.refetch();
								onUpdate?.();
							}}
						/>
					)}
					{!inactivo && contract.status === "pending" && (
						<RevisarSubidoAMano
							apiResponse={contract.apiResponse}
							observerUrl={contract.observerUrl}
						/>
					)}
					{/* Una fila por firmante: el estado es de cada link, no del
					    contrato. Puede haber uno firmado y otro con el link vencido. */}
					{firmantes.length > 0 ? (
						<div className="space-y-1">
							{firmantes.map((firmante) => (
								<div
									key={firmante.clave}
									className="flex items-center justify-between gap-2"
								>
									<div className="flex min-w-0 items-center gap-1.5">
										{firmante.estado === "signed" ? (
											<CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" />
										) : firmante.vencido ? (
											<TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
										) : (
											<Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
										)}
										<span className="shrink-0 font-medium text-xs">
											{firmante.etiqueta}
										</span>
										{firmante.nombre && (
											<span className="truncate text-muted-foreground text-xs">
												{firmante.nombre}
											</span>
										)}
									</div>

									<div className="flex shrink-0 items-center gap-0.5">
										<span
											className={
												firmante.estado === "signed"
													? "text-green-600 text-xs dark:text-green-400"
													: firmante.vencido
														? "text-amber-600 text-xs dark:text-amber-400"
														: "text-muted-foreground text-xs"
											}
										>
											{firmante.estado === "signed"
												? "Firmado"
												: firmante.vencido
													? "Link vencido"
													: "Pendiente"}
										</span>
										{/* Copiar va primero: casi siempre el link se le pasa a
										    alguien, y abrirlo desde acá te deja firmando en su
										    nombre. */}
										{/* Anulado: sus enlaces son de un documento reemplazado. Si
										    no se pudo borrar, todavía firman; no se ofrecen. */}
										{firmante.url &&
											firmante.estado !== "signed" &&
											!inactivo && (
												<>
													<Button
														variant="ghost"
														size="sm"
														className="ml-1 h-6 w-6 p-0"
														title={`Copiar el enlace de ${firmante.etiqueta}`}
														onClick={() => {
															navigator.clipboard.writeText(
																firmante.url as string,
															);
															toast.success(
																`Enlace de ${firmante.etiqueta} copiado`,
															);
														}}
													>
														<Copy className="h-3 w-3" />
													</Button>
													<Button
														variant="ghost"
														size="sm"
														asChild
														className="h-6 w-6 p-0"
													>
														<a
															href={firmante.url}
															target="_blank"
															rel="noopener noreferrer"
															title={`Abrir el enlace de ${firmante.etiqueta}`}
														>
															<ExternalLink className="h-3 w-3" />
														</a>
													</Button>
												</>
											)}
									</div>
								</div>
							))}
						</div>
					) : (
						<p className="text-muted-foreground text-xs">
							Sin enlaces de firma
						</p>
					)}

					{/* Acciones discretas: se usan de vez en cuando y no tienen por qué
					    competir con los firmantes, que es lo que se viene a mirar. */}
					<div className="flex flex-wrap items-center gap-1">
						{/* Con todo firmado no hay nada que actualizar ni que regenerar:
						    el documento está cerrado. Acá sólo se regeneran enlaces del
						    MISMO documento; reemplazarlo por otro es de jurídico y vive
						    en su ficha. */}
						{enWeeTrust && !todosFirmaron && !inactivo && (
							<Button
								variant="ghost"
								size="sm"
								className="h-6 px-1.5 text-muted-foreground text-xs hover:text-foreground"
								disabled={ocupado}
								onClick={() => actualizarEstado.mutate()}
							>
								{actualizarEstado.isPending ? (
									<Loader2 className="mr-1 h-3 w-3 animate-spin" />
								) : (
									<RefreshCw className="mr-1 h-3 w-3" />
								)}
								Actualizar estado
							</Button>
						)}

						{puedeRegenerar && (
							<Button
								variant="ghost"
								size="sm"
								className={
									hayVencidos
										? "h-6 px-1.5 text-amber-600 text-xs dark:text-amber-400"
										: "h-6 px-1.5 text-muted-foreground text-xs hover:text-foreground"
								}
								disabled={ocupado}
								onClick={() => setRegenerando(true)}
								title="Manda otra vez el mismo documento a firmar, con enlaces nuevos para todos. Los anteriores dejan de servir."
							>
								<RefreshCw className="mr-1 h-3 w-3" />
								{hayVencidos
									? "Renovar enlaces (hay vencidos)"
									: "Renovar enlaces"}
							</Button>
						)}

						{botonAnular}
					</div>
				</div>
			)}

			<AnularContratoDialog
				contractId={contract.id}
				contractName={contract.contractName}
				hayFirmas={alguienFirmo}
				open={anulando}
				onOpenChange={setAnulando}
				onAnulado={() => onUpdate?.()}
			/>

			<RegenerarEnlacesDialog
				contractId={contract.id}
				contractName={contract.contractName}
				hayFirmas={alguienFirmo}
				open={regenerando}
				onOpenChange={setRegenerando}
				onRegenerado={(nuevoId, porcentajeEtapa) => {
					// Sólo en 85%: ahí el cliente ya recibió los enlaces al aprobar y
					// los que tiene dejaron de servir. En 80% todavía no le llegó
					// nada; se los manda la aprobación.
					if (porcentajeEtapa === ETAPA_EN_FIRMA) {
						onPreguntarReenvio(contract.opportunityId ?? null, [
							{ id: nuevoId, nombre: contract.contractName },
						]);
					}
					onUpdate?.();
				}}
			/>
		</div>
	);
}
