import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight, Link2, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import {
	CrmCard,
	CrmDataField,
	CrmDivider,
	CrmPill,
	type CrmTone,
	crmText,
} from "@/components/ds/cards-credito";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { type client, orpc } from "@/utils/orpc";

/**
 * Ficha 360 · Card «Créditos relacionados» (Figma, columna derecha del
 * Resumen): otros créditos del titular, de sus codeudores o de una
 * referencia, por teléfono o por nombre exacto.
 *
 * Si el usuario trabaja ese crédito (mismo gate que la ficha) el clic abre su
 * Ficha 360; si no, un modal con un resumen del crédito.
 */

type CreditoRelacionado = Awaited<
	ReturnType<typeof client.getCreditosRelacionados>
>[number];
type EstadoCartera = CreditoRelacionado["estado"];
type Motivo = CreditoRelacionado["motivos"][number];

type Persona = CreditoRelacionado["personas"][number];

const sinTildes = (t: string) =>
	t
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/\s+/g, " ")
		.trim();

/**
 * «como Juan Pérez» cuando en el otro crédito figura con otro nombre (match
 * por teléfono de una referencia, p. ej.); null si es el mismo.
 */
function comoAlla(p: Persona): string | null {
	return sinTildes(p.nombre) === sinTildes(p.nombreAlla)
		? null
		: `como ${p.nombreAlla}`;
}

/** Papel de la persona en el caso que se está viendo (chip de la fila). */
const ROL_AQUI = {
	titular: "Titular aquí",
	codeudor: "Codeudor aquí",
	referencia: "Referencia aquí",
};
/** Papel de la persona en el crédito relacionado (línea bajo el nombre). */
const ROL_EN = { titular: "Titular en", codeudor: "Codeudor en" };

const ESTADOS_CREDITO: Record<string, string> = {
	ACTIVO: "Activo",
	MOROSO: "Moroso",
	CANCELADO: "Cancelado",
	PENDIENTE_CANCELACION: "Pendiente de cancelación",
	INCOBRABLE: "Incobrable",
	EN_CONVENIO: "En convenio",
	CAIDO: "Caído",
	EN_RECUPERACION: "En recuperación",
	EN_JURIDICO: "En jurídico",
};

/** Estado de cartera legible; uno nuevo sin traducir sale tal cual, sin "_". */
function estadoCreditoLegible(status: string): string {
	if (ESTADOS_CREDITO[status]) return ESTADOS_CREDITO[status];
	const texto = status.replace(/_/g, " ").toLowerCase();
	return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Sin bucket (fuera del funnel: cancelado, pendiente de cancelación, etc.) se
 * muestra el estado del crédito cuando se conoce; en la lista no viene, y
 * queda «Sin bucket asignado».
 */
function estadoPill(
	estado: EstadoCartera,
	statusCredito?: string | null,
): { tono: CrmTone; texto: string } | null {
	if (!estado) return null;
	if (estado.fueraFunnel || estado.bucket === null) {
		return {
			tono: "neutral",
			texto: statusCredito
				? estadoCreditoLegible(statusCredito)
				: "Sin bucket asignado",
		};
	}
	if (estado.bucket === 0) return { tono: "success", texto: "Al día" };
	return {
		tono: estado.bucket >= 3 ? "danger" : "warning",
		texto: [estado.prefijo, estado.nombre].filter(Boolean).join(" · "),
	};
}

function textoVehiculo(v: CreditoRelacionado["vehiculo"]): string | null {
	if (!v) return null;
	return [v.marca, v.modelo, v.anio].filter(Boolean).join(" ");
}

const ORIGEN_MOTIVO = {
	titular: "titular",
	codeudor: "codeudor",
	referencia: "referencia",
};

function textoMotivo(m: Motivo): string {
	const por = m.tipo === "telefono" ? "Mismo teléfono" : "Mismo nombre";
	return `${por} que ${m.origen === "referencia" ? "la" : "el"} ${ORIGEN_MOTIVO[m.origen]} (${m.persona})`;
}

/** Línea de motivo bajo la fila: referencia o posible homónimo. */
function notaFila(c: CreditoRelacionado): string | null {
	if (c.soloPorNombre) return "Posible coincidencia por nombre";
	const referencia = c.motivos.find((m) => m.origen === "referencia");
	if (referencia && c.motivos.every((m) => m.origen === "referencia")) {
		return `Referencia: ${referencia.persona}`;
	}
	return null;
}

export function CardCreditosRelacionados({
	casoCobroId,
}: {
	casoCobroId: string;
}) {
	const navigate = useNavigate();
	const [seleccionado, setSeleccionado] = useState<CreditoRelacionado | null>(
		null,
	);
	const relacionados = useQuery({
		...orpc.getCreditosRelacionados.queryOptions({ input: { casoCobroId } }),
		enabled: !!casoCobroId,
		staleTime: 5 * 60 * 1000,
	});

	const abrir = (c: CreditoRelacionado) => {
		if (!c.puedeAbrir) {
			setSeleccionado(c);
			return;
		}
		navigate({
			to: "/cobros/$id",
			// Por número de crédito: es lo que el asesor reconoce en la URL.
			params: { id: c.numeroSifco },
			search: { tipo: "caso" },
		});
	};

	const creditos = relacionados.data ?? [];

	return (
		<CrmCard superficie="outline">
			<div className="flex flex-col gap-0.5">
				<div className="flex items-center gap-2">
					<span className="flex shrink-0 text-fg-secondary [&_svg]:size-4">
						<Link2 aria-hidden />
					</span>
					<h3 className={crmText.title}>Créditos relacionados</h3>
				</div>
				<p className={crmText.label}>
					Otros créditos del titular o sus codeudores
				</p>
			</div>

			{relacionados.isLoading ? (
				<p className={cn(crmText.label, "flex items-center gap-2")}>
					<Loader2 className="size-3.5 animate-spin" aria-hidden />
					Buscando créditos relacionados…
				</p>
			) : relacionados.isError ? (
				<p className={crmText.label}>
					No se pudieron cargar los créditos relacionados.
				</p>
			) : creditos.length === 0 ? (
				<p className={crmText.label}>Sin créditos relacionados.</p>
			) : (
				<ul className="flex flex-col">
					{creditos.map((c, i) => {
						const persona = c.personas[0];
						const pill = estadoPill(c.estado);
						const vehiculo = textoVehiculo(c.vehiculo);
						const nota = notaFila(c);
						return (
							<li key={c.numeroSifco}>
								{i > 0 ? <CrmDivider className="my-1" /> : null}
								<button
									type="button"
									onClick={() => abrir(c)}
									className="flex w-full items-center gap-2 rounded-lg px-1 py-2 text-left hover:bg-muted"
									title={
										c.puedeAbrir
											? "Abrir la Ficha 360 de este crédito"
											: "Ver el resumen de este crédito"
									}
								>
									<div className="flex min-w-0 flex-1 flex-col gap-0.5">
										<div className="flex min-w-0 flex-wrap items-center gap-1.5">
											<span className={cn(crmText.value, "truncate")}>
												{persona?.nombre ?? c.titularNombre}
											</span>
											{persona ? (
												<CrmPill tone="neutral" kind="chip" dot={false}>
													{ROL_AQUI[persona.rolAqui]}
												</CrmPill>
											) : null}
										</div>
										<span className={cn(crmText.label, "truncate")}>
											{[
												persona
													? [
															`${ROL_EN[persona.rolAlla]} #${c.numeroSifco}`,
															comoAlla(persona),
														]
															.filter(Boolean)
															.join(" ")
													: `#${c.numeroSifco}`,
												vehiculo,
											]
												.filter(Boolean)
												.join(" · ")}
										</span>
										{nota ? (
											<span className="text-[11px] text-warning-text">
												{nota}
											</span>
										) : null}
									</div>
									{pill ? (
										<CrmPill tone={pill.tono} dot={false}>
											{pill.texto}
										</CrmPill>
									) : null}
									<ChevronRight
										className="size-4 shrink-0 text-fg-secondary"
										aria-hidden
									/>
								</button>
							</li>
						);
					})}
				</ul>
			)}

			<DialogResumenCreditoRelacionado
				casoCobroId={casoCobroId}
				credito={seleccionado}
				onClose={() => setSeleccionado(null)}
			/>
		</CrmCard>
	);
}

const fmtQ = (v: string | number | null | undefined) => {
	const n = v == null || v === "" ? Number.NaN : Number(v);
	if (Number.isNaN(n)) return "—";
	return `Q${n.toLocaleString("es-GT", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;
};

const fmtFecha = (f: string | null | undefined) =>
	f
		? new Date(`${f.slice(0, 10)}T12:00:00`).toLocaleDateString("es-GT", {
				day: "2-digit",
				month: "2-digit",
				year: "numeric",
			})
		: "—";

/** Modal de un crédito relacionado que el usuario no tiene asignado. */
function DialogResumenCreditoRelacionado({
	casoCobroId,
	credito,
	onClose,
}: {
	casoCobroId: string;
	credito: CreditoRelacionado | null;
	onClose: () => void;
}) {
	// Al cerrar, `credito` pasa a null pero el diálogo sigue visible durante la
	// animación de salida: se sigue pintando el último que se abrió.
	const ultimo = useRef(credito);
	if (credito) ultimo.current = credito;
	const mostrado = credito ?? ultimo.current;
	const resumen = useQuery({
		...orpc.getResumenCreditoRelacionado.queryOptions({
			input: { casoCobroId, numeroSifco: mostrado?.numeroSifco ?? "" },
		}),
		enabled: !!credito,
		staleTime: 60 * 1000,
	});
	const data = resumen.data;
	const cartera = data?.cartera ?? null;
	const pill = estadoPill(
		data?.estado ?? mostrado?.estado ?? null,
		data?.cartera?.statusCredito,
	);
	const vehiculo = textoVehiculo(data?.vehiculo ?? mostrado?.vehiculo ?? null);

	return (
		<Dialog open={!!credito} onOpenChange={(abierto) => !abierto && onClose()}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle className="flex flex-wrap items-center gap-2">
						Crédito #{mostrado?.numeroSifco}
						{pill ? (
							<CrmPill tone={pill.tono} dot={false}>
								{pill.texto}
							</CrmPill>
						) : null}
					</DialogTitle>
					<DialogDescription>
						No tiene asignado este crédito. Para gestionarlo, coordine con el
						asesor responsable.
					</DialogDescription>
				</DialogHeader>

				{resumen.isLoading ? (
					<p className={cn(crmText.label, "flex items-center gap-2")}>
						<Loader2 className="size-3.5 animate-spin" aria-hidden />
						Cargando resumen…
					</p>
				) : resumen.isError ? (
					<p className={crmText.label}>
						No se pudo cargar el resumen del crédito.
					</p>
				) : data ? (
					<div className="flex flex-col gap-4">
						<div className="grid grid-cols-2 gap-3">
							<CrmDataField label="Titular">{data.titularNombre}</CrmDataField>
							<CrmDataField label="Vehículo">
								{[vehiculo, data.vehiculo?.placa].filter(Boolean).join(" · ") ||
									"—"}
							</CrmDataField>
							<CrmDataField label="Asesor responsable">
								{data.asesorNombre ?? "Sin asignar"}
							</CrmDataField>
							<CrmDataField label="Relación con este caso">
								{data.personas
									.map(
										(p) =>
											`${p.nombre} (${ROL_AQUI[p.rolAqui].toLowerCase()}; ${[
												`${ROL_EN[p.rolAlla].toLowerCase()} este crédito`,
												comoAlla(p),
											]
												.filter(Boolean)
												.join(" ")})`,
									)
									.join(", ")}
							</CrmDataField>
						</div>
						<CrmDivider />
						{cartera ? (
							<div className="grid grid-cols-2 gap-3">
								<CrmDataField label="Estado del crédito">
									{estadoCreditoLegible(cartera.statusCredito)}
									{cartera.enConvenio ? " · En convenio" : ""}
								</CrmDataField>
								<CrmDataField label="Cuota mensual">
									{fmtQ(cartera.cuotaMensual)}
								</CrmDataField>
								<CrmDataField label="Capital pendiente">
									{fmtQ(cartera.capitalActivo)}
								</CrmDataField>
								<CrmDataField label="Cuotas pagadas">
									{`${cartera.cuotasPagadas} de ${cartera.plazo}`}
								</CrmDataField>
								<CrmDataField label="Cuotas vencidas">
									{cartera.cuotasAtrasadas}
								</CrmDataField>
								<CrmDataField label="Mora">
									{cartera.moraPorConfirmar
										? "Por confirmar"
										: fmtQ(cartera.moraMonto ?? 0)}
								</CrmDataField>
								<CrmDataField label="Cuota más antigua sin pagar">
									{cartera.cuotaActual
										? `${cartera.cuotaActual.numero} · ${fmtFecha(cartera.cuotaActual.fechaVencimiento)}`
										: "—"}
								</CrmDataField>
								<CrmDataField label="Próxima fecha de pago">
									{fmtFecha(cartera.proximaFechaPago)}
								</CrmDataField>
							</div>
						) : (
							<p className={crmText.label}>
								Cartera no tiene datos de este crédito en este momento.
							</p>
						)}
						<CrmDivider />
						<ul className={cn(crmText.label, "flex flex-col gap-0.5")}>
							{data.motivos.map((m) => (
								<li key={`${m.tipo}-${m.origen}-${m.persona}`}>
									{textoMotivo(m)}
								</li>
							))}
						</ul>
					</div>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
