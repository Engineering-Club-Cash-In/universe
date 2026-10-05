import * as React from "react";
import { ActionBarGestion, BottomActionBar } from "@/components/ds/action-bars";
import {
	ACCIONES_CRM,
	type AccionCrm,
	ActionCrm,
	type ActionCrmTono,
} from "@/components/ds/action-crm";
import { ShowcaseGroup, type ShowcaseMeta, ShowcaseRow } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 170,
	title: "CRM · Acciones",
	figma:
		"03 · Componentes CRM › Botones de Acción CRM (Action/CRM) · Bottom Action Bar · Barra de acciones · Gestión (ActionBar/Gestión)",
	description:
		"ActionCrm: accion = registrar-gestion · crear-promesa · crear-convenio · reasignar · reestructurar · escalar-bucket · registrar-visita · recuperar-vehiculo; estados por CSS + disabled + loading. BottomActionBar: la variante sale de `seleccionados` (0 · 1 · varios) y `deshabilitado`. ActionBarGestion: estado = inicial · formulario · completado.",
};

// Hover y Pressed son :hover/:active; aquí se fijan con clases para verlos lado a lado.
const simulado: Record<ActionCrmTono, { hover: string; pressed: string }> = {
	primario: {
		hover: "bg-brand-hover",
		pressed:
			"bg-cci-primary-700 shadow-pressed hover:bg-cci-primary-700 dark:bg-cci-primary-200 dark:hover:bg-cci-primary-200",
	},
	secundario: {
		hover: "bg-cci-primary-100 dark:bg-cci-primary-800",
		pressed:
			"bg-cci-primary-200 shadow-pressed hover:bg-cci-primary-200 dark:bg-cci-primary-700 dark:hover:bg-cci-primary-700",
	},
	ghost: {
		hover: "bg-muted",
		pressed:
			"bg-cci-neutral-200 shadow-pressed hover:bg-cci-neutral-200 dark:bg-cci-carbon-750 dark:hover:bg-cci-carbon-750",
	},
	peligro: {
		hover: "bg-cci-danger-700",
		pressed: "bg-cci-danger-700 shadow-pressed hover:bg-cci-danger-700",
	},
};

const acciones = Object.keys(ACCIONES_CRM) as AccionCrm[];

export default function CrmActionsShowcase() {
	const [seleccion, setSeleccion] = React.useState(3);
	const [enCurso, setEnCurso] = React.useState<AccionCrm | null>(null);
	const [estado, setEstado] = React.useState<
		"inicial" | "formulario" | "completado"
	>("inicial");
	const [guardando, setGuardando] = React.useState(false);

	return (
		<div className="space-y-6">
			<ShowcaseGroup title="Action/CRM · Default · Hover · Pressed · Disabled · Loading">
				{acciones.map((accion) => {
					const tono = ACCIONES_CRM[accion].tono;
					return (
						<ShowcaseRow key={accion} label={accion}>
							<ActionCrm accion={accion} />
							<ActionCrm accion={accion} className={simulado[tono].hover} />
							<ActionCrm accion={accion} className={simulado[tono].pressed} />
							<ActionCrm accion={accion} disabled />
							<ActionCrm accion={accion} loading />
						</ShowcaseRow>
					);
				})}
			</ShowcaseGroup>

			<ShowcaseGroup title="Bottom Action Bar · Selección">
				<ShowcaseRow label="Ninguno (0)" className="block">
					<BottomActionBar seleccionados={0} />
				</ShowcaseRow>
				<ShowcaseRow label="Uno (1)" className="block">
					<BottomActionBar seleccionados={1} onLimpiarSeleccion={() => {}} />
				</ShowcaseRow>
				<ShowcaseRow label="Varios (12)" className="block">
					<BottomActionBar seleccionados={12} onLimpiarSeleccion={() => {}} />
				</ShowcaseRow>
				<ShowcaseRow label="Deshabilitado" className="block">
					<BottomActionBar
						seleccionados={12}
						deshabilitado
						onLimpiarSeleccion={() => {}}
					/>
				</ShowcaseRow>
				<ShowcaseRow label="Interactivo" className="block space-y-3">
					<BottomActionBar
						seleccionados={seleccion}
						accionEnCurso={enCurso}
						onLimpiarSeleccion={() => setSeleccion(0)}
						onAccion={(accion) => {
							setEnCurso(accion);
							window.setTimeout(() => setEnCurso(null), 1200);
						}}
					/>
					<div className="flex gap-2">
						{[0, 1, 3].map((n) => (
							<button
								key={n}
								type="button"
								onClick={() => setSeleccion(n)}
								className="type-label-sm cursor-pointer rounded-md border border-line px-2 py-1 text-fg-secondary hover:bg-muted"
							>
								Seleccionar {n}
							</button>
						))}
					</div>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="ActionBar/Gestión · Estado">
				<ShowcaseRow label="Inicial" className="block">
					<ActionBarGestion estado="inicial" className="max-w-205" />
				</ShowcaseRow>
				<ShowcaseRow label="Formulario" className="block">
					<ActionBarGestion estado="formulario" className="max-w-205" />
				</ShowcaseRow>
				<ShowcaseRow label="Completado" className="block">
					<ActionBarGestion estado="completado" className="max-w-205" />
				</ShowcaseRow>
				<ShowcaseRow label="Interactivo" className="block">
					<ActionBarGestion
						className="max-w-205"
						estado={estado}
						guardando={guardando}
						onRegistrarGestion={() => setEstado("formulario")}
						onCancelar={() => setEstado("inicial")}
						onGuardar={() => {
							setGuardando(true);
							window.setTimeout(() => {
								setGuardando(false);
								setEstado("completado");
							}, 1000);
						}}
						onSiguienteCaso={() => setEstado("inicial")}
					/>
				</ShowcaseRow>
			</ShowcaseGroup>
		</div>
	);
}
