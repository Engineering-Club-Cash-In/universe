import { Building2, Plus, User } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { CompanyQuickCreateDialog } from "./CompanyQuickCreateDialog";
import { VendorQuickCreateDialog } from "./VendorQuickCreateDialog";

const GENERO_LABEL: Record<string, string> = {
	male: "Masculino",
	female: "Femenino",
};

/**
 * Tarjeta del detalle de la oportunidad para asignar la parte del contrato
 * sin entrar a editar: empresa (agencia) si el carro es nuevo, vendedor
 * (dueño) si es usado. Solo tiene sentido con vehículo asignado.
 */
export function OpportunityContractPartyCard({
	vehicleIsNew,
	vendorId,
	company,
	vendors,
	companies,
	disabled,
	isSaving,
	onAssignVendor,
	onAssignCompany,
}: {
	vehicleIsNew: boolean | null | undefined;
	vendorId: string | null | undefined;
	company: { id: string | null; name: string | null; razonSocial?: string | null } | null | undefined;
	vendors: Array<{
		id: string;
		name: string;
		dpi: string;
		gender?: string | null;
		vendorType?: string;
		companyName?: string | null;
	}>;
	companies: Array<{ id: string; name: string }>;
	disabled?: boolean;
	isSaving?: boolean;
	onAssignVendor: (vendorId: string | null) => void;
	onAssignCompany: (companyId: string | null) => void;
}) {
	const esNuevo = vehicleIsNew === true;
	const [crear, setCrear] = useState(false);
	const [completarDpi, setCompletarDpi] = useState<string | undefined>();

	const vendor = vendors.find((v) => v.id === vendorId);
	const companyOptions = [
		{ value: "none", label: "Sin empresa" },
		...companies.map((c) => ({ value: c.id, label: c.name })),
	];
	// La empresa asignada puede no estar en el directorio del asesor
	if (company?.id && !companies.some((c) => c.id === company.id)) {
		companyOptions.push({ value: company.id, label: company.name ?? "" });
	}

	return (
		<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
			<Label className="font-semibold text-muted-foreground text-sm">
				{esNuevo ? "Empresa (agencia)" : "Vendedor del vehículo"}
			</Label>

			<div className="flex items-center gap-3">
				{esNuevo ? (
					<Building2 className="h-5 w-5 shrink-0 text-muted-foreground" />
				) : (
					<User className="h-5 w-5 shrink-0 text-muted-foreground" />
				)}
				<div className="min-w-0 flex-1">
					{esNuevo ? (
						<Combobox
							options={companyOptions}
							value={company?.id ?? "none"}
							onChange={(value) =>
								onAssignCompany(value && value !== "none" ? value : null)
							}
							placeholder="Seleccionar empresa"
							width="full"
							disabled={disabled || isSaving}
						/>
					) : (
						<Combobox
							options={[
								{ value: "none", label: "Sin vendedor asignado" },
								...vendors.map((v) => ({
									value: v.id,
									label: `${v.name}${v.vendorType === "empresa" && v.companyName ? ` (${v.companyName})` : ""} - ${v.dpi}`,
								})),
							]}
							value={vendorId ?? "none"}
							onChange={(value) =>
								onAssignVendor(value && value !== "none" ? value : null)
							}
							placeholder="Seleccionar vendedor"
							width="full"
							disabled={disabled || isSaving}
						/>
					)}
				</div>
				{!disabled && (
					<Button
						type="button"
						variant="outline"
						size="icon"
						title={esNuevo ? "Crear empresa" : "Crear vendedor"}
						onClick={() => {
							setCompletarDpi(undefined);
							setCrear(true);
						}}
					>
						<Plus className="h-4 w-4" />
					</Button>
				)}
			</div>

			{esNuevo
				? company?.id && (
						<p
							className={
								company.razonSocial
									? "text-muted-foreground text-xs"
									: "text-amber-600 text-xs"
							}
						>
							{company.razonSocial
								? `Razón social: ${company.razonSocial}`
								: "Sin razón social: complétala al asignar la inversión."}
						</p>
					)
				: vendor && (
						<p
							className={
								vendor.gender
									? "text-muted-foreground text-xs"
									: "text-amber-600 text-xs"
							}
						>
							{vendor.gender ? (
								`DPI: ${vendor.dpi} · Género: ${GENERO_LABEL[vendor.gender] ?? vendor.gender}`
							) : (
								<>
									Sin género.{" "}
									{!disabled && (
										<button
											type="button"
											className="text-primary hover:underline"
											onClick={() => {
												setCompletarDpi(vendor.dpi);
												setCrear(true);
											}}
										>
											Completar
										</button>
									)}
								</>
							)}
						</p>
					)}

			<VendorQuickCreateDialog
				open={crear && !esNuevo}
				onOpenChange={setCrear}
				initialDpi={completarDpi}
				onSaved={(nuevo) => onAssignVendor(nuevo.id)}
			/>
			<CompanyQuickCreateDialog
				open={crear && esNuevo}
				onOpenChange={setCrear}
				onSaved={(nueva) => onAssignCompany(nueva.id)}
			/>
		</div>
	);
}
