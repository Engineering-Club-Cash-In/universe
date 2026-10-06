import { Link, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Banknote, Eye, FileText, MoreVertical } from "lucide-react";
import type * as React from "react";
import { useEffect, useState } from "react";
import { ContactoQuickAction } from "@/components/cobros/contacto-quick-action";
import {
	type Bucket,
	BucketBadge,
	type Mora,
	MoraBadge,
} from "@/components/ds/badges";
import {
	EstadoGestion,
	type EstadoGestionValor,
} from "@/components/ds/cartera-chips";
import {
	AccionPendiente,
	type AccionPendienteTipo,
	SinContacto,
} from "@/components/ds/indicadores";
import {
	type ColumnaCartera,
	columnasCartera,
	FilaCredito,
} from "@/components/ds/tabla-cartera";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { parseFechaLocal } from "@/lib/date-utils";
import type { client } from "@/utils/orpc";

/**
 * Pieza compartida del rediseño de cobros (Figma «CRM Ventas» › Asesor Junior /
 * Senior): Dashboard del asesor y Mi Cartera pintan la MISMA fila.
 *
 * - `FilaCartera` es una fila de `getTodosLosCreditos` (ya trae bucket del motor,
 *   deuda vencida, seguimiento, estado de gestión y acción pendiente).
 * - Clic en la fila → Ficha 360 (Figma). En la celda de acciones: "Llamar" y un
 *   menú ⋯ con "Vista rápida" (el panel de gestión rápida de siempre),
 *   "Registrar pago" y "Abrir Ficha 360".
 */

export type FilaCartera = Awaited<
	ReturnType<typeof client.getTodosLosCreditos>
>["data"][number];
export type FilaCola = Awaited<
	ReturnType<typeof client.getColaDia>
>["items"][number];
export type PerfilCobros = Awaited<ReturnType<typeof client.getMiPerfilCobros>>;

/* ── Traducciones dato → componente de Figma ─────────────────────────────── */

const BUCKETS: Bucket[] = ["B0", "B1", "B2", "B3", "B4", "B5"];

/** Bucket del motor; si cartera no lo mandó, se deriva de la etapa de mora. */
export function bucketDeFila(
	numero: number | null | undefined,
	estadoMora: string | null | undefined,
): Bucket | null {
	if (numero !== null && numero !== undefined) return BUCKETS[numero] ?? null;
	const porEstado: Record<string, Bucket> = {
		al_dia: "B0",
		mora_30: "B1",
		mora_60: "B2",
		mora_90: "B3",
		mora_120: "B4",
		mora_120_plus: "B5",
	};
	return estadoMora ? (porEstado[estadoMora] ?? null) : null;
}

export function moraDeEstado(
	estadoMora: string | null | undefined,
): Mora | null {
	const porEstado: Record<string, Mora> = {
		al_dia: "AlDia",
		mora_30: "Mora30",
		mora_60: "Mora60",
		mora_90: "Mora90",
		mora_120: "Mora120",
		mora_120_plus: "Mora120",
	};
	return estadoMora ? (porEstado[estadoMora] ?? null) : null;
}

function aFecha(valor: Date | string | null | undefined): Date | null {
	if (!valor) return null;
	if (valor instanceof Date) return valor;
	// "YYYY-MM-DD" de cartera = día calendario local, no medianoche UTC.
	return /^\d{4}-\d{2}-\d{2}$/.test(valor)
		? parseFechaLocal(valor)
		: new Date(valor);
}

/** "15 ago" */
export function fechaCorta(valor: Date | string | null | undefined) {
	const f = aFecha(valor);
	return f ? format(f, "d MMM", { locale: es }).replace(".", "") : "—";
}

/** "11 ago 2026" */
export function fechaLarga(valor: Date | string | null | undefined) {
	const f = aFecha(valor);
	return f ? format(f, "d MMM yyyy", { locale: es }).replace(".", "") : "";
}

function esHoy(valor: Date | string | null | undefined) {
	const f = aFecha(valor);
	return !!f && f.toDateString() === new Date().toDateString();
}

const ESTADO_GESTION: Record<string, EstadoGestionValor> = {
	sin_acuerdo: "Sin acuerdo",
	promesa_vigente: "Promesa vigente",
	promesa_incumplida: "Promesa incumplida",
	convenio_vigente: "Convenio vigente",
};

export function EstadoGestionCelda({ estado }: { estado: string }) {
	return <EstadoGestion estado={ESTADO_GESTION[estado] ?? "Sin acuerdo"} />;
}

type Seguimiento = FilaCartera["seguimiento"];

export function SeguimientoCelda({
	seguimiento,
}: {
	seguimiento: Seguimiento;
}) {
	if (seguimiento.contactadoHoy) {
		return (
			<span className="inline-flex items-center gap-2 font-semibold text-[13px] text-success-text leading-[1.26]">
				<span aria-hidden className="size-2 rounded-full bg-success-solid" />
				Contactado hoy
			</span>
		);
	}
	return (
		<SinContacto
			intentos={seguimiento.intentosSinContacto}
			ultimoIntento={
				seguimiento.ultimoIntentoEn
					? fechaLarga(seguimiento.ultimoIntentoEn)
					: undefined
			}
		/>
	);
}

type Accion = NonNullable<FilaCartera["accionPendiente"]>;

const ACCION: Record<
	Accion["tipo"],
	{ tipo: AccionPendienteTipo; titulo?: string; detalle: (f: string) => string }
> = {
	gestionar_sla: {
		tipo: "Sin intento",
		titulo: "Gestionar hoy",
		detalle: () => "vence el SLA hoy",
	},
	promesa_hoy: { tipo: "Promesa por vencer", detalle: () => "vence hoy" },
	llamar: { tipo: "Llamar", detalle: (f) => f },
	cuota_vence_hoy: {
		tipo: "Promesa por vencer",
		titulo: "Cuota vence hoy",
		detalle: () => "cobrar hoy",
	},
	promesa_vencida: {
		tipo: "Promesa vencida",
		detalle: (f) => (f ? `venció ${f}` : "vencida"),
	},
	promesa_por_vencer: {
		tipo: "Promesa por vencer",
		detalle: (f) => `vence ${f}`,
	},
	confirmar_pago: { tipo: "Confirmar pago", detalle: () => "recibido hoy" },
};

export function AccionPendienteCelda({ accion }: { accion: Accion | null }) {
	if (!accion) {
		return <span className="text-[13px] text-fg-tertiary">—</span>;
	}
	const def = ACCION[accion.tipo];
	const fecha = esHoy(accion.fecha) ? "hoy" : fechaCorta(accion.fecha);
	return (
		<AccionPendiente
			tipo={def.tipo}
			titulo={def.titulo}
			detalle={def.detalle(accion.fecha ? fecha : "")}
		/>
	);
}

/* ── Columnas ───────────────────────────────────────────────────────────────── */

/** Columna extra de acciones de la fila (no está en Table/Cartera de Figma). */
export const columnaAcciones: ColumnaCartera = {
	id: "acciones",
	etiqueta: <span className="sr-only">Acciones</span>,
	ancho: 84,
};

/** Columnas de Figma, en su orden, + acciones. */
export const COLUMNAS_ASESOR: ColumnaCartera[] = [
	columnasCartera.cliente,
	columnasCartera.bucket,
	columnasCartera.mora,
	columnasCartera.deuda,
	columnasCartera.cuota,
	columnasCartera.fecha,
	columnasCartera.seguimiento,
	columnasCartera.estado,
	columnasCartera.accion,
	columnaAcciones,
];

export type ColumnaOpcional = ColumnaCartera & {
	/** Columna después de la cual se inserta cuando se activa. */
	despuesDe: string;
};

/**
 * Selector de columnas de la toolbar (botón "Columnas" de Figma). Las de Figma
 * se pueden ocultar (salvo cliente y acciones) y las opcionales —datos que hoy
 * existen en el CRM y Figma no muestra— se pueden prender. Se recuerda por
 * navegador.
 */
export function useColumnasVisibles(
	clave: string,
	opcionales: ColumnaOpcional[],
	porDefecto: string[] = [],
) {
	const storageKey = `cobros/columnas/${clave}`;
	const [visibles, setVisibles] = useState<{
		ocultas: string[];
		extras: string[];
	}>(() => {
		try {
			const guardado = localStorage.getItem(storageKey);
			if (guardado) return JSON.parse(guardado);
		} catch {}
		return { ocultas: [], extras: porDefecto };
	});
	useEffect(() => {
		try {
			localStorage.setItem(storageKey, JSON.stringify(visibles));
		} catch {}
	}, [storageKey, visibles]);

	const columnas: ColumnaCartera[] = [];
	for (const c of COLUMNAS_ASESOR) {
		if (!visibles.ocultas.includes(c.id)) columnas.push(c);
		for (const o of opcionales) {
			if (o.despuesDe === c.id && visibles.extras.includes(o.id))
				columnas.push(o);
		}
	}

	const alternar = (id: string) =>
		setVisibles((v) => {
			if (opcionales.some((o) => o.id === id)) {
				return {
					...v,
					extras: v.extras.includes(id)
						? v.extras.filter((x) => x !== id)
						: [...v.extras, id],
				};
			}
			return {
				...v,
				ocultas: v.ocultas.includes(id)
					? v.ocultas.filter((x) => x !== id)
					: [...v.ocultas, id],
			};
		});

	const menu = (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<ToolbarButton action="columnas" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-60">
				<DropdownMenuLabel>Columnas del diseño</DropdownMenuLabel>
				{COLUMNAS_ASESOR.filter(
					(c) => c.id !== "cliente" && c.id !== "acciones",
				).map((c) => (
					<DropdownMenuCheckboxItem
						key={c.id}
						checked={!visibles.ocultas.includes(c.id)}
						onCheckedChange={() => alternar(c.id)}
						onSelect={(e) => e.preventDefault()}
					>
						{c.etiqueta}
					</DropdownMenuCheckboxItem>
				))}
				{opcionales.length > 0 ? (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuLabel>Más datos</DropdownMenuLabel>
						{opcionales.map((c) => (
							<DropdownMenuCheckboxItem
								key={c.id}
								checked={visibles.extras.includes(c.id)}
								onCheckedChange={() => alternar(c.id)}
								onSelect={(e) => e.preventDefault()}
							>
								{c.etiqueta}
							</DropdownMenuCheckboxItem>
						))}
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);

	return { columnas, menu };
}

/* ── Fila ───────────────────────────────────────────────────────────────────── */

const detener = (e: React.SyntheticEvent) => e.stopPropagation();

/** Id para /cobros/$id: SIFCO (o contrato) + si es caso o contrato. */
export function destinoFicha(fila: {
	numeroCredito: string | null;
	contratoId: string;
	casoCobroId: string | null;
}) {
	return {
		id: fila.numeroCredito || fila.contratoId,
		tipo: (fila.casoCobroId ? "caso" : "contrato") as "caso" | "contrato",
	};
}

export function AccionesFila({
	fila,
	onVistaRapida,
}: {
	fila: FilaCartera;
	onVistaRapida: (creditoId: string) => void;
}) {
	const destino = destinoFicha(fila);
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: solo evita que el clic llegue a la fila
		// biome-ignore lint/a11y/useKeyWithClickEvents: ídem
		<div className="flex items-center justify-end gap-1" onClick={detener}>
			{fila.numeroCredito ? (
				<ContactoQuickAction numeroCredito={fila.numeroCredito} />
			) : null}
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						aria-label="Más acciones"
						className="inline-flex size-8 cursor-pointer items-center justify-center rounded-lg text-fg-secondary hover:bg-muted hover:text-fg"
					>
						<MoreVertical className="size-4" />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onSelect={() => onVistaRapida(destino.id)}>
						<Eye /> Vista rápida
					</DropdownMenuItem>
					{fila.casoCobroId ? (
						<DropdownMenuItem asChild>
							<Link
								to="/cobros/registrar-pago/$id"
								params={{ id: destino.id }}
								search={{ tipo: "caso" }}
							>
								<Banknote /> Registrar pago
							</Link>
						</DropdownMenuItem>
					) : null}
					<DropdownMenuItem asChild>
						<Link
							to="/cobros/$id"
							params={{ id: destino.id }}
							search={{ tipo: destino.tipo }}
						>
							<FileText /> Abrir Ficha 360
						</Link>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

/** Fila de Figma (Cartera/FilaCrédito) armada desde una fila de cartera. */
export function FilaCreditoAsesor({
	fila,
	prioridad,
	extras,
	onVistaRapida,
}: {
	fila: FilaCartera;
	prioridad?: number;
	/** Celdas de las columnas opcionales, por id. */
	extras?: Record<string, React.ReactNode>;
	onVistaRapida: (creditoId: string) => void;
}) {
	const navigate = useNavigate();
	const bucket = bucketDeFila(fila.bucketNumero, fila.estadoMora);
	const mora = moraDeEstado(fila.estadoMora);
	// Cartera manda "N/A"/"-" cuando el crédito no tiene vehículo cargado.
	const conDato = (v: string | number | null | undefined) =>
		v !== null && v !== undefined && v !== "" && !/^(-|n\/a)$/i.test(String(v));
	const marcaModelo = [fila.vehiculoMarca, fila.vehiculoModelo].filter(conDato);
	const vehiculo = marcaModelo.length
		? [...marcaModelo, fila.vehiculoYear].filter(conDato).join(" ")
		: "";
	// Los créditos originados en el CRM traen "CRM-<uuid>": se acorta para que
	// la segunda línea no se coma la fila.
	const credito = fila.numeroCredito?.replace(
		/^(CRM-[0-9a-f]{8})-[0-9a-f-]{27}$/i,
		"$1",
	);
	const detalle = [vehiculo, fila.vehiculoPlaca, credito]
		.filter(conDato)
		.join(" · ");
	const destino = destinoFicha(fila);

	return (
		<FilaCredito
			prioridad={prioridad}
			className="cursor-pointer"
			onClick={() =>
				navigate({
					to: "/cobros/$id",
					params: { id: destino.id },
					search: { tipo: destino.tipo },
				})
			}
			cliente={fila.clienteNombre}
			detalle={detalle || undefined}
			bucket={bucket ? <BucketBadge bucket={bucket} /> : "—"}
			mora={
				fila.estadoMora === "en_convenio" ? (
					<span className="font-semibold text-[13px] text-success-text">
						En convenio
					</span>
				) : mora ? (
					<MoraBadge mora={mora} />
				) : (
					"—"
				)
			}
			deudaVencida={Number(fila.deudaVencida)}
			cuotaNormal={Number(fila.cuotaMensual)}
			fechaPago={fechaCorta(fila.fechaProximoPago)}
			seguimiento={<SeguimientoCelda seguimiento={fila.seguimiento} />}
			estadoGestion={<EstadoGestionCelda estado={fila.estadoGestion} />}
			accionPendiente={<AccionPendienteCelda accion={fila.accionPendiente} />}
			extras={{
				acciones: <AccionesFila fila={fila} onVistaRapida={onVistaRapida} />,
				...extras,
			}}
		/>
	);
}
