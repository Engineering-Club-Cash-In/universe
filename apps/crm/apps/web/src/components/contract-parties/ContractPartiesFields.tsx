import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Plus, Scale } from "lucide-react";
import {
	type Dispatch,
	type ReactNode,
	type SetStateAction,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { soloDigitosDpi, type VendorGender } from "@/hooks/useVendorDpiLookup";
import { orpc } from "@/utils/orpc";
import { CompanyQuickCreateDialog } from "./CompanyQuickCreateDialog";
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

const GENERO_LABEL: Record<VendorGender, string> = {
	male: "Masculino",
	female: "Femenino",
};

function Dato({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="min-w-0">
			<p className="text-[10px] text-muted-foreground">{label}</p>
			<p className="truncate font-medium text-sm">{children}</p>
		</div>
	);
}

/**
 * Partes del contrato en la asignación de inversión: la agencia para carro
 * nuevo o el vendedor (dueño) para usado. Se escoge del catálogo o se crea
 * con el "+"; abajo solo se muestra lo que llevará el contrato. No bloquean
 * el avance al 80%.
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

	const incompleto =
		Object.keys(toContractPartiesPayload(value, vehicleIsNew)).length === 0;

	const botonCrear = (onClick: () => void, title: string) => (
		<Button
			type="button"
			variant="outline"
			size="icon"
			title={title}
			onClick={onClick}
		>
			<Plus className="h-4 w-4" />
		</Button>
	);

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
											const elegida = companiesQuery.data?.find(
												(c) => c.id === companyId,
											);
											setAgencia({
												companyId,
												razonSocial: elegida?.razonSocial ?? "",
											});
										}}
										isLoading={companiesQuery.isLoading}
										placeholder="Seleccionar empresa"
										width="full"
									/>
								</div>
								{botonCrear(() => setCrearEmpresa(true), "Crear empresa")}
							</div>
						</div>
						{value.agencia.companyId &&
							(razonSocialGuardada ? (
								<Dato label="Razón social">{razonSocialGuardada}</Dato>
							) : (
								// Única captura en línea: la empresa ya existe sin nombre legal
								<div>
									<Label className="text-xs">Razón social</Label>
									<Input
										value={value.agencia.razonSocial}
										onChange={(e) =>
											setAgencia({ razonSocial: e.target.value })
										}
										placeholder="JAC GUATEMALA, SOCIEDAD ANÓNIMA"
									/>
									<p className="mt-1 text-[10px] text-muted-foreground">
										Esta empresa no tiene razón social; se guardará para las
										próximas oportunidades.
									</p>
								</div>
							))}
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
								{botonCrear(() => setDialogoVendedor({}), "Crear vendedor")}
							</div>
						</div>
						{dpi && (
							<div className="grid grid-cols-3 gap-2">
								<Dato label="DPI">{dpi}</Dato>
								<Dato label="Género">
									{genero ? (
										GENERO_LABEL[genero]
									) : (
										<button
											type="button"
											className="text-primary text-xs hover:underline"
											onClick={() => setDialogoVendedor({ initialDpi: dpi })}
										>
											Completar
										</button>
									)}
								</Dato>
								<div className="col-span-3">
									<Dato label="Nombre completo">{nombre}</Dato>
								</div>
							</div>
						)}
					</>
				)}

				{incompleto && (
					<div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-800 text-xs">
						<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
						<span>
							{esNuevo
								? "Falta la empresa con su razón social."
								: "Falta el vendedor con su género."}{" "}
							Puedes avanzar igual, pero jurídico tendrá que llenarlo a mano.
						</span>
					</div>
				)}
			</div>

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
						razonSocial: company.razonSocial ?? "",
					})
				}
			/>
		</div>
	);
}
