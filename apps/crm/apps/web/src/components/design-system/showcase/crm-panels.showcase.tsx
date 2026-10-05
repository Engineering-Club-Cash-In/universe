import * as React from "react";
import { ActionCrm } from "@/components/ds/action-crm";
import {
	BucketBadge,
	ConvenioBadge,
	MoraBadge,
	PromesaBadge,
} from "@/components/ds/badges";
import {
	FichaAuditRow,
	FichaEditableRow,
	FichaSaveBar,
} from "@/components/ds/ficha-edicion";
import {
	type EstadoCredito,
	HeaderCredito,
} from "@/components/ds/header-credito";
import { PanelResumenCredito } from "@/components/ds/panel-resumen-credito";
import { ProximaAccionCell } from "@/components/ds/proxima-accion-cell";
import { ShowcaseGroup, type ShowcaseMeta, ShowcaseRow } from "./_layout";

export const meta: ShowcaseMeta = {
	order: 140,
	title: "CRM · Header, paneles y ficha",
	figma:
		"03 · Componentes CRM › Header · Crédito, Panel · Resumen del Crédito, Ficha · Edición",
	description:
		"HeaderCredito (Estado=Activo · EnRiesgo · Jurídico), PanelResumenCredito y Ficha/EditableRow · SaveBar · AuditRow (ds/header-credito, ds/panel-resumen-credito, ds/ficha-edicion).",
};

const estados: { estado: EstadoCredito; acciones: "todas" | "reasignar" }[] = [
	{ estado: "activo", acciones: "todas" },
	{ estado: "en-riesgo", acciones: "reasignar" },
	{ estado: "juridico", acciones: "todas" },
];

export default function CrmPanelsShowcase() {
	const [nombre, setNombre] = React.useState("Juan Pérez López");

	return (
		<div className="space-y-6">
			<ShowcaseGroup title="Header · Crédito">
				{estados.map(({ estado, acciones }) => (
					<div key={estado} className="space-y-2 py-3">
						<p className="type-label-sm text-fg-tertiary">
							Estado=
							{estado === "activo"
								? "Activo"
								: estado === "en-riesgo"
									? "EnRiesgo"
									: "Jurídico"}
						</p>
						<HeaderCredito
							estado={estado}
							cliente="María José Contreras"
							iniciales="MC"
							numeroCredito="48213"
							bucket={<BucketBadge bucket="B2" formato="Completa" />}
							mora={<MoraBadge mora="Mora60" />}
							acciones={
								<>
									<ActionCrm accion="reasignar" />
									{acciones === "todas" ? (
										<>
											<ActionCrm accion="crear-promesa" />
											<ActionCrm accion="registrar-gestion" />
										</>
									) : null}
								</>
							}
							asesor="Carlos Ramírez"
							saldo="Q 48,250.00"
							fechaPago="15 de cada mes"
							diasMora={62}
							ultimaActualizacion="11 jul 2026 · 14:32"
						/>
					</div>
				))}
			</ShowcaseGroup>

			<ShowcaseGroup title="Panel · Resumen del crédito">
				<ShowcaseRow label="Default · sin datos" className="items-start gap-6">
					<PanelResumenCredito
						className="w-85"
						numeroCredito="48213"
						bucket={<BucketBadge bucket="B2" formato="Completa" />}
						mora={<MoraBadge mora="Mora60" />}
						proximaAccion={<ProximaAccionCell accion="Llamar" />}
						promesa={<PromesaBadge promesa="Pendiente" />}
						saldo="Q 48,250.00"
						convenio={<ConvenioBadge convenio="Activo" />}
						responsable="C. Ramírez"
						ultimaGestion="hace 3 días"
					/>
					<PanelResumenCredito
						className="w-85"
						numeroCredito="51007"
						bucket={<BucketBadge bucket="B0" formato="Completa" />}
						mora={<MoraBadge mora="AlDia" />}
						proximaAccion={<ProximaAccionCell accion="Ninguna" />}
						saldo="Q 12,480.00"
						responsable="A. Gómez"
						ultimaGestion="hoy"
					/>
				</ShowcaseRow>
			</ShowcaseGroup>

			<ShowcaseGroup title="Ficha · Edición">
				<ShowcaseRow label="EditableRow · Modo" className="items-start gap-10">
					<FichaEditableRow
						className="w-80"
						etiqueta="Etiqueta"
						valor="Valor del campo"
					/>
					<FichaEditableRow
						className="w-80"
						modo="edicion"
						etiqueta="Valor del campo"
						valor={nombre}
						onValorChange={setNombre}
					/>
					<FichaEditableRow
						className="w-80"
						etiqueta="Correo electrónico"
						valor=""
					/>
				</ShowcaseRow>
				<ShowcaseRow label="SaveBar · Estado" className="flex-col items-start">
					<FichaSaveBar className="max-w-180" cambios={3} />
					<FichaSaveBar
						className="max-w-180"
						estado="guardando"
						mensaje="3 cambios sin guardar"
					/>
				</ShowcaseRow>
				<ShowcaseRow label="AuditRow" className="block">
					<div className="max-w-250">
						<FichaAuditRow
							campo="Teléfono principal"
							categoria="Contacto"
							antes="5555-1234"
							despues="5555-9999"
							autor="Ana G. (asesor)"
							fechaOrigen="15 jul 2026 · 09:14 · Ficha 360"
						/>
						<FichaAuditRow
							campo="Correo electrónico"
							categoria="Contacto"
							despues="mjcontreras@correo.com"
							autor="Carlos Ramírez (supervisor)"
							fechaOrigen="14 jul 2026 · 16:02 · Ficha 360"
						/>
					</div>
				</ShowcaseRow>
			</ShowcaseGroup>
		</div>
	);
}
