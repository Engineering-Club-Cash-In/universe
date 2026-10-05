import { ArrowRight, Check } from "lucide-react";
import type * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type AccionCrm, ActionCrm } from "./action-crm";

/**
 * BottomActionBar — Figma "03 · Componentes CRM › Bottom Action Bar" (98:984).
 * Acciones masivas sobre los créditos seleccionados de la Tabla de Cartera.
 *
 * Variante "Selección" de Figma → se deriva de `seleccionados` + `deshabilitado`:
 *   Ninguno       → seleccionados = 0  (mensaje de ayuda; acciones al 40 % y bloqueadas)
 *   Uno           → seleccionados = 1  ("1 crédito seleccionado")
 *   Varios        → seleccionados > 1  ("12 créditos seleccionados")
 *   Deshabilitado → `deshabilitado` (contador visible, acciones al 40 % y bloqueadas)
 * Booleanos de Figma (Reasignar · Escalar Bucket · Registrar gestión · Crear promesa)
 *   → `acciones`: lista de Action/CRM a mostrar. Por defecto, la de cada variante de Figma:
 *     Ninguno: registrar-gestion, crear-promesa
 *     Uno:     reasignar, registrar-gestion, crear-promesa
 *     Varios:  reasignar, escalar-bucket, registrar-gestion
 * Contenedor: neutral/900 en ambos modos (en oscuro sube a surface-raised para separarse
 * del lienzo), radius/lg, Elevation/Modal.
 */

const ACCIONES_POR_SELECCION: Record<
	"ninguno" | "uno" | "varios",
	AccionCrm[]
> = {
	ninguno: ["registrar-gestion", "crear-promesa"],
	uno: ["reasignar", "registrar-gestion", "crear-promesa"],
	varios: ["reasignar", "escalar-bucket", "registrar-gestion"],
};

type BottomActionBarProps = Omit<React.ComponentProps<"div">, "children"> & {
	/** Cantidad de créditos seleccionados. */
	seleccionados: number;
	/** Variante "Deshabilitado": hay selección pero no se puede actuar. */
	deshabilitado?: boolean;
	/** Acciones visibles (en orden). Por defecto, las de la variante de Figma. */
	acciones?: AccionCrm[];
	onAccion?: (accion: AccionCrm) => void;
	/** Acción en curso: ese botón muestra el estado Loading. */
	accionEnCurso?: AccionCrm | null;
	onLimpiarSeleccion?: () => void;
	/** Texto cuando no hay selección. */
	mensajeVacio?: React.ReactNode;
};

function BottomActionBar({
	seleccionados,
	deshabilitado = false,
	acciones,
	onAccion,
	accionEnCurso = null,
	onLimpiarSeleccion,
	mensajeVacio = "Seleccione créditos para ver las acciones disponibles",
	className,
	...props
}: BottomActionBarProps) {
	const seleccion =
		seleccionados <= 0 ? "ninguno" : seleccionados === 1 ? "uno" : "varios";
	const visibles = acciones ?? ACCIONES_POR_SELECCION[seleccion];
	const bloqueada = deshabilitado || seleccion === "ninguno";

	return (
		<div
			role="toolbar"
			aria-label="Acciones sobre los créditos seleccionados"
			data-slot="bottom-action-bar"
			data-seleccion={deshabilitado ? "deshabilitado" : seleccion}
			className={cn(
				"flex w-full items-center justify-between gap-4 rounded-2xl bg-cci-neutral-900 px-5 py-4 shadow-modal dark:bg-surface-raised",
				className,
			)}
			{...props}
		>
			<div className="flex min-w-0 items-center gap-3">
				{seleccion === "ninguno" ? (
					<p className="truncate font-medium text-[13px] text-cci-neutral-400 leading-[1.26]">
						{mensajeVacio}
					</p>
				) : (
					<>
						<span className="inline-flex h-4 min-w-7 shrink-0 items-center justify-center rounded-full bg-brand px-1.5 font-semibold text-[13px] text-on-brand tabular-nums leading-[1.26]">
							{seleccionados}
						</span>
						<p className="truncate font-semibold text-cci-neutral-0 text-sm leading-[1.26]">
							{seleccionados === 1
								? "1 crédito seleccionado"
								: `${seleccionados.toLocaleString("es-GT")} créditos seleccionados`}
						</p>
						{onLimpiarSeleccion ? (
							<button
								type="button"
								onClick={onLimpiarSeleccion}
								className="shrink-0 cursor-pointer rounded-sm font-medium text-[13px] text-cci-neutral-500 leading-[1.26] outline-none transition-colors hover:text-cci-neutral-300 focus-visible:ring-2 focus-visible:ring-ring"
							>
								Limpiar selección
							</button>
						) : null}
					</>
				)}
			</div>
			<fieldset
				disabled={bloqueada}
				className="m-0 flex min-w-0 shrink-0 items-center gap-2.5 border-0 p-0"
			>
				{visibles.map((accion) => (
					<ActionCrm
						key={accion}
						accion={accion}
						superficie="oscura"
						loading={accionEnCurso === accion}
						onClick={onAccion ? () => onAccion(accion) : undefined}
					/>
				))}
			</fieldset>
		</div>
	);
}

/**
 * ActionBarGestion — Figma "03 · Componentes CRM › Barra de acciones · Gestión",
 * ActionBar/Gestión (861:3268). Pie del flujo de registrar una gestión.
 *
 * Variante "Estado" de Figma → prop `estado`:
 *   Inicial    → "inicial"     [Registrar gestión (Primary, ancho completo)] [Abrir Ficha 360 (Ghost S)]
 *   Formulario → "formulario"  [Cancelar (Ghost)] [Guardar gestión (Primary, ancho completo)]
 *   Completado → "completado"  [✓ Gestión registrada (Ghost)] [Siguiente caso → (Primary)] [Abrir Ficha 360 (Ghost S)]
 * Ghost de Figma = Button variant "outline"; Primary = "default". `guardando` pone
 * "Guardar gestión" en Loading. "✓" y "→" de Figma se dibujan con lucide (Check, ArrowRight).
 */
type ActionBarGestionProps = Omit<React.ComponentProps<"div">, "children"> & {
	estado: "inicial" | "formulario" | "completado";
	onRegistrarGestion?: () => void;
	onAbrirFicha?: () => void;
	onCancelar?: () => void;
	onGuardar?: () => void;
	onVerGestion?: () => void;
	onSiguienteCaso?: () => void;
	/** Loading del botón "Guardar gestión". */
	guardando?: boolean;
	/** Deshabilita "Guardar gestión" (p. ej. formulario incompleto). */
	guardarDeshabilitado?: boolean;
	/** Oculta "Abrir Ficha 360" (cuando ya se está en la ficha). */
	ocultarFicha?: boolean;
};

function ActionBarGestion({
	estado,
	onRegistrarGestion,
	onAbrirFicha,
	onCancelar,
	onGuardar,
	onVerGestion,
	onSiguienteCaso,
	guardando = false,
	guardarDeshabilitado = false,
	ocultarFicha = false,
	className,
	...props
}: ActionBarGestionProps) {
	const ficha = ocultarFicha ? null : (
		<Button variant="outline" size="sm" onClick={onAbrirFicha}>
			Abrir Ficha 360
		</Button>
	);

	return (
		<div
			data-slot="action-bar-gestion"
			data-estado={estado}
			className={cn("flex w-full items-center gap-2.5 px-5 py-4", className)}
			{...props}
		>
			{estado === "inicial" ? (
				<>
					<Button className="min-w-0 flex-1" onClick={onRegistrarGestion}>
						Registrar gestión
					</Button>
					{ficha}
				</>
			) : null}
			{estado === "formulario" ? (
				<>
					<Button variant="outline" onClick={onCancelar} disabled={guardando}>
						Cancelar
					</Button>
					<Button
						className="min-w-0 flex-1"
						onClick={onGuardar}
						loading={guardando}
						disabled={guardarDeshabilitado}
					>
						Guardar gestión
					</Button>
				</>
			) : null}
			{estado === "completado" ? (
				<>
					<Button variant="outline" onClick={onVerGestion}>
						<Check />
						Gestión registrada
					</Button>
					<Button className="min-w-0 flex-1" onClick={onSiguienteCaso}>
						Siguiente caso
						<ArrowRight />
					</Button>
					{ficha}
				</>
			) : null}
		</div>
	);
}

export { ActionBarGestion, BottomActionBar };
export type { ActionBarGestionProps, BottomActionBarProps };
