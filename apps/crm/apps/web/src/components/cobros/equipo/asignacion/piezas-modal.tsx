import { ArrowRight, Check } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { DialogIcon, dialogTitleClassName } from "@/components/ui/dialog";
import { RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { AvatarMini } from "./carga-resumen-vista";

/**
 * Piezas compartidas por los modales de «Mi equipo» (Marcar ausente,
 * Trasladar cartera y Asesor reactivado), con el lenguaje del Figma «09 ·
 * Disponibilidad y redistribución»:
 *   - `NotaModal`: caja plana de color (azul informativa, amarilla «Fin:
 *     indefinido», verde «Se notificó al equipo», roja de bloqueo).
 *   - `TarjetaOpcion`: opción de radio en tarjeta (qué pasa con la cartera,
 *     cómo se reparte).
 *   - `ListaReparto`: la lista «28 → 32 +4» de «Redistribución de cartera»
 *     (3360:4254) con «y 3 asesores más…».
 *   - `ExitoModal`: «Cartera redistribuida» (3360:4312) y «Asesor reactivado»
 *     (3366:4235): ícono, título, texto, nota verde y «Entendido».
 */

/** Flecha «antes → después» (la de la fuente sale diminuta). Decorativa. */
export function Flecha({ className }: { className?: string }) {
	return (
		<ArrowRight
			aria-hidden
			className={cn(
				"inline size-3.5 shrink-0 align-[-2px] text-fg-tertiary",
				className,
			)}
		/>
	);
}

export function plural(n: number, uno: string, varios: string) {
	return `${n.toLocaleString("es-GT")} ${n === 1 ? uno : varios}`;
}

/* ── Nota ─────────────────────────────────────────────────────────────── */

export type TonoNota = "info" | "warning" | "success" | "danger" | "neutral";

const CAJA: Record<TonoNota, string> = {
	info: "bg-info-subtle text-info-text",
	warning: "bg-warning-subtle text-warning-text",
	success: "bg-success-subtle text-success-text",
	danger: "bg-danger-subtle text-danger-text",
	neutral: "bg-canvas text-fg-secondary",
};

const PUNTO: Record<TonoNota, string> = {
	info: "bg-info-solid",
	warning: "bg-warning-solid",
	success: "bg-success-solid",
	danger: "bg-danger-solid",
	neutral: "bg-fg-tertiary",
};

/** Caja plana del Figma: título opcional, texto y un ícono o un punto. */
export function NotaModal({
	tono = "info",
	titulo,
	icono,
	punto = false,
	role,
	className,
	children,
}: {
	tono?: TonoNota;
	titulo?: ReactNode;
	/** Ícono de lucide (16px) a la izquierda. */
	icono?: ReactNode;
	/** Punto de color a la izquierda (Figma «● Se notificó al equipo»). */
	punto?: boolean;
	role?: "alert" | "status" | "note";
	className?: string;
	children?: ReactNode;
}) {
	return (
		<div
			role={role}
			className={cn(
				"flex gap-2.5 rounded-xl px-3.5 py-3 text-[13px] leading-[1.4]",
				CAJA[tono],
				className,
			)}
		>
			{punto ? (
				<span
					aria-hidden
					className={cn("mt-1.25 size-2 shrink-0 rounded-full", PUNTO[tono])}
				/>
			) : icono ? (
				<span aria-hidden className="mt-px shrink-0 [&_svg]:size-4">
					{icono}
				</span>
			) : null}
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				{titulo ? <p className="font-semibold">{titulo}</p> : null}
				{children ? <div className="min-w-0">{children}</div> : null}
			</div>
		</div>
	);
}

/* ── Opción en tarjeta ────────────────────────────────────────────────── */

/** Opción de un RadioGroup como tarjeta: título, una línea que la explica y una nota. */
export function TarjetaOpcion({
	id,
	valor,
	titulo,
	detalle,
	nota,
	activo,
	disabled,
	className,
}: {
	id: string;
	valor: string;
	titulo: ReactNode;
	detalle: ReactNode;
	/** Por qué no está disponible, p. ej. */
	nota?: ReactNode;
	activo: boolean;
	disabled?: boolean;
	className?: string;
}) {
	return (
		<label
			htmlFor={id}
			className={cn(
				"flex min-w-0 cursor-pointer gap-2.5 rounded-xl border px-3.5 py-3 transition-colors duration-150 has-disabled:cursor-not-allowed",
				activo
					? "border-brand bg-brand-subtle"
					: "border-line bg-surface hover:bg-muted/60 has-disabled:hover:bg-surface",
				className,
			)}
		>
			<RadioGroupItem
				id={id}
				value={valor}
				disabled={disabled}
				className="mt-px"
			/>
			<span
				className={cn(
					"flex min-w-0 flex-col gap-0.5",
					disabled && "opacity-50",
				)}
			>
				<span className="font-semibold text-[13px] text-fg leading-[1.26]">
					{titulo}
				</span>
				<span className="text-fg-secondary text-xs leading-[1.35]">
					{detalle}
				</span>
				{nota ? (
					<span className="text-fg-tertiary text-xs leading-[1.35]">
						{nota}
					</span>
				) : null}
			</span>
		</label>
	);
}

/* ── Lista «antes → después +N» ───────────────────────────────────────── */

export type FilaReparto = {
	clave: string | number;
	nombre: string;
	antes: number;
	despues: number;
	/** Segunda línea (buckets, promesas, aviso de capacidad…). */
	detalle?: ReactNode;
	/** Queda por encima de su capacidad: la fila se marca en rojo. */
	alerta?: boolean;
};

/** «Carlos Ramírez · 28 → 32 · +4», con «y N asesores más…» (Figma 3360:4254). */
export function ListaReparto({
	filas,
	visibles = 6,
}: {
	filas: FilaReparto[];
	visibles?: number;
}) {
	const [todas, setTodas] = useState(false);
	const mostradas = todas ? filas : filas.slice(0, visibles);
	const ocultas = filas.length - mostradas.length;
	return (
		<div className="flex flex-col">
			<ul className="flex flex-col divide-y divide-divider">
				{mostradas.map((f) => {
					const suma = f.despues - f.antes;
					return (
						<li key={f.clave} className="flex items-center gap-3 py-2.5">
							<AvatarMini nombre={f.nombre} />
							<div className="flex min-w-0 flex-1 flex-col gap-0.5">
								<span className="truncate font-medium text-fg text-sm leading-[1.26]">
									{f.nombre}
								</span>
								{f.detalle ? (
									<span
										className={cn(
											"text-[11px] leading-[1.3]",
											f.alerta ? "text-danger-text" : "text-fg-tertiary",
										)}
									>
										{f.detalle}
									</span>
								) : null}
							</div>
							<span className="shrink-0 text-[13px] text-fg-secondary tabular-nums leading-[1.26]">
								<span aria-hidden>
									{f.antes.toLocaleString("es-GT")} <Flecha />{" "}
									{f.despues.toLocaleString("es-GT")}
								</span>
								<span className="sr-only">
									de {f.antes} a {f.despues} créditos
								</span>
							</span>
							<span
								className={cn(
									"shrink-0 rounded-full px-2 py-0.75 font-semibold text-xs tabular-nums leading-[1.26]",
									f.alerta
										? "bg-danger-subtle text-danger-text"
										: "bg-success-subtle text-success-text",
								)}
							>
								{suma >= 0 ? "+" : "−"}
								{Math.abs(suma).toLocaleString("es-GT")}
							</span>
						</li>
					);
				})}
			</ul>
			{ocultas > 0 || todas ? (
				<button
					type="button"
					onClick={() => setTodas((v) => !v)}
					className="mt-1 w-fit cursor-pointer rounded-sm text-fg-tertiary text-xs leading-[1.26] outline-none hover:text-fg-secondary hover:underline focus-visible:ring-2 focus-visible:ring-ring"
				>
					{todas
						? "Ver menos"
						: `y ${plural(ocultas, "asesor", "asesores")} más…`}
				</button>
			) : null}
		</div>
	);
}

/* ── Éxito ────────────────────────────────────────────────────────────── */

/**
 * Pantalla de éxito del Figma (3360:4312 / 3366:4235) dentro de la caja del
 * modal: ícono verde, título, texto, una nota verde opcional y «Entendido».
 */
export function ExitoModal({
	titulo,
	extra,
	nota,
	etiqueta = "Entendido",
	onListo,
	children,
}: {
	titulo: ReactNode;
	/** Contenido entre el texto y la nota verde (p. ej. lo que no se devolvió). */
	extra?: ReactNode;
	/** Nota verde con punto (p. ej. «Se notificó al equipo por el sistema»). */
	nota?: ReactNode;
	etiqueta?: string;
	onListo: () => void;
	children: ReactNode;
}) {
	return (
		<output className="flex min-w-0 flex-col gap-5">
			<DialogIcon className="bg-success-subtle text-success-solid">
				<Check strokeWidth={3} className="size-5" />
			</DialogIcon>
			<div className="flex flex-col gap-2">
				<h2 className={cn(dialogTitleClassName, "pr-10 text-xl")}>{titulo}</h2>
				<div className="text-fg-secondary text-sm leading-[1.45]">
					{children}
				</div>
			</div>
			{extra}
			{nota ? (
				<NotaModal tono="success" punto>
					{nota}
				</NotaModal>
			) : null}
			<Button className="w-full" onClick={onListo}>
				{etiqueta}
			</Button>
		</output>
	);
}
