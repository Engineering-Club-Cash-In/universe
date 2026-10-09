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
	value: MembresiaSocio[];
	onChange: (value: MembresiaSocio[]) => void;
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
											: [...value, { companyId: company.id, sellerId: null }],
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
	sellerId: string | null;
	onChange: (sellerId: string | null) => void;
}) {
	const vendedoresQuery = useQuery(
		orpc.getAgencySellers.queryOptions({ input: { companyId } }),
	);

	return (
		<div className="pl-6">
			<Select
				value={sellerId ?? GERENTE}
				onValueChange={(v) => onChange(v === GERENTE ? null : v)}
			>
				<SelectTrigger className="h-8 text-xs">
					<SelectValue />
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
