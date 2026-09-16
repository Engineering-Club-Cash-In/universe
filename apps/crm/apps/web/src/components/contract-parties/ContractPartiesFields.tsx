import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Plus, Scale, Search } from "lucide-react";
import { type Dispatch, type SetStateAction, useState } from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	soloDigitosDpi,
	useVendorDpiLookup,
	type VendorGender,
} from "@/hooks/useVendorDpiLookup";
import { orpc } from "@/utils/orpc";
import { CompanyQuickCreateDialog } from "./CompanyQuickCreateDialog";
import { VendorGenderSelect } from "./VendorGenderSelect";
import { VendorQuickCreateDialog } from "./VendorQuickCreateDialog";

export interface ContractPartiesValue {
	vendedor: { dpi: string; nombre: string; genero: VendorGender | "" };
	agencia: { companyId: string; razonSocial: string };
}

export const emptyContractParties: ContractPartiesValue = {
	vendedor: { dpi: "", nombre: "", genero: "" },
	agencia: { companyId: "", razonSocial: "" },
};

/** Lo que se envía al asignar la inversión; incompleto no se envía. */
export function toContractPartiesPayload(
	value: ContractPartiesValue,
	vehicleIsNew: boolean | null | undefined,
) {
	if (vehicleIsNew === true) {
		const { companyId, razonSocial } = value.agencia;
		return companyId && razonSocial.trim()
			? { agencia: { companyId, razonSocial: razonSocial.trim() } }
			: {};
	}
	const { dpi, nombre, genero } = value.vendedor;
	return soloDigitosDpi(dpi).length === 13 && nombre.trim() && genero
		? {
				vendedor: {
					dpi: soloDigitosDpi(dpi),
					nombre: nombre.trim(),
					genero,
				},
			}
		: {};
}

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
	const [crearVendedor, setCrearVendedor] = useState(false);
	const [crearEmpresa, setCrearEmpresa] = useState(false);

	const vendorsQuery = useQuery({
		...orpc.getVendors.queryOptions(),
		enabled: !esNuevo,
	});
	const companiesQuery = useQuery({
		...orpc.getCompaniesForContracts.queryOptions(),
		enabled: esNuevo,
	});

	// Actualizaciones funcionales: la búsqueda en RENAP y los diálogos
	// responden después de un render y no deben pisar lo escrito mientras tanto.
	const setVendedor = (vendedor: Partial<ContractPartiesValue["vendedor"]>) =>
		onChange((prev) => ({
			...prev,
			vendedor: { ...prev.vendedor, ...vendedor },
		}));
	const setAgencia = (agencia: Partial<ContractPartiesValue["agencia"]>) =>
		onChange((prev) => ({ ...prev, agencia: { ...prev.agencia, ...agencia } }));

	const lookup = useVendorDpiLookup((result) =>
		setVendedor({
			...(result.nombre && { nombre: result.nombre }),
			...(result.genero && { genero: result.genero }),
		}),
	);

	const vendedorSeleccionado = vendorsQuery.data?.find(
		(v) =>
			soloDigitosDpi(v.dpi) === soloDigitosDpi(value.vendedor.dpi) &&
			value.vendedor.dpi !== "",
	);

	const incompleto =
		Object.keys(toContractPartiesPayload(value, vehicleIsNew)).length === 0;

	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2">
				<Scale className="h-4 w-4" />
				<Label className="font-medium text-sm">Datos para contratos</Label>
			</div>

			<div className="space-y-3 rounded-lg border bg-muted/30 p-3">
				{esNuevo ? (
					<>
						<div>
							<Label className="text-xs">Empresa (agencia)</Label>
							<div className="flex gap-2">
								<div className="min-w-0 flex-1">
									<Combobox
										options={(companiesQuery.data ?? []).map((c) => ({
											value: c.id,
											label: c.name,
										}))}
										value={value.agencia.companyId || null}
										onChange={(companyId) => {
											const empresa = companiesQuery.data?.find(
												(c) => c.id === companyId,
											);
											setAgencia({
												companyId,
												razonSocial: empresa?.razonSocial ?? "",
											});
										}}
										isLoading={companiesQuery.isLoading}
										placeholder="Seleccionar empresa"
										width="full"
									/>
								</div>
								<Button
									type="button"
									variant="outline"
									size="icon"
									title="Crear empresa"
									onClick={() => setCrearEmpresa(true)}
								>
									<Plus className="h-4 w-4" />
								</Button>
							</div>
						</div>
						<div>
							<Label className="text-xs">Razón social</Label>
							<Input
								value={value.agencia.razonSocial}
								onChange={(e) => setAgencia({ razonSocial: e.target.value })}
								placeholder="JAC GUATEMALA, SOCIEDAD ANÓNIMA"
								disabled={!value.agencia.companyId}
							/>
							<p className="mt-1 text-[10px] text-muted-foreground">
								Nombre legal como va en el contrato. Se guarda en la empresa
								para las próximas oportunidades.
							</p>
						</div>
					</>
				) : (
					<>
						<div>
							<Label className="text-xs">Vendedor (dueño del vehículo)</Label>
							<div className="flex gap-2">
								<div className="min-w-0 flex-1">
									<Combobox
										options={(vendorsQuery.data ?? []).map((v) => ({
											value: v.id,
											label: `${v.name} - ${v.dpi}`,
										}))}
										value={vendedorSeleccionado?.id ?? null}
										onChange={(vendorId) => {
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
										placeholder="Seleccionar vendedor registrado"
										width="full"
									/>
								</div>
								<Button
									type="button"
									variant="outline"
									size="icon"
									title="Crear vendedor"
									onClick={() => setCrearVendedor(true)}
								>
									<Plus className="h-4 w-4" />
								</Button>
							</div>
						</div>
						<div className="grid grid-cols-2 gap-2">
							<div>
								<Label className="text-xs">DPI</Label>
								<div className="flex gap-1">
									<Input
										inputMode="numeric"
										value={value.vendedor.dpi}
										onChange={(e) => {
											setVendedor({ dpi: e.target.value });
											if (soloDigitosDpi(e.target.value).length === 13) {
												lookup.buscar(e.target.value);
											}
										}}
										placeholder="1234567890101"
									/>
									<Button
										type="button"
										variant="outline"
										size="icon"
										title="Buscar en RENAP"
										onClick={() =>
											lookup.buscar(value.vendedor.dpi, { force: true })
										}
										disabled={lookup.isPending}
									>
										{lookup.isPending ? (
											<Loader2 className="h-4 w-4 animate-spin" />
										) : (
											<Search className="h-4 w-4" />
										)}
									</Button>
								</div>
							</div>
							<div>
								<Label className="text-xs">Género</Label>
								<VendorGenderSelect
									value={value.vendedor.genero}
									onChange={(genero) => setVendedor({ genero })}
								/>
							</div>
						</div>
						<div>
							<Label className="text-xs">Nombre completo</Label>
							<Input
								value={value.vendedor.nombre}
								onChange={(e) => setVendedor({ nombre: e.target.value })}
								placeholder="Como aparece en el DPI"
							/>
						</div>
					</>
				)}

				{incompleto && (
					<div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-800 text-xs">
						<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
						<span>
							{esNuevo
								? "Falta la empresa con su razón social."
								: "Faltan DPI, nombre o género del vendedor."}{" "}
							Puedes avanzar igual, pero jurídico tendrá que llenarlo a mano.
						</span>
					</div>
				)}
			</div>

			<VendorQuickCreateDialog
				open={crearVendedor}
				onOpenChange={setCrearVendedor}
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
						razonSocial: company.razonSocial ?? "",
					})
				}
			/>
		</div>
	);
}
