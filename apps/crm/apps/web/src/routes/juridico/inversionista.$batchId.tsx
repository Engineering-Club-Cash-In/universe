import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	ArrowLeft,
	Ban,
	Building2,
	Check,
	FileUp,
	Loader2,
	User,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { CategoriaDeInversion } from "server/src/lib/contratos-inversiones";
import { toast } from "sonner";
import type { ContractResult } from "@/components/contracts/ContractResults";
import {
	type CRMData,
	DynamicContractWizard,
	moneyToWords,
} from "@/components/contracts/DynamicContractWizard";
import {
	AccionesDelContrato,
	ContratosDeLaBateria,
} from "@/components/inversiones/ContratosDeLaBateria";
import { UploadInvestorContractModal } from "@/components/inversiones/UploadInvestorContractModal";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useJuridicoPermissions } from "@/hooks/usePermissions";
import { estaAnulado } from "@/lib/contract-signers-display";
import { avisarCorreoDelHilo } from "@/lib/correo-del-hilo";
import { fechaEnPalabras } from "@/lib/fechas-en-palabras";
import { client, orpc } from "@/utils/orpc";

/**
 * Qué dice el estado de la batería: pendiente mientras jurídico la arma, por
 * firmar desde el "Listo" —que manda los contratos al hilo de la compra—, y
 * cerrada cuando se firma todo.
 */
const ESTADO_DE_BATERIA: Record<string, string> = {
	pendiente: "Pendiente",
	en_proceso: "Por firmar",
	completada: "Cerrada",
	descartada: "Descartada",
};

/**
 * Cómo se traduce a las opciones del contrato lo que cartera estampó en el
 * crédito.
 *
 * Las claves son las de cartera (`inversionistas.tipo_reinversion` y
 * `creditos_inversionistas_espejo.modalidad_facturacion`); los valores, las
 * opciones del campo en el catálogo de documentos.
 *
 * Las modalidades que no están (interés, variable, excedente, combinada) no
 * tienen opción en el contrato: ahí jurídico elige, que es lo que hacía antes
 * para todas.
 */
const MODALIDAD_DE_RETORNO: Record<string, string> = {
	sin_reinversion: "tradicional",
	reinversion_capital: "reinversion_capital",
	reinversion_total: "reinversion_total",
};

const FIGURA_FISCAL: Record<string, string> = {
	p2p_directa: "figura_1",
	factura_cube: "figura_2",
	factura_cube_pequeno: "figura_3",
};

export const Route = createFileRoute("/juridico/inversionista/$batchId")({
	component: RouteComponent,
});

const CATEGORIAS: Array<{
	valor: CategoriaDeInversion;
	etiqueta: string;
	detalle: string;
	Icono: typeof User;
}> = [
	{
		valor: "individual",
		etiqueta: "Inversionista individual",
		detalle: "Invierte una persona y firma con su DPI",
		Icono: User,
	},
	{
		valor: "sociedad",
		etiqueta: "Sociedad",
		detalle: "Invierte una empresa y firma su representante",
		Icono: Building2,
	},
];

function quetzales(monto: string | number) {
	return new Intl.NumberFormat("es-GT", {
		style: "currency",
		currency: "GTQ",
	}).format(Number(monto));
}

/** El monto sin símbolo: "25,000.00". Hay campos que piden sólo el número. */
function soloElNumero(monto: string | number) {
	return new Intl.NumberFormat("es-GT", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(Number(monto));
}

function RouteComponent() {
	const { batchId } = Route.useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { canViewLegal, isLoading: cargandoPermisos } =
		useJuridicoPermissions();

	// Sin preselección: elegir mal la categoría emite el juego de contratos
	// equivocado, así que es una decisión que se toma, no una que se hereda.
	const [categoria, setCategoria] = useState<CategoriaDeInversion | null>(null);
	const [dpi, setDpi] = useState("");
	const [dpiTocado, setDpiTocado] = useState(false);
	const [motivoDescarte, setMotivoDescarte] = useState("");
	const [descartando, setDescartando] = useState(false);
	const [subiendo, setSubiendo] = useState(false);
	const [tipoASubir, setTipoASubir] = useState<string | undefined>(undefined);

	const bateriaQuery = useQuery({
		...orpc.getInvestorContractBatch.queryOptions({ input: { batchId } }),
		enabled: canViewLegal,
	});

	// Lo que la batería tiene de verdad. Las tarjetas de los resultados salen
	// de acá y no de lo que devolvió la emisión: son la vista previa del
	// correo, y un reemplazo o una subida tienen que verse ahí mismo.
	const contratosQuery = useQuery({
		...orpc.listInvestorContracts.queryOptions({ input: { batchId } }),
		enabled: canViewLegal,
	});
	const vigentes = useMemo(
		() =>
			(contratosQuery.data ?? [])
				.filter((c) => !estaAnulado(c))
				.sort(
					(a, b) =>
						new Date(a.generatedAt ?? 0).getTime() -
						new Date(b.generatedAt ?? 0).getTime(),
				),
		[contratosQuery.data],
	);
	const resultadosVigentes = useMemo<ContractResult[]>(
		() =>
			vigentes.map((c) => ({
				contractType: c.contractType,
				contractName: c.contractName,
				success: true,
				contractId: c.id,
				documentLink: c.pdfUrl ?? undefined,
				signatories: c.firmantes,
				apiResponse: c.apiResponse,
			})),
		[vigentes],
	);

	// Mientras el wizard muestra las tarjetas, la lista y la barra de abajo
	// repetían lo mismo: se esconden. Al volver otro día, sin tarjetas, son
	// por donde se entra.
	const [mostrandoResultados, setMostrandoResultados] = useState(false);

	// El catálogo del generador sólo devuelve los de inversiones si se le pide la
	// categoría, y el servidor ya deja únicamente los que tienen layout auditado.
	const contractTypesQuery = useQuery({
		...orpc.getInvestmentContractTypes.queryOptions({
			input: { categoria: categoria ?? "individual" },
		}),
		enabled: canViewLegal && categoria !== null,
	});

	const bateria = bateriaQuery.data;

	// De quién es el DPI con el que se piden los campos del contrato.
	//
	// Si cartera tiene el del representante legal, es ese: cuando está cargado es
	// porque hay alguien que firma por el inversionista. Si no, el del
	// inversionista. No se decide por la categoría: una sociedad puede no tener
	// cargado el del representante, y el campo quedaría vacío teniendo uno bueno
	// a mano. Jurídico igual puede corregirlo.
	const dpiDeCartera =
		bateria?.investorDpiRepLegal?.trim() || bateria?.investorDpi?.trim() || "";
	const dpiEnUso = dpiTocado ? dpi : dpiDeCartera;

	const documentTypes = contractTypesQuery.data?.data ?? [];

	const crmData: CRMData = useMemo(
		() => ({
			cliente: {
				nombreCompleto: bateria?.investorName,
				dpi: dpiEnUso,
				correo: bateria?.investorEmail ?? undefined,
			},
			// Inversiones no tiene vehículo ni crédito: los campos que el template
			// pida se llenan a mano, que es como se vienen haciendo hoy.
			vehiculo: {},
			credito: {},
			coDebtors: [],
		}),
		[bateria, dpiEnUso],
	);

	/**
	 * Lo que ya sabemos de la compra, en las claves que usan los contratos.
	 *
	 * Hoy es la lista de créditos cedidos de la cesión: a nombre de quién está
	 * cada crédito, **cuánto puso el inversionista en él**, cuándo se formalizó
	 * (la cuota 0) y cuándo vence (la última cuota). Todo eso está en cartera, y
	 * transcribirlo a mano era copiar cuatro datos por crédito de una pantalla a
	 * otra.
	 *
	 * El monto es el aportado, no el capital del crédito: en un pool la cedente
	 * cede su parte, que puede ser Q7,634 de un crédito de Q142,000.
	 */
	const valoresIniciales = useMemo(() => {
		const creditos = bateria?.creditos ?? [];
		if (creditos.length === 0) return undefined;

		const items = creditos.map((credito) => ({
			nombreDeudor: credito.clienteNombre,
			cantidadCapitalCredito: `${moneyToWords(Number(credito.monto)).toUpperCase()} (${quetzales(credito.monto)})`,
			fechaTextoInicioCredito: fechaEnPalabras(credito.fechaInicio),
			fechaTextoVencimiento: fechaEnPalabras(credito.fechaVencimiento),
		}));

		// Cómo recibe el retorno y cómo factura salen del crédito, que es donde
		// cartera los estampa. Alcanza con el primero de la compra: el monto puede
		// repartirse en varios créditos, pero el trato con el inversionista es uno
		// solo y va igual en todos.
		const primero = creditos[0];

		// Lo que el inversionista puso en esta compra, que es la suma de lo suyo
		// en cada crédito. Los contratos lo piden en tres formas distintas —en
		// letras con el número entre paréntesis, sólo en número, y sólo en
		// letras— y cada una tiene que pasar su propia validación.
		const monto = bateria?.montoTotal ?? "0";
		const enLetras = moneyToWords(Number(monto)).toUpperCase();

		return {
			listaCreditos: JSON.stringify(items),
			montoTotal: `${enLetras} (${quetzales(monto)})`,
			montoNumero: soloElNumero(monto),
			montoLetras: enLetras,
			...(MODALIDAD_DE_RETORNO[primero?.tipoReinversion ?? ""]
				? {
						modalidadRetorno:
							MODALIDAD_DE_RETORNO[primero?.tipoReinversion ?? ""],
					}
				: {}),
			...(FIGURA_FISCAL[primero?.modalidadFacturacion ?? ""]
				? { figuraFiscal: FIGURA_FISCAL[primero?.modalidadFacturacion ?? ""] }
				: {}),
		};
	}, [bateria]);

	/**
	 * El "Listo": manda al hilo de la compra los contratos que se ven en la
	 * lista —con los reemplazos y lo subido a mano— y la batería pasa a "Por
	 * firmar". Si el correo no sale, el servidor la deja pendiente y el error
	 * se ve acá, para reintentar.
	 */
	const listoMutation = useMutation({
		mutationFn: () => client.marcarBateriaLista({ batchId }),
		onSuccess: (resultado) => {
			avisarCorreoDelHilo(resultado);
			queryClient.invalidateQueries({
				predicate: (query) =>
					JSON.stringify(query.queryKey).includes("InvestorContract"),
			});
			navigate({ to: "/juridico" });
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const cerrarMutation = useMutation({
		...orpc.closeInvestorContractBatch.mutationOptions(),
		onSuccess: () => {
			toast.success("Batería descartada");
			queryClient.invalidateQueries({
				predicate: (query) =>
					JSON.stringify(query.queryKey).includes("InvestorContractBatch"),
			});
			navigate({ to: "/juridico" });
		},
		onError: (error: Error) => toast.error(error.message),
	});

	// Va como mutación y no como función suelta para que el wizard sepa que está
	// trabajando: emitir tarda —habla con el generador y con WeeTrust— y sin eso
	// el botón se quedaba quieto y la gente lo apretaba de nuevo.
	const generarMutation = useMutation({
		mutationFn: (data: {
			contracts: Array<{
				contractType: string;
				data: Record<string, string>;
				options: {
					gender: "male" | "female";
					generatePdf: boolean;
					isPlural?: boolean;
					filenamePrefix: string;
				};
			}>;
		}) => {
			const nombrePorTipo = new Map(
				documentTypes.map((tipo) => [tipo.enum, tipo.label]),
			);

			return client.generateInvestorContracts({
				batchId,
				contracts: data.contracts.map((contrato) => ({
					contractType: contrato.contractType,
					contractName:
						nombrePorTipo.get(contrato.contractType) ?? contrato.contractType,
					data: contrato.data,
					gender: contrato.options.gender,
				})),
			});
		},
		onSuccess: (resultado) => {
			if (resultado.success) {
				toast.success("Contratos emitidos y enlazados al inversionista");
			} else {
				toast.warning("Algunos contratos no se pudieron emitir");
			}
			// Sólo después del "Listo": lo emitido sale solo al hilo de la compra.
			avisarCorreoDelHilo(resultado.correo);
			queryClient.invalidateQueries({
				predicate: (query) =>
					JSON.stringify(query.queryKey).includes("InvestorContract"),
			});
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const traerCampos = async (
		dpiConsultado: string,
		documentNames: string[],
	) => {
		const limpio = dpiConsultado.replace(/\D/g, "");
		// El catálogo de campos se pide por DPI. Cartera no siempre lo tiene (y en
		// una sociedad el que firma es su representante), así que se avisa acá en
		// vez de dejar que el error venga del validador.
		if (limpio.length !== 13) {
			throw new Error(
				"Hace falta el DPI de quien firma, con sus 13 dígitos. Corregilo arriba.",
			);
		}

		return client.getDocumentsByDpi({ dpi: limpio, documentNames });
	};

	if (cargandoPermisos || bateriaQuery.isLoading) {
		return (
			<div className="flex h-64 items-center justify-center">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (!canViewLegal) {
		return (
			<div className="p-6">
				<p className="text-muted-foreground">
					No tenés acceso a los contratos de jurídico.
				</p>
			</div>
		);
	}

	if (!bateria) {
		return (
			<div className="p-6">
				<p className="text-muted-foreground">Esa batería no existe.</p>
			</div>
		);
	}

	// Sólo la descartada deja de admitir contratos: la completada se cerró sola
	// al emitir el primero y puede necesitar otro después.
	// Descartada o firmada entera: ninguna de las dos admite cambios.
	const cerrada =
		bateria.status === "descartada" || bateria.status === "completada";

	/**
	 * El contrato que se armó por fuera entra por acá y termina igual que los
	 * emitidos: con sus enlaces y en la ficha del inversionista.
	 *
	 * Va en dos lugares: debajo de los resultados de la generación —que es donde
	 * jurídico se da cuenta de que le falta uno— y al final de la pantalla. Pide
	 * la categoría primero porque de ahí sale la lista de tipos.
	 */
	const barraDeSubida = (
		<div className="flex items-center justify-end gap-3 rounded-lg border border-dashed p-3">
			<p className="text-muted-foreground text-sm">
				¿El contrato se armó fuera del sistema?
			</p>
			<Button
				variant="outline"
				size="sm"
				disabled={documentTypes.length === 0}
				title={
					documentTypes.length === 0
						? "Elegí la categoría para ver los tipos de contrato"
						: undefined
				}
				onClick={() => {
					setTipoASubir(undefined);
					setSubiendo(true);
				}}
			>
				<FileUp className="mr-2 h-4 w-4" />
				Subir contrato
			</Button>
		</div>
	);

	return (
		<div className="space-y-4 p-4 md:p-6">
			<div className="flex items-center gap-3">
				<Button
					variant="ghost"
					size="icon"
					onClick={() => navigate({ to: "/juridico" })}
				>
					<ArrowLeft className="h-4 w-4" />
				</Button>
				<div>
					<h1 className="font-semibold text-xl">{bateria.investorName}</h1>
					<p className="text-muted-foreground text-sm">
						Contratos de inversión · compra aceptada el{" "}
						{new Date(bateria.acceptedAt).toLocaleDateString("es-GT")}
					</p>
				</div>
				<Badge variant={cerrada ? "secondary" : "default"} className="ml-auto">
					{ESTADO_DE_BATERIA[bateria.status] ??
						bateria.status.replace("_", " ")}
				</Badge>

				{/* La batería se cierra sola cuando se firma todo. Descartar es para la
				    compra que no lleva papelería, y pide motivo: con contratos
				    emitidos el servidor lo rechaza, así que ni se ofrece. */}
				{!cerrada && contratosQuery.isSuccess && vigentes.length === 0 && (
					<AlertDialog open={descartando} onOpenChange={setDescartando}>
						<AlertDialogTrigger asChild>
							<Button variant="ghost" size="sm">
								<Ban className="mr-2 h-4 w-4" />
								Descartar
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>¿Descartar esta batería?</AlertDialogTitle>
								<AlertDialogDescription>
									Es para la compra que no lleva contratos. Queda registrada con
									el motivo y no se le pueden emitir contratos después.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<Input
								value={motivoDescarte}
								onChange={(e) => setMotivoDescarte(e.target.value)}
								placeholder="Por qué no hay que hacer estos contratos"
							/>
							<AlertDialogFooter>
								<AlertDialogCancel>Cancelar</AlertDialogCancel>
								<AlertDialogAction
									onClick={() =>
										cerrarMutation.mutate({
											batchId,
											resultado: "descartada",
											motivo: motivoDescarte,
										})
									}
									disabled={
										cerrarMutation.isPending || motivoDescarte.trim().length < 3
									}
								>
									Descartar
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				)}
			</div>

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-base">
						<User className="h-4 w-4" />
						Datos del inversionista
					</CardTitle>
					<CardDescription>
						Son los que cartera tenía cuando se aceptó la compra.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4 md:grid-cols-2">
					<div className="space-y-1">
						<Label className="text-muted-foreground text-xs">Correo</Label>
						<p className="text-sm">
							{bateria.investorEmail ?? (
								<span className="text-destructive">
									Sin correo: no se le pueden mandar enlaces de firma
								</span>
							)}
						</p>
					</div>
					<div className="space-y-1">
						<Label className="text-muted-foreground text-xs">
							Monto de la compra
						</Label>
						<p className="text-sm">{quetzales(bateria.montoTotal)}</p>
					</div>
					<div className="space-y-1">
						<Label className="text-muted-foreground text-xs">Modalidad</Label>
						<p className="text-sm">
							{bateria.modalidad ?? "—"} · {bateria.facturacion ?? "—"}
						</p>
					</div>
					<div className="space-y-1">
						<Label className="text-muted-foreground text-xs" htmlFor="dpi">
							DPI de quien firma
						</Label>
						<Input
							id="dpi"
							value={dpiEnUso}
							onChange={(e) => {
								setDpiTocado(true);
								setDpi(e.target.value);
							}}
							placeholder="13 dígitos"
						/>
						<p className="text-muted-foreground text-xs">
							{bateria.investorDpiRepLegal?.trim()
								? "Es el del representante legal, como lo tiene cartera."
								: dpiDeCartera
									? "Es el del inversionista: cartera no tiene el de un representante legal."
									: "Cartera no tiene ningún DPI de esta persona: cargalo acá."}
						</p>
					</div>
					<div className="space-y-1 md:col-span-2">
						<Label className="text-muted-foreground text-xs">
							Créditos de la compra ({bateria.creditos.length})
						</Label>
						<ul className="space-y-1 text-sm">
							{bateria.creditos.map((credito) => (
								<li key={credito.creditoId} className="flex justify-between">
									<span>
										{credito.numeroCreditoSifco} · {credito.clienteNombre}
									</span>
									<span className="text-muted-foreground">
										{quetzales(credito.monto)}
									</span>
								</li>
							))}
						</ul>
					</div>
				</CardContent>
			</Card>

			{cerrada ? (
				<Card>
					<CardContent className="p-6 text-muted-foreground text-sm">
						{bateria.status === "completada" ? (
							<>
								Esta batería está cerrada: todos sus contratos están firmados y
								ya no admite cambios.
							</>
						) : (
							<>
								Esta batería se descartó
								{bateria.discardReason ? `: ${bateria.discardReason}` : "."} No
								admite contratos.
							</>
						)}
					</CardContent>
				</Card>
			) : (
				<Card>
					<CardHeader>
						<CardTitle className="text-base">Emitir contratos</CardTitle>
						<CardDescription>
							Elegí la categoría y después los contratos que se van a hacer. Los
							campos se llenan acá mismo; los enlaces de firma salen solos y
							quedan en la ficha del inversionista.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<DynamicContractWizard
							// Cambiar de categoría arranca de cero: si no, los contratos
							// elegidos de la otra siguen seleccionados —y ocultos, porque
							// el catálogo cambió— y se emitirían igual.
							key={categoria ?? "sin-categoria"}
							documentTypes={documentTypes}
							crmData={crmData}
							onGetDocumentsByDpi={traerCampos}
							onGenerate={(data) => generarMutation.mutateAsync(data)}
							isGenerating={generarMutation.isPending}
							onBack={() => navigate({ to: "/juridico" })}
							accionesDeResultados={barraDeSubida}
							// Mientras la lista se refresca (o si no se pudo), lo que devolvió la
							// emisión: con la lista vieja, recién emitido, el wizard mostraba
							// "0 de 0" con el "Listo" habilitado.
							resultadosVigentes={
								contratosQuery.isFetching || contratosQuery.isError
									? undefined
									: resultadosVigentes
							}
							onResultadosVisibles={setMostrandoResultados}
							// Mientras falte firmar, jurídico corrige desde la tarjeta.
							accionPorContrato={(resultado) => {
								const contrato = vigentes.find(
									(c) => c.id === resultado.contractId,
								);
								if (!contrato || contrato.status === "signed") return null;
								return (
									<AccionesDelContrato
										contrato={contrato}
										onReemplazar={(contractType) => {
											setTipoASubir(contractType);
											setSubiendo(true);
										}}
										onAnulado={() =>
											queryClient.invalidateQueries({
												predicate: (query) =>
													JSON.stringify(query.queryKey).includes(
														"InvestorContract",
													),
											})
										}
									/>
								);
							}}
							// El "Listo" sólo antes de mandarlos: después, lo que se
							// emite sale solo al hilo.
							onFinish={
								bateria.status === "pendiente"
									? () => listoMutation.mutate()
									: undefined
							}
							finalizando={listoMutation.isPending}
							// "Corregir y Regenerar", como en ventas: descarta lo emitido
							// (se borra en WeeTrust) y vuelve al formulario con los datos.
							// Sólo antes del Listo.
							onCorregir={
								bateria.status === "pendiente"
									? async () => {
											try {
												const r = await client.descartarVistaPrevia({
													batchId,
												});
												if (r.firmados.length > 0) {
													toast.warning(
														`No se descartó ${r.firmados.join(", ")}: ya está firmado.`,
													);
												}
											} catch (error) {
												toast.error(
													error instanceof Error
														? error.message
														: "No se pudieron descartar los contratos",
												);
												throw error;
											} finally {
												queryClient.invalidateQueries({
													predicate: (query) =>
														JSON.stringify(query.queryKey).includes(
															"InvestorContract",
														),
												});
											}
										}
									: undefined
							}
							valoresIniciales={valoresIniciales}
							pasoPrevio={{
								etiqueta: "Categoría",
								completo: categoria !== null && !contractTypesQuery.isLoading,
								contenido: (
									<div className="space-y-4">
										<p className="text-muted-foreground text-sm">
											Quién invierte decide qué juego de contratos se hace.
										</p>

										<div className="grid gap-3 md:grid-cols-2">
											{CATEGORIAS.map(({ valor, etiqueta, detalle, Icono }) => {
												const elegida = categoria === valor;
												return (
													<button
														key={valor}
														type="button"
														onClick={() => setCategoria(valor)}
														className={`flex items-start gap-3 rounded-lg border p-4 text-left transition-colors ${
															elegida
																? "border-primary bg-primary/5 ring-1 ring-primary"
																: "hover:border-muted-foreground/40 hover:bg-muted/40"
														}`}
													>
														<Icono
															className={`mt-0.5 h-5 w-5 shrink-0 ${
																elegida
																	? "text-primary"
																	: "text-muted-foreground"
															}`}
														/>
														<div className="space-y-1">
															<div className="flex items-center gap-2">
																<span className="font-medium text-sm">
																	{etiqueta}
																</span>
																{elegida && (
																	<Check className="h-4 w-4 text-primary" />
																)}
															</div>
															<p className="text-muted-foreground text-xs">
																{detalle}
															</p>
															{elegida &&
																(contractTypesQuery.isLoading ? (
																	<p className="flex items-center gap-1 text-muted-foreground text-xs">
																		<Loader2 className="h-3 w-3 animate-spin" />
																		Cargando contratos...
																	</p>
																) : (
																	<p className="text-primary text-xs">
																		{documentTypes.length} contratos disponibles
																	</p>
																))}
														</div>
													</button>
												);
											})}
										</div>
									</div>
								),
							}}
						/>
					</CardContent>
				</Card>
			)}

			{/* Lo que la batería ya tiene. Sin esto, volver a una batería de otro
			    día no daba desde dónde corregir un contrato: los resultados del
			    wizard son sólo de la sesión en que se emitieron. */}
			{/* También cerrada: ahí sólo muestra los firmados con su PDF, sin
			    acciones, que es lo que jurídico viene a buscar. */}
			{bateria.status !== "descartada" && !mostrandoResultados && (
				<ContratosDeLaBateria
					batchId={batchId}
					estadoDeLaBateria={bateria.status}
					onReemplazar={(contractType) => {
						setTipoASubir(contractType);
						setSubiendo(true);
					}}
					onListo={() => listoMutation.mutate()}
					mandando={listoMutation.isPending}
				/>
			)}

			{/* La misma barra que va bajo los resultados: al final de la pantalla
			    también, para el que llega hasta acá. */}
			{!cerrada && !mostrandoResultados && barraDeSubida}

			<UploadInvestorContractModal
				batchId={batchId}
				documentTypes={documentTypes}
				tipoInicial={tipoASubir}
				open={subiendo}
				onOpenChange={setSubiendo}
				// Subir cierra la batería igual que emitir: la lista de jurídico y la
				// cabecera de esta pantalla tienen que reflejarlo.
				onUploaded={() => {
					queryClient.invalidateQueries({
						predicate: (query) =>
							JSON.stringify(query.queryKey).includes("InvestorContract"),
					});
				}}
			/>
		</div>
	);
}
