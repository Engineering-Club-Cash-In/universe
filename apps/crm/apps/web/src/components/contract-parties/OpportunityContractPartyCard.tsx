import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { CompanyQuickCreateDialog } from "./CompanyQuickCreateDialog";
import { GENERO_LABEL } from "./ContractPartiesFields";
import {
	type ContractPartyStatus,
	ContractPartySlot,
	formatDpiGrupos,
	PartyField,
	PartyFields,
} from "./ContractPartySlot";
import { VendorQuickCreateDialog } from "./VendorQuickCreateDialog";

/**
 * Tarjeta del detalle de la oportunidad para asignar la parte del contrato
 * sin entrar a editar: empresa (agencia) si el carro es nuevo, vendedor
 * (dueño) si es usado. Se guarda al elegir.
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
	company:
		| { id: string | null; name: string | null; razonSocial?: string | null }
		| null
		| undefined;
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
	const [dialogo, setDialogo] = useState<{ initialDpi?: string } | null>(null);

	if (esNuevo) {
		const options = companies.map((c) => ({ value: c.id, label: c.name }));
		// La empresa asignada puede no estar en el directorio del asesor
		if (company?.id && !companies.some((c) => c.id === company.id)) {
			options.push({ value: company.id, label: company.name ?? "" });
		}
		const status: ContractPartyStatus = !company?.id
			? { tipo: "vacio" }
			: !company.razonSocial
				? { tipo: "incompleto", falta: "Falta razón social" }
				: { tipo: "completo" };

		return (
			<>
				<ContractPartySlot
					className="bg-muted/30"
					titulo="Empresa (agencia)"
					status={status}
					seleccionado={
						company?.id
							? { id: company.id, nombre: company.name ?? "Empresa asignada" }
							: null
					}
					selector={
						<Combobox
							options={options}
							value={company?.id ?? null}
							onChange={(value) => value && onAssignCompany(value)}
							placeholder="Buscar empresa registrada"
							width="full"
							disabled={disabled || isSaving}
						/>
					}
					onNuevo={() => setDialogo({})}
					nuevoLabel="Nueva"
					ayudaVacio="La agencia que vende el carro nuevo."
					disabled={disabled}
				>
					{company?.razonSocial && (
						<PartyFields>
							<PartyField label="Razón social">{company.razonSocial}</PartyField>
						</PartyFields>
					)}
				</ContractPartySlot>
				<CompanyQuickCreateDialog
					open={dialogo !== null}
					onOpenChange={(open) => !open && setDialogo(null)}
					onSaved={(nueva) => onAssignCompany(nueva.id)}
				/>
			</>
		);
	}

	const vendor = vendors.find((v) => v.id === vendorId);
	const status: ContractPartyStatus = !vendorId
		? { tipo: "vacio" }
		: vendor && !vendor.gender
			? { tipo: "incompleto", falta: "Falta género" }
			: { tipo: "completo" };

	return (
		<>
			<ContractPartySlot
				className="bg-muted/30"
				titulo="Vendedor (dueño del vehículo)"
				status={status}
				seleccionado={
					vendorId
						? { id: vendorId, nombre: vendor?.name ?? "Cargando…" }
						: null
				}
				selector={
					<Combobox
						options={vendors.map((v) => ({
							value: v.id,
							label: `${v.name}${v.vendorType === "empresa" && v.companyName ? ` (${v.companyName})` : ""} - ${v.dpi}`,
						}))}
						value={vendorId ?? null}
						onChange={(value) => value && onAssignVendor(value)}
						placeholder="Buscar por nombre o DPI"
						width="full"
						disabled={disabled || isSaving}
					/>
				}
				onNuevo={() => setDialogo({})}
				nuevoLabel="Nuevo"
				ayudaVacio="Con el DPI se traen nombre y género de RENAP."
				disabled={disabled}
			>
				{vendor && (
					<>
						<PartyFields>
							<PartyField label="DPI">
								<span className="tabular-nums">
									{formatDpiGrupos(vendor.dpi)}
								</span>
							</PartyField>
							<PartyField label="Género">
								{vendor.gender ? (
									(GENERO_LABEL[vendor.gender as keyof typeof GENERO_LABEL] ??
									vendor.gender)
								) : (
									<span className="text-amber-700 dark:text-amber-400">
										sin definir
									</span>
								)}
							</PartyField>
						</PartyFields>
						{!vendor.gender && !disabled && (
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="mt-1 h-7 text-xs"
								onClick={() => setDialogo({ initialDpi: vendor.dpi })}
							>
								Completar con RENAP
							</Button>
						)}
					</>
				)}
			</ContractPartySlot>
			<VendorQuickCreateDialog
				open={dialogo !== null}
				onOpenChange={(open) => !open && setDialogo(null)}
				initialDpi={dialogo?.initialDpi}
				onSaved={(nuevo) => onAssignVendor(nuevo.id)}
			/>
		</>
	);
}
