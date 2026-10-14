import { Landmark, type LucideIcon, TrendingUp, UserRound } from "lucide-react";
import * as React from "react";
import { DialogFooter } from "@/components/ui/dialog";

/**
 * Maqueta compartida de los modales «Crear Inversionista»
 * (/inversiones/liquidaciones) y «Editar Inversionista»
 * (/inversiones/liquidaciones/$inversionistaId).
 *
 * Solo presentación: cada ruta conserva su estado, sus validaciones y su
 * mutación, y pasa los campos ya armados en cada sección.
 *
 *   header      → DialogHeader (título + descripción), fijo arriba
 *   personal    → «Datos personales»
 *   personalNotice → aviso ligado a los datos personales (p. ej. empresa
 *                 detectada). En celular va justo debajo de la sección; desde
 *                 md pasa a todo el ancho debajo de las columnas, para que un
 *                 texto largo no estire una sola columna.
 *   bank        → «Banco y cuenta»
 *   investment  → «Inversión»
 *   extra       → bloque a todo el ancho debajo de las columnas (compra de cartera)
 *   footer      → botones, fijos al pie
 *
 * Escritorio (lg): tres columnas. Tablet (md): dos. Celular: una sola.
 * El modal es más ancho que el Dialog por defecto: pásele
 * `investorFormDialogClassName` a su `DialogContent`.
 */
export const investorFormDialogClassName =
	"flex max-h-[min(90dvh,880px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl";

function InvestorFormSection({
	icon: Icon,
	title,
	children,
}: {
	icon: LucideIcon;
	title: string;
	children: React.ReactNode;
}) {
	const titleId = React.useId();
	return (
		<section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-4">
			<div className="flex items-center gap-2 border-line-subtle border-b pb-2">
				<span
					aria-hidden
					className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand"
				>
					<Icon className="size-4" />
				</span>
				<h3 id={titleId} className="font-semibold text-fg text-sm">
					{title}
				</h3>
			</div>
			{children}
		</section>
	);
}

export function InvestorFormLayout({
	header,
	personal,
	personalNotice,
	bank,
	investment,
	extra,
	footer,
}: {
	header: React.ReactNode;
	personal: React.ReactNode;
	personalNotice?: React.ReactNode;
	bank: React.ReactNode;
	investment: React.ReactNode;
	extra?: React.ReactNode;
	footer: React.ReactNode;
}) {
	return (
		<>
			<div className="shrink-0 border-line-subtle border-b px-4 pt-6 pb-4 sm:px-6">
				{header}
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
				<div className="grid gap-x-8 gap-y-6 md:grid-cols-2 lg:grid-cols-3">
					<InvestorFormSection icon={UserRound} title="Datos personales">
						{personal}
					</InvestorFormSection>
					{personalNotice ? (
						<div className="min-w-0 md:order-last md:col-span-2 lg:col-span-3">
							{personalNotice}
						</div>
					) : null}
					<InvestorFormSection icon={Landmark} title="Banco y cuenta">
						{bank}
					</InvestorFormSection>
					<InvestorFormSection icon={TrendingUp} title="Inversión">
						{investment}
					</InvestorFormSection>
				</div>
				{extra ? <div className="mt-6">{extra}</div> : null}
			</div>

			<DialogFooter className="sticky bottom-0 z-10 shrink-0 border-line-subtle border-t bg-surface px-4 py-4 sm:px-6">
				{footer}
			</DialogFooter>
		</>
	);
}
