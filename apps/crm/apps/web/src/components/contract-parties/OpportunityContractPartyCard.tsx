import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
 * (dueño) si es usado. Se guarda al elegir, y volver a elegir al que ya está
 * lo quita.
 */
export function OpportunityContractPartyCard({
	vehicleIsNew,
	vendorId,
	company,
	vendors,
	companies,
	cargandoCatalogo,
	puedeGestionarEmpresa = true,
	disabled,
	isSaving,
	onAssignVendor,
	onAssignCompany,
	onSaveRazonSocial,
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
	/** Catálogos en vuelo: sin esto, un vendedor aún no cargado parece borrado. */
	cargandoCatalogo?: boolean;
	/** Alta y edición de la agencia: jurídico entra al CRM pero no las gestiona. */
	puedeGestionarEmpresa?: boolean;
	disabled?: boolean;
	isSaving?: boolean;
	onAssignVendor: (vendorId: string | null) => void;
	onAssignCompany: (companyId: string | null) => void;
	/** Guarda el nombre legal que falta, sin salir del detalle. */
	onSaveRazonSocial?: (companyId: string, razonSocial: string) => void;
}) {
	const esNuevo = vehicleIsNew === true;
	const [dialogo, setDialogo] = useState<{ initialDpi?: string } | null>(null);
	// Captura de la razón social cuando la empresa asignada no la tiene
	const [razonSocial, setRazonSocial] = useState("");
	// biome-ignore lint/correctness/useExhaustiveDependencies: solo al cambiar de empresa
	useEffect(() => {
		setRazonSocial("");
	}, [company?.id]);

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
							// Cadena vacía = se deseleccionó al elegir la misma de nuevo:
							// la empresa se desasigna en vez de quedarse pegada
							onChange={(value) => onAssignCompany(value || null)}
							placeholder="Buscar empresa registrada"
							width="full"
							disabled={disabled || isSaving}
						/>
					}
					onNuevo={puedeGestionarEmpresa ? () => setDialogo({}) : undefined}
					nuevoLabel="Nueva"
					ayudaVacio="La agencia que vende el carro nuevo."
					disabled={disabled}
				>
					{company?.razonSocial ? (
						<PartyFields>
							<PartyField label="Razón social">{company.razonSocial}</PartyField>
						</PartyFields>
					) : (
						company?.id &&
						onSaveRazonSocial &&
						puedeGestionarEmpresa &&
						!disabled && (
							// Sin razón social {agencia} sale vacío en el contrato, así que
							// se completa desde aquí y queda guardada en la empresa
							<div className="space-y-1 pt-1">
								<Label htmlFor="razon-social-detalle" className="text-xs">
									Razón social
								</Label>
								<div className="flex gap-2">
									<Input
										id="razon-social-detalle"
										value={razonSocial}
										onChange={(e) => setRazonSocial(e.target.value)}
										placeholder="Ej. JAC GUATEMALA, SOCIEDAD ANÓNIMA"
										className="h-8 text-sm"
									/>
									<Button
										type="button"
										size="sm"
										className="h-8 shrink-0"
										disabled={!razonSocial.trim() || isSaving}
										onClick={() =>
											company.id &&
											onSaveRazonSocial(company.id, razonSocial.trim())
										}
									>
										Guardar
									</Button>
								</div>
								<p className="text-muted-foreground text-xs">
									Como va en el contrato. Queda guardada para las próximas
									oportunidades de esta empresa.
								</p>
							</div>
						)
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
	// Un vendedor asignado que ya no está en el catálogo fue borrado: la
	// generación de contratos no lo encuentra y deja los campos del dueño
	// vacíos, así que la ficha no puede decir que está lista.
	const status: ContractPartyStatus = !vendorId
		? { tipo: "vacio" }
		: !vendor
			? {
					tipo: "incompleto",
					falta: cargandoCatalogo ? "Cargando…" : "El vendedor ya no existe",
				}
			: !vendor.gender
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
						? {
								id: vendorId,
								nombre:
									vendor?.name ??
									(cargandoCatalogo ? "Cargando…" : "Vendedor no encontrado"),
							}
						: null
				}
				selector={
					<Combobox
						options={vendors.map((v) => ({
							value: v.id,
							label: `${v.name}${v.vendorType === "empresa" && v.companyName ? ` (${v.companyName})` : ""} - ${v.dpi}`,
						}))}
						value={vendorId ?? null}
						// Cadena vacía = se deseleccionó al elegir el mismo de nuevo
						onChange={(value) => onAssignVendor(value || null)}
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
