import { useQuery } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { orpc } from "@/utils/orpc";

/** Sin `sellerId` el usuario es gerente de la agencia y ve todo lo de ella. */
export interface MembresiaSocio {
	companyId: string;
	sellerId: string | null;
}

/**
 * En el formulario, una agencia recién marcada todavía no tiene alcance
 * (`undefined`): hay que elegir gerente o vendedor a propósito, para que nadie
 * quede viendo toda la agencia por omisión.
 */
export interface MembresiaEnEdicion {
	companyId: string;
	sellerId?: string | null;
}

export function faltaElegirAlcance(value: MembresiaEnEdicion[]): boolean {
	return value.some((m) => m.sellerId === undefined);
}

/** Solo con todos los alcances elegidos (ver `faltaElegirAlcance`). */
export function membresiasElegidas(
	value: MembresiaEnEdicion[],
): MembresiaSocio[] {
	return value.map((m) => ({
		companyId: m.companyId,
		sellerId: m.sellerId ?? null,
	}));
}

const GERENTE = "__gerente__";

/**
 * Agencias de un usuario del tracker. Por cada agencia marcada se elige si
 * ve toda la agencia (gerente) o solo las oportunidades de un vendedor.
 */
export function PartnerAgenciesPicker({
	companies,
	value,
	onChange,
	className,
}: {
	companies: Array<{ id: string; name: string }>;
	value: MembresiaEnEdicion[];
	onChange: (value: MembresiaEnEdicion[]) => void;
	className?: string;
}) {
	if (companies.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No hay agencias registradas.
			</p>
		);
	}

	return (
		<div className={className ?? "space-y-2"}>
			{companies.map((company) => {
				const membresia = value.find((m) => m.companyId === company.id);
				return (
					<div key={company.id} className="space-y-1">
						<label className="flex cursor-pointer items-center gap-2 text-sm">
							<Checkbox
								checked={!!membresia}
								onCheckedChange={() =>
									onChange(
										membresia
											? value.filter((m) => m.companyId !== company.id)
											: [
													...value,
													{ companyId: company.id, sellerId: undefined },
												],
									)
								}
							/>
							{company.name.trim()}
						</label>
						{membresia && (
							<AlcanceSelect
								companyId={company.id}
								sellerId={membresia.sellerId}
								onChange={(sellerId) =>
									onChange(
										value.map((m) =>
											m.companyId === company.id ? { ...m, sellerId } : m,
										),
									)
								}
							/>
						)}
					</div>
				);
			})}
		</div>
	);
}

function AlcanceSelect({
	companyId,
	sellerId,
	onChange,
}: {
	companyId: string;
	sellerId: string | null | undefined;
	onChange: (sellerId: string | null) => void;
}) {
	const vendedoresQuery = useQuery(
		orpc.getAgencySellers.queryOptions({ input: { companyId } }),
	);

	return (
		<div className="pl-6">
			<Select
				value={sellerId === undefined ? "" : (sellerId ?? GERENTE)}
				onValueChange={(v) => onChange(v === GERENTE ? null : v)}
			>
				<SelectTrigger
					className={
						sellerId === undefined
							? "h-8 border-amber-400 text-xs"
							: "h-8 text-xs"
					}
				>
					<SelectValue placeholder="Elige: toda la agencia o un vendedor" />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={GERENTE}>Toda la agencia (gerente)</SelectItem>
					{vendedoresQuery.data?.map((v) => (
						<SelectItem key={v.id} value={v.id}>
							Solo sus oportunidades: {v.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
