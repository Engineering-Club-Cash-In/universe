import { useQuery } from "@tanstack/react-query";
import { Scale } from "lucide-react";
import { type Dispatch, type SetStateAction, useState } from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { soloDigitosDpi, type VendorGender } from "@/hooks/useVendorDpiLookup";
import { orpc } from "@/utils/orpc";
import { CompanyQuickCreateDialog } from "./CompanyQuickCreateDialog";
import {
	type ContractPartyStatus,
	ContractPartySlot,
	formatDpiGrupos,
	PartyField,
	PartyFields,
} from "./ContractPartySlot";
import { VendorQuickCreateDialog } from "./VendorQuickCreateDialog";

export interface ContractPartiesValue {
	vendedor: { dpi: string; nombre: string; genero: VendorGender | "" };
	agencia: { companyId: string; nombre: string; razonSocial: string };
}

export const emptyContractParties: ContractPartiesValue = {
	vendedor: { dpi: "", nombre: "", genero: "" },
	agencia: { companyId: "", nombre: "", razonSocial: "" },
};

/**
 * Lo que se envía al asignar la inversión. La selección se manda aunque esté
 * incompleta: si no, la oportunidad se quedaría con el vendedor o la agencia
 * anterior y el contrato saldría con la persona equivocada. Lo que falte
 * (género, razón social) se omite y jurídico lo llena a mano.
 *
 * Quitar la parte en el selector manda `null` para desasignarla: si no, la
 * pantalla diría "Sin asignar" pero el contrato seguiría saliendo con la
 * empresa o el vendedor anterior.
 */
export function toContractPartiesPayload(
	value: ContractPartiesValue,
	vehicleIsNew: boolean | null | undefined,
) {
	if (vehicleIsNew === true) {
		const { companyId, razonSocial } = value.agencia;
		if (!companyId) return { agencia: null };
		return {
			agencia: {
				companyId,
				...(razonSocial.trim() && { razonSocial: razonSocial.trim() }),
			},
		};
	}
	const { dpi, nombre, genero } = value.vendedor;
	// Sin DPI la parte se quitó a propósito: hay que desasignarla
	if (!dpi.trim() && !nombre.trim()) return { vendedor: null };
	if (soloDigitosDpi(dpi).length !== 13 || !nombre.trim()) return {};
	return {
		vendedor: {
			dpi: soloDigitosDpi(dpi),
			nombre: nombre.trim(),
			...(genero && { genero }),
		},
	};
}

export const GENERO_LABEL: Record<VendorGender, string> = {
	male: "Masculino",
	female: "Femenino",
};

/**
 * Partes del contrato en la asignación de inversión: la agencia para carro
 * nuevo o el vendedor (dueño) para usado. No bloquean el avance al 80%.
 */
export function ContractPartiesFields({
	vehicleIsNew,
	value,
	onChange,
}: {
	vehicleIsNew: boolean | null | undefined;
	value: ContractPartiesValue;
	onChange: Dispatch<SetStateAction<ContractPartiesValue>>;
}) {
	const esNuevo = vehicleIsNew === true;
	const [dialogoVendedor, setDialogoVendedor] = useState<{
		initialDpi?: string;
	} | null>(null);
	const [crearEmpresa, setCrearEmpresa] = useState(false);

	const vendorsQuery = useQuery({
		...orpc.getVendors.queryOptions(),
		enabled: !esNuevo,
	});
	const companiesQuery = useQuery({
		...orpc.getCompaniesForContracts.queryOptions(),
		enabled: esNuevo,
	});

	// Actualizaciones funcionales: los diálogos responden después de un render
	// y no deben pisar lo que cambió mientras tanto.
	const setVendedor = (vendedor: ContractPartiesValue["vendedor"]) =>
		onChange((prev) => ({ ...prev, vendedor }));
	const setAgencia = (agencia: Partial<ContractPartiesValue["agencia"]>) =>
		onChange((prev) => ({ ...prev, agencia: { ...prev.agencia, ...agencia } }));

	const { dpi, nombre, genero } = value.vendedor;
	const vendedorSeleccionado = dpi
		? vendorsQuery.data?.find(
				(v) => soloDigitosDpi(v.dpi) === soloDigitosDpi(dpi),
			)
		: undefined;
	// Mientras carga el catálogo se confía en lo precargado de la oportunidad
	const razonSocialGuardada = companiesQuery.data
		? companiesQuery.data.find((c) => c.id === value.agencia.companyId)
				?.razonSocial
		: value.agencia.razonSocial;

	const statusVendedor: ContractPartyStatus = !dpi
		? { tipo: "vacio" }
		: !genero
			? { tipo: "incompleto", falta: "Falta género" }
			: { tipo: "completo" };
	const statusAgencia: ContractPartyStatus = !value.agencia.companyId
		? { tipo: "vacio" }
		: !value.agencia.razonSocial.trim()
			? { tipo: "incompleto", falta: "Falta razón social" }
			: { tipo: "completo" };
	const completo = (esNuevo ? statusAgencia : statusVendedor).tipo === "completo";

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<Scale className="h-4 w-4" />
				<Label className="font-medium text-sm">Datos para contratos</Label>
			</div>

			{esNuevo ? (
				<ContractPartySlot
					titulo="Empresa (agencia)"
					status={statusAgencia}
					seleccionado={
						value.agencia.companyId
							? {
									id: value.agencia.companyId,
									nombre: value.agencia.nombre || "Empresa asignada",
								}
							: null
					}
					selector={
						<Combobox
							options={(companiesQuery.data ?? []).map((c) => ({
								value: c.id,
								label: c.name,
							}))}
							value={value.agencia.companyId || null}
							onChange={(companyId) => {
								const elegida = companiesQuery.data?.find(
									(c) => c.id === companyId,
								);
								setAgencia({
									companyId,
									nombre: elegida?.name ?? "",
									razonSocial: elegida?.razonSocial ?? "",
								});
							}}
							isLoading={companiesQuery.isLoading}
							placeholder="Buscar empresa registrada"
							width="full"
						/>
					}
					onNuevo={() => setCrearEmpresa(true)}
					nuevoLabel="Nueva"
					ayudaVacio="La agencia que vende el carro nuevo. Si no está registrada, créala con Nueva."
				>
					{razonSocialGuardada ? (
						<PartyFields>
							<PartyField label="Razón social">{razonSocialGuardada}</PartyField>
						</PartyFields>
					) : (
						// Única captura en línea: la empresa existe pero sin nombre legal
						<div className="space-y-1 pt-1">
							<Label htmlFor="razon-social-agencia" className="text-xs">
								Razón social
							</Label>
							<Input
								id="razon-social-agencia"
								value={value.agencia.razonSocial}
								onChange={(e) => setAgencia({ razonSocial: e.target.value })}
								placeholder="Ej. JAC GUATEMALA, SOCIEDAD ANÓNIMA"
							/>
							<p className="text-muted-foreground text-xs">
								Como va en el contrato. Queda guardada para las próximas
								oportunidades de esta empresa.
							</p>
						</div>
					)}
				</ContractPartySlot>
			) : (
				<ContractPartySlot
					titulo="Vendedor (dueño del vehículo)"
					status={statusVendedor}
					seleccionado={
						dpi
							? { id: vendedorSeleccionado?.id ?? dpi, nombre: nombre || dpi }
							: null
					}
					selector={
						<Combobox
							options={(vendorsQuery.data ?? []).map((v) => ({
								value: v.id,
								label: `${v.name} - ${v.dpi}`,
							}))}
							value={vendedorSeleccionado?.id ?? null}
							onChange={(vendorId) => {
								// Cadena vacía = se deseleccionó al elegir el mismo de
								// nuevo: la parte queda sin vendedor
								if (!vendorId) {
									setVendedor({ dpi: "", nombre: "", genero: "" });
									return;
								}
								const vendor = vendorsQuery.data?.find(
									(v) => v.id === vendorId,
								);
								if (!vendor) return;
								setVendedor({
									dpi: vendor.dpi,
									nombre: vendor.name,
									genero: (vendor.gender as VendorGender) ?? "",
								});
							}}
							isLoading={vendorsQuery.isLoading}
							placeholder="Buscar por nombre o DPI"
							width="full"
						/>
					}
					onNuevo={() => setDialogoVendedor({})}
					nuevoLabel="Nuevo"
					ayudaVacio="Si no está registrado, créalo con Nuevo: con el DPI se traen nombre y género de RENAP."
				>
					<PartyFields>
						<PartyField label="DPI">
							<span className="tabular-nums">{formatDpiGrupos(dpi)}</span>
						</PartyField>
						<PartyField label="Género">
							{genero ? (
								GENERO_LABEL[genero]
							) : (
								<span className="text-amber-700 dark:text-amber-400">
									sin definir
								</span>
							)}
						</PartyField>
					</PartyFields>
					{!genero && (
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="mt-1 h-7 text-xs"
							onClick={() => setDialogoVendedor({ initialDpi: dpi })}
						>
							Completar con RENAP
						</Button>
					)}
				</ContractPartySlot>
			)}

			{!completo && (
				<p className="text-muted-foreground text-xs">
					Puedes avanzar sin esto; jurídico lo llenará a mano en el contrato.
				</p>
			)}

			<VendorQuickCreateDialog
				open={dialogoVendedor !== null}
				onOpenChange={(open) => !open && setDialogoVendedor(null)}
				initialDpi={dialogoVendedor?.initialDpi}
				onSaved={(vendor) =>
					setVendedor({
						dpi: vendor.dpi,
						nombre: vendor.name,
						genero: (vendor.gender as VendorGender) ?? "",
					})
				}
			/>
			<CompanyQuickCreateDialog
				open={crearEmpresa}
				onOpenChange={setCrearEmpresa}
				onSaved={(company) =>
					setAgencia({
						companyId: company.id,
						nombre: company.name,
						razonSocial: company.razonSocial ?? "",
					})
				}
			/>
		</div>
	);
}
