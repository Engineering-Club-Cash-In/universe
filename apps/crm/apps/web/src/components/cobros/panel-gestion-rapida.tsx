import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	AlertTriangle,
	Banknote,
	Clock,
	ExternalLink,
	HandCoins,
	Loader2,
	Mail,
	MapPin,
	MessageCircle,
	Phone,
} from "lucide-react";
import { useMemo } from "react";
import { ContactoModal } from "@/components/contacto-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import {
	type BucketsCatalogoQueryData,
	bucketDeEstado,
	bucketDeNumero,
	estiloBucket,
	labelBucketConCodigo,
	useBucketsCatalogo,
} from "@/lib/cobros/buckets-catalogo";
import { inicioDelDiaGT } from "@/lib/cobros/promesa-activa";
import { orpc } from "@/utils/orpc";

/**
 * Panel "Gestión rápida" — la vista previa del caso que se abre al hacer click
 * en una fila, antes de ir a la Ficha 360 completa. Comparte las MISMAS
 * queries y el mismo lenguaje visual que /cobros/$id: lo que cambia es la
 * densidad (una columna, lo esencial) y que vive en un drawer.
 *
 * Existe para que el asesor decida sin perder la lista: mira el estado del
 * cobro, el compromiso vigente y a qué teléfono llamar, y solo entra a la
 * ficha si va a gestionar en serio.
 */

interface CasoPanel {
	id?: string | null;
	clienteNombre?: string | null;
	numeroCreditoSifco?: string | null;
	estadoMora?: string | null;
	estadoContrato?: string | null;
	montoEnMora?: string | number | null;
	diasMoraMaximo?: number | null;
	cuotasVencidas?: number | null;
	cuotaMensual?: string | number | null;
	cuotaConvenio?: string | number | null;
	deudaTotal?: string | number | null;
	diaPagoMensual?: number | null;
	fechaInicio?: string | null;
	numeroCuotas?: number | null;
	cuotasRestantes?: number | null;
	telefonoPrincipal?: string | null;
	telefonoAlternativo?: string | null;
	emailContacto?: string | null;
	direccionContacto?: string | null;
	proximoContacto?: string | null;
	vehiculoMarca?: string | null;
	vehiculoModelo?: string | null;
	vehiculoYear?: number | null;
	vehiculoPlaca?: string | null;
	asesor?: { nombre?: string | null; telefono?: string | null } | null;
	montoFinanciado?: string | number | null;
	creditType?: string | null;
}

interface ContactoPanel {
	id: string;
	estadoContacto: string;
	estadoPromesa?: string | null;
	fechaContacto: string | Date;
	fechaProximoContacto?: string | Date | null;
	montoComprometido?: string | null;
	comentarios?: string | null;
	metodoContacto: string;
	realizadoPor?: string | null;
}

/** Canales que se pueden disparar desde el panel (mismos de la ficha). */
const CANALES = [
	{
		metodo: "llamada" as const,
		label: "Llamar",
		Icono: Phone,
		color: "text-blue-600 dark:text-blue-400",
	},
	{
		metodo: "whatsapp" as const,
		label: "WhatsApp",
		Icono: MessageCircle,
		color: "text-green-600 dark:text-green-400",
	},
	{
		metodo: "email" as const,
		label: "Correo",
		Icono: Mail,
		color: "text-indigo-600 dark:text-indigo-400",
	},
];

/** Badges de resultado de gestión — mismos labels/colores que la Ficha 360. */
const ESTADO_GESTION: Record<string, { label: string; color: string }> = {
	contactado: { label: "Contactado", color: "bg-green-100 text-green-800" },
	promesa_pago: { label: "Promesa de Pago", color: "bg-blue-100 text-blue-800" },
	no_contesta: { label: "No Contesta", color: "bg-yellow-100 text-yellow-800" },
	mensaje_enviado: {
		label: "Mensaje enviado",
		color: "bg-sky-100 text-sky-800",
	},
	acuerdo_parcial: {
		label: "Acuerdo Parcial",
		color: "bg-purple-100 text-purple-800",
	},
	rechaza_pagar: { label: "Rechaza Pagar", color: "bg-red-100 text-red-800" },
	numero_equivocado: {
		label: "Número Equivocado",
		color: "bg-gray-100 text-gray-800",
	},
	pago_registrado: {
		label: "Pago registrado",
		color: "bg-emerald-100 text-emerald-800",
	},
};

const ALERTA_LABEL: Record<string, string> = {
	promesa_incumplida: "Promesa incumplida",
	promesa_por_vencer: "Promesa por vencer",
	cliente_subido: "Subió de bucket",
	sin_contacto_3d: "Sin contacto",
};

function money(v: string | number | null | undefined) {
	const n = Number(v ?? 0);
	if (!Number.isFinite(n)) return "—";
	return `Q${n.toLocaleString("es-GT", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;
}

function fechaGT(v: string | Date | null | undefined) {
	if (!v) return "—";
	return new Date(v).toLocaleDateString("es-GT", {
		timeZone: "America/Guatemala",
		day: "2-digit",
		month: "short",
		year: "numeric",
	});
}

function Dato({
	label,
	children,
	className,
}: {
	label: string;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div>
			<p className="text-muted-foreground text-xs">{label}</p>
			<p className={`font-medium text-sm ${className ?? ""}`}>{children}</p>
		</div>
	);
}

export function PanelGestionRapida({
	creditoId,
	open,
	onClose,
}: {
	/** numeroCreditoSifco o creditoId — el mismo que usa la ruta /cobros/$id. */
	creditoId: string | null;
	open: boolean;
	onClose: () => void;
}) {
	const navigate = useNavigate();
	const bucketsCatalogo = useBucketsCatalogo();
	const catalogo = bucketsCatalogo.data as BucketsCatalogoQueryData | undefined;
	const habilitado = open && !!creditoId;

	const detalleQuery = useQuery({
		...orpc.getDetallesCreditoCarteraBack.queryOptions({
			input: { creditoId: creditoId ?? "" },
		}),
		enabled: habilitado,
	});
	const caso = detalleQuery.data as CasoPanel | undefined;

	const bucketQuery = useQuery({
		...orpc.getBucketActualCredito.queryOptions({
			input: { creditoId: creditoId ?? "" },
		}),
		enabled: habilitado,
	});
	const bucket = bucketQuery.data as { bucket: number | null } | undefined;

	const contactosQuery = useQuery({
		...orpc.getHistorialContactos.queryOptions({
			input: { casoCobroId: caso?.id ?? "", limit: 50 },
		}),
		enabled: habilitado && !!caso?.id,
	});
	const contactos = (contactosQuery.data as ContactoPanel[] | undefined) ?? [];

	const alertasQuery = useQuery({
		...orpc.getAlertasCaso.queryOptions({
			input: { casoCobroId: caso?.id ?? "" },
		}),
		enabled: habilitado && !!caso?.id,
	});
	const alertas =
		(alertasQuery.data as
			| Array<{
					id: string;
					titulo: string;
					cobrosTipo: string | null;
					repeticiones: number;
			  }>
			| undefined) ?? [];

	// Mismo criterio que la ficha: promesa pendiente cuya fecha aún no pasó.
	const promesaActiva = useMemo(() => {
		const hoy = inicioDelDiaGT();
		return (
			contactos
				.filter(
					(c) =>
						c.estadoContacto === "promesa_pago" &&
						(c.estadoPromesa ?? "pendiente") === "pendiente" &&
						!!c.fechaProximoContacto &&
						new Date(c.fechaProximoContacto) >= hoy,
				)
				.sort(
					(a, b) =>
						new Date(b.fechaProximoContacto as string).getTime() -
						new Date(a.fechaProximoContacto as string).getTime(),
				)[0] ?? null
		);
	}, [contactos]);

	const ultimos = useMemo(
		() =>
			contactos.filter((c) => c.estadoContacto !== "promesa_pago").slice(0, 3),
		[contactos],
	);

	const bucketUI =
		bucket?.bucket != null
			? bucketDeNumero(bucket.bucket, catalogo)
			: bucketDeEstado(
					caso?.estadoContrato === "activo"
						? (caso?.estadoMora ?? "al_dia")
						: (caso?.estadoContrato ?? "al_dia"),
					catalogo,
				);

	const totalMes =
		Number(caso?.cuotaConvenio ?? 0) > 0
			? Number(caso?.cuotaConvenio ?? 0) + Number(caso?.cuotaMensual ?? 0)
			: Number(caso?.montoEnMora ?? 0) +
				Number(caso?.cuotasVencidas ?? 0) * Number(caso?.cuotaMensual ?? 0);

	const telefonos = String(caso?.telefonoPrincipal ?? "")
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean);

	const iniciales = (caso?.clienteNombre || "?")
		.split(" ")
		.filter(Boolean)
		.slice(0, 2)
		.map((p) => p[0])
		.join("")
		.toUpperCase();

	const abrirFicha = () => {
		if (!creditoId) return;
		onClose();
		navigate({
			to: "/cobros/$id",
			params: { id: creditoId },
			search: { tipo: "caso" },
		});
	};

	return (
		<Sheet open={open} onOpenChange={(v) => !v && onClose()}>
			<SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-4xl lg:max-w-5xl">
				<SheetHeader className="border-b p-4">
					<SheetTitle>Gestión rápida</SheetTitle>
				</SheetHeader>

				{detalleQuery.isPending ? (
					<div className="flex flex-1 items-center justify-center">
						<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
					</div>
				) : !caso ? (
					<div className="flex-1 p-6 text-center text-muted-foreground text-sm">
						No se pudo cargar el caso.
					</div>
				) : (
					<div className="flex-1 space-y-4 overflow-y-auto p-4">
						{/* Identidad */}
						<div className="flex items-start gap-3">
							<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary text-sm">
								{iniciales}
							</div>
							<div className="min-w-0">
								<p className="font-semibold text-base leading-tight">
									{caso.clienteNombre || "Cliente sin nombre"}
								</p>
								<p className="truncate text-muted-foreground text-xs">
									{caso.numeroCreditoSifco}
									{caso.vehiculoMarca
										? ` · ${caso.vehiculoMarca} ${caso.vehiculoModelo ?? ""}`
										: ""}
									{caso.vehiculoPlaca ? ` · ${caso.vehiculoPlaca}` : ""}
								</p>
								<div className="mt-1.5 flex flex-wrap items-center gap-1.5">
									<Badge
										variant="outline"
										className="text-[10px]"
										style={estiloBucket(bucketUI.colorHex)}
									>
										{labelBucketConCodigo(bucketUI)}
									</Badge>
									{promesaActiva && (
										<Badge
											variant="outline"
											className="border-transparent bg-emerald-100 text-[10px] text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
										>
											Promesa activa
										</Badge>
									)}
								</div>
							</div>
						</div>

						{/* Dos columnas como el diseño: a la izquierda el dinero, a la
						    derecha con quién hablar y qué prometió. */}
						<div className="grid gap-4 md:grid-cols-2">
							{/* Cobro de este mes */}
							<div className="rounded-lg border p-3">
								<div className="mb-2 flex items-center gap-2">
									<Banknote className="h-4 w-4 text-muted-foreground" />
									<span className="font-medium text-sm">Cobro de este mes</span>
								</div>
								<p className="text-muted-foreground text-xs">Total a pagar</p>
								<p className="font-bold text-2xl">{money(totalMes)}</p>
								<div className="mt-2 grid grid-cols-2 gap-3">
									<Dato
										label="Monto en mora"
										className={
											Number(caso.montoEnMora ?? 0) > 0 ? "text-red-600" : ""
										}
									>
										{money(caso.montoEnMora)}
									</Dato>
									<Dato label="Cuota mensual">{money(caso.cuotaMensual)}</Dato>
									<Dato label="Saldo pendiente">{money(caso.deudaTotal)}</Dato>
									<Dato
										label="Días de atraso"
										className={
											(caso.diasMoraMaximo ?? 0) > 0 ? "text-red-600" : ""
										}
									>
										{caso.diasMoraMaximo ?? 0}
									</Dato>
									<Dato label="Cuotas vencidas">
										{caso.cuotasVencidas ?? 0}
									</Dato>
									<Dato label="Cuotas restantes">
										{caso.cuotasRestantes ?? "—"}
										{caso.numeroCuotas ? ` de ${caso.numeroCuotas}` : ""}
									</Dato>
									{Number(caso.cuotaConvenio ?? 0) > 0 && (
										<Dato
											label="Cuota convenio"
											className="text-blue-700 dark:text-blue-400"
										>
											{money(caso.cuotaConvenio)}
										</Dato>
									)}
								</div>
							</div>

							{/* Contacto */}
							<div className="rounded-lg border p-3">
								<div className="mb-2 flex items-center gap-2">
									<Phone className="h-4 w-4 text-muted-foreground" />
									<span className="font-medium text-sm">Contacto</span>
								</div>
								<div className="space-y-2">
									{telefonos.length > 0 ? (
										<div className="flex flex-wrap gap-1.5">
											{telefonos.map((t) => (
												<a
													key={t}
													href={`tel:${t}`}
													className="rounded-md border px-2 py-1 font-medium text-xs transition-colors hover:bg-muted"
												>
													{t}
												</a>
											))}
										</div>
									) : (
										<p className="text-muted-foreground text-xs">
											Sin teléfono
										</p>
									)}
									{caso.emailContacto && (
										<p className="flex items-center gap-1.5 text-xs">
											<Mail className="h-3 w-3 shrink-0 text-muted-foreground" />
											<a
												href={`mailto:${caso.emailContacto}`}
												className="truncate hover:underline"
											>
												{caso.emailContacto}
											</a>
										</p>
									)}
									{caso.direccionContacto && (
										<p className="flex items-start gap-1.5 text-muted-foreground text-xs">
											<MapPin className="mt-0.5 h-3 w-3 shrink-0" />
											{caso.direccionContacto}
										</p>
									)}
								</div>

								{/* Las mismas acciones de la ficha: se puede gestionar desde acá sin
							    abrir el caso completo. */}
								{caso.id && (
									<div className="mt-3 flex flex-wrap gap-1.5 border-t pt-3">
										{CANALES.map(({ metodo, label, Icono, color }) => (
											<ContactoModal
												key={metodo}
												casoCobroId={caso.id as string}
												clienteNombre={caso.clienteNombre || ""}
												telefonoPrincipal={caso.telefonoPrincipal || ""}
												telefonoAlternativo={
													caso.telefonoAlternativo || undefined
												}
												emailCliente={caso.emailContacto || ""}
												metodoInicial={metodo}
												placa={caso.vehiculoPlaca || ""}
												marcaLineaModelo={`${caso.vehiculoMarca ?? ""} ${caso.vehiculoModelo ?? ""} ${caso.vehiculoYear ?? ""}`.trim()}
												cuotaMensual={Number(
													caso.cuotaMensual || 0,
												).toLocaleString()}
												cuotasAtraso={caso.cuotasVencidas ?? 0}
												estadoMora={caso.estadoMora || undefined}
												montoAdeudado={money(totalMes).replace("Q", "")}
												fechaPago={String(caso.diaPagoMensual || 15)}
												fechaInicio={caso.fechaInicio || null}
												nombreAsesor={caso.asesor?.nombre || ""}
												telefonoAsesor={caso.asesor?.telefono || ""}
											>
												<Button
													variant="outline"
													size="sm"
													className="h-8 text-xs"
												>
													<Icono className={`mr-1.5 h-3.5 w-3.5 ${color}`} />
													{label}
												</Button>
											</ContactoModal>
										))}
										{/* Promesa: solo cuando NO hay una vigente — editar la
										    activa es trabajo de ficha (CB-029), acá solo se
										    levanta una nueva. */}
										{!promesaActiva && (
											<ContactoModal
												casoCobroId={caso.id as string}
												clienteNombre={caso.clienteNombre || ""}
												telefonoPrincipal={caso.telefonoPrincipal || ""}
												telefonoAlternativo={
													caso.telefonoAlternativo || undefined
												}
												emailCliente={caso.emailContacto || ""}
												metodoInicial="llamada"
												variante="promesa"
												montoSugerido={totalMes}
												montoMora={Number(caso.montoEnMora ?? 0)}
												esConvenio={Number(caso.cuotaConvenio ?? 0) > 0}
												cuotaConvenio={
													Number(caso.cuotaConvenio ?? 0) > 0
														? Number(caso.cuotaConvenio)
														: undefined
												}
												placa={caso.vehiculoPlaca || ""}
												marcaLineaModelo={`${caso.vehiculoMarca ?? ""} ${caso.vehiculoModelo ?? ""} ${caso.vehiculoYear ?? ""}`.trim()}
												cuotaMensual={Number(
													caso.cuotaMensual || 0,
												).toLocaleString()}
												cuotasAtraso={caso.cuotasVencidas ?? 0}
												estadoMora={caso.estadoMora || undefined}
												montoAdeudado={money(totalMes).replace("Q", "")}
												fechaPago={String(caso.diaPagoMensual || 15)}
												fechaInicio={caso.fechaInicio || null}
												nombreAsesor={caso.asesor?.nombre || ""}
												telefonoAsesor={caso.asesor?.telefono || ""}
											>
												<Button
													variant="outline"
													size="sm"
													className="h-8 text-xs"
												>
													<HandCoins className="mr-1.5 h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
													Promesa
												</Button>
											</ContactoModal>
										)}
									</div>
								)}
							</div>

							{/* Contrato — los mismos datos de reojo de la ficha, para
							    decidir sin abrirla. */}
							<div className="rounded-lg border p-3">
								<div className="mb-2 flex items-center gap-2">
									<Banknote className="h-4 w-4 text-muted-foreground" />
									<span className="font-medium text-sm">Contrato</span>
								</div>
								<div className="grid grid-cols-2 gap-3">
									<Dato label="Asesor responsable">
										{caso.asesor?.nombre ?? "Sin asignar"}
									</Dato>
									<Dato label="Capital activo">
										{caso.montoFinanciado != null
											? money(caso.montoFinanciado)
											: "—"}
									</Dato>
									<Dato label="Día de pago">
										Día {caso.diaPagoMensual || 15} de cada mes
									</Dato>
									<Dato label="Fecha de inicio">
										{fechaGT(caso.fechaInicio)}
									</Dato>
									{caso.creditType && (
										<Dato label="Tipo de crédito">
											{caso.creditType === "autocompra"
												? "Autocompra"
												: "Sobre Vehículo"}
										</Dato>
									)}
									<Dato
										label="Próximo seguimiento"
										className={
											caso.proximoContacto &&
											new Date(caso.proximoContacto) < new Date()
												? "text-red-600 dark:text-red-400"
												: ""
										}
									>
										{caso.proximoContacto
											? fechaGT(caso.proximoContacto)
											: "Sin programar"}
									</Dato>
								</div>
							</div>

							{/* Alertas */}
							{alertas.length > 0 && (
								<div className="rounded-lg border border-amber-200 p-3 dark:border-amber-900/50">
									<div className="mb-2 flex items-center gap-2">
										<AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
										<span className="font-medium text-sm">Alertas</span>
										<Badge variant="secondary" className="ml-auto">
											{alertas.length}
										</Badge>
									</div>
									<ul className="space-y-1.5">
										{alertas.slice(0, 4).map((a) => (
											<li key={a.id} className="flex items-start gap-2 text-xs">
												<span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
												<span>
													{ALERTA_LABEL[a.cobrosTipo ?? ""] ?? a.titulo}
													{a.repeticiones > 1 && (
														<span className="text-muted-foreground">
															{" "}
															· {a.repeticiones} avisos
														</span>
													)}
												</span>
											</li>
										))}
									</ul>
								</div>
							)}

							{/* Promesa vigente — lo más accionable, igual que en la ficha. */}
							{promesaActiva && (
								<div className="rounded-lg border border-emerald-200 p-3 dark:border-emerald-900/50">
									<div className="mb-2 flex items-center gap-2">
										<HandCoins className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
										<span className="font-medium text-sm">Promesa de Pago</span>
										<Badge
											variant="outline"
											className="ml-auto border-transparent bg-amber-100 text-[10px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
										>
											Pendiente
										</Badge>
									</div>
									{promesaActiva.montoComprometido != null && (
										<p className="font-bold text-2xl text-emerald-700 dark:text-emerald-400">
											{money(promesaActiva.montoComprometido)}
										</p>
									)}
									<div className="mt-2 grid grid-cols-2 gap-3">
										<Dato label="Fecha compromiso">
											{fechaGT(promesaActiva.fechaProximoContacto)}
										</Dato>
										<Dato label="Responsable">
											{promesaActiva.realizadoPor ?? "—"}
										</Dato>
									</div>
								</div>
							)}
						</div>

						{/* Últimas gestiones */}
						{ultimos.length > 0 && (
							<div className="rounded-lg border p-3">
								<div className="mb-2 flex items-center gap-2">
									<Clock className="h-4 w-4 text-muted-foreground" />
									<span className="font-medium text-sm">Últimas gestiones</span>
								</div>
								<ul className="space-y-2">
									{ultimos.map((c) => (
										<li key={c.id} className="border-l-2 pl-2.5">
											<p className="flex flex-wrap items-center gap-1.5 text-xs">
												<span className="font-medium">{c.realizadoPor}</span>
												<span className="text-muted-foreground">
													· {fechaGT(c.fechaContacto)}
												</span>
												{ESTADO_GESTION[c.estadoContacto] && (
													<Badge
														className={`text-[10px] ${ESTADO_GESTION[c.estadoContacto].color}`}
													>
														{ESTADO_GESTION[c.estadoContacto].label}
													</Badge>
												)}
											</p>
											{c.comentarios && (
												<p className="line-clamp-2 text-muted-foreground text-xs">
													{c.comentarios}
												</p>
											)}
										</li>
									))}
								</ul>
							</div>
						)}
					</div>
				)}

				{/* La gestión real (registrar contacto, promesa, enviar mensajes) vive
				    en la Ficha 360: acá se decide, allá se ejecuta. */}
				<div className="flex items-center justify-between gap-2 border-t p-4">
					<Button variant="outline" onClick={onClose}>
						Cerrar
					</Button>
					<div className="flex gap-2">
						{/* La misma primaria de la ficha, un click antes. */}
						<Button
							variant="outline"
							disabled={!creditoId}
							onClick={() => {
								if (!creditoId) return;
								onClose();
								navigate({
									to: "/cobros/registrar-pago/$id",
									params: { id: creditoId },
									search: { tipo: "caso" },
								});
							}}
						>
							<Banknote className="mr-1 h-4 w-4" />
							Registrar Pago
						</Button>
						<Button onClick={abrirFicha} disabled={!creditoId}>
							<ExternalLink className="mr-1 h-4 w-4" />
							Abrir Ficha 360
						</Button>
					</div>
				</div>
			</SheetContent>
		</Sheet>
	);
}
