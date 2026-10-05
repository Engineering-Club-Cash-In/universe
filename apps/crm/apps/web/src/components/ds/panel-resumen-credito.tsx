import type * as React from "react";

import { cn } from "@/lib/utils";
import { CrmCard, CrmDivider, crmText } from "./cards-credito";

/**
 * PanelResumenCredito — Figma "03 · Componentes CRM › Panel · Resumen del Crédito",
 * Panel/ResumenCrédito (138:1780). Una sola variante.
 *
 * Resumen compacto: Bucket, mora, próxima acción, promesa, saldo, convenio,
 * responsable y última gestión. Filas etiqueta (12/400 terciaria) ↔ valor a la
 * derecha, gap 12. Los badges entran como `React.ReactNode`:
 *   bucket        → <BucketBadge bucket="B2" formato="Completa" />
 *   mora          → <MoraBadge mora="Mora60" />
 *   proximaAccion → Cell/PróximaAcción (pill con ícono)
 *   promesa       → <PromesaBadge promesa="Pendiente" />
 *   convenio      → <ConvenioBadge convenio="Activo" />
 * Un valor `null`/`undefined` se muestra como "—" (p. ej. sin promesa activa).
 *
 * Desvíos: ancho fluido (Figma: 340 fijo).
 */

export type PanelResumenCreditoProps = Omit<
	React.ComponentProps<"article">,
	"children"
> & {
	titulo?: React.ReactNode;
	/** Número de crédito sin "#": "48213". */
	numeroCredito?: React.ReactNode;
	bucket?: React.ReactNode;
	mora?: React.ReactNode;
	proximaAccion?: React.ReactNode;
	promesa?: React.ReactNode;
	/** "Q 48,250.00" (14/700). */
	saldo?: React.ReactNode;
	convenio?: React.ReactNode;
	responsable?: React.ReactNode;
	/** "hace 3 días". */
	ultimaGestion?: React.ReactNode;
};

function Fila({
	label,
	children,
	valueClassName,
}: {
	label: React.ReactNode;
	children: React.ReactNode;
	valueClassName?: string;
}) {
	const vacio = children === null || children === undefined || children === "";
	return (
		<div className="flex min-h-5 items-center justify-between gap-3">
			<dt className="shrink-0 text-fg-tertiary text-xs leading-[1.26]">
				{label}
			</dt>
			<dd
				className={cn(
					"flex min-w-0 justify-end text-right text-xs leading-[1.26]",
					vacio ? "text-fg-tertiary" : valueClassName,
				)}
			>
				{vacio ? "—" : children}
			</dd>
		</div>
	);
}

export function PanelResumenCredito({
	titulo = "Resumen del crédito",
	numeroCredito,
	bucket,
	mora,
	proximaAccion,
	promesa,
	saldo,
	convenio,
	responsable,
	ultimaGestion,
	...props
}: PanelResumenCreditoProps) {
	return (
		<CrmCard data-slot="panel-resumen-credito" {...props}>
			<div className="flex items-center justify-between gap-2">
				<h3 className={crmText.title}>{titulo}</h3>
				{numeroCredito != null ? (
					<span className="font-medium text-fg-tertiary text-xs leading-[1.26]">
						#{numeroCredito}
					</span>
				) : null}
			</div>
			<CrmDivider />
			<dl className="flex flex-col gap-3">
				<Fila label="Bucket">{bucket}</Fila>
				<Fila label="Estado de mora">{mora}</Fila>
				<Fila label="Próxima acción">{proximaAccion}</Fila>
				<Fila label="Promesa activa">{promesa}</Fila>
				<Fila
					label="Saldo pendiente"
					valueClassName="font-bold text-fg text-sm"
				>
					{saldo}
				</Fila>
				<Fila label="Convenio activo">{convenio}</Fila>
				<Fila label="Responsable" valueClassName="font-medium text-fg">
					{responsable}
				</Fila>
				<Fila
					label="Última gestión"
					valueClassName="font-medium text-fg-secondary"
				>
					{ultimaGestion}
				</Fila>
			</dl>
		</CrmCard>
	);
}
