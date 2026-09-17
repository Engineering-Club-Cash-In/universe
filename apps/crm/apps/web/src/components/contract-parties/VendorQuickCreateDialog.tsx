import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	soloDigitosDpi,
	useVendorDpiLookup,
	type VendorGender,
} from "@/hooks/useVendorDpiLookup";
import { client, orpc } from "@/utils/orpc";
import { VendorGenderSelect } from "./VendorGenderSelect";

export interface QuickVendor {
	id: string;
	name: string;
	dpi: string;
	gender: string | null;
}

/**
 * Alta rápida del vendedor (dueño del vehículo) sin salir de la pantalla.
 * Con el DPI completo trae nombre y género de RENAP. Si el DPI ya existe,
 * actualiza ese vendedor en vez de fallar por duplicado.
 */
export function VendorQuickCreateDialog({
	open,
	onOpenChange,
	onSaved,
	initialDpi,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSaved: (vendor: QuickVendor) => void;
	/** Para completar un vendedor ya registrado: se consulta al abrir. */
	initialDpi?: string;
}) {
	const queryClient = useQueryClient();
	const [dpi, setDpi] = useState("");
	const [nombre, setNombre] = useState("");
	const [genero, setGenero] = useState<VendorGender | "">("");
	const [telefono, setTelefono] = useState("");
	// Vendedor registrado con el DPI consultado. Guarda también ese DPI para
	// no actualizar a una persona con el DPI de otra.
	const [existente, setExistente] = useState<{
		id: string;
		dpi: string;
	} | null>(null);

	const lookup = useVendorDpiLookup((result) => {
		setExistente(
			result.vendorId ? { id: result.vendorId, dpi: result.dpi } : null,
		);
		if (result.nombre) setNombre(result.nombre);
		if (result.genero) setGenero(result.genero);
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: solo al abrir
	useEffect(() => {
		if (!open) return;
		setDpi(initialDpi ?? "");
		setNombre("");
		setGenero("");
		setTelefono("");
		setExistente(null);
		if (initialDpi) lookup.buscar(initialDpi, { force: true });
	}, [open]);

	const saveMutation = useMutation({
		mutationFn: async (): Promise<QuickVendor> => {
			const dpiLimpio = soloDigitosDpi(dpi);
			const existenteId = existente?.dpi === dpiLimpio ? existente.id : null;
			if (existenteId) {
				const actual = await client.getVendorById({ id: existenteId });
				return client.updateVendor({
					id: existenteId,
					data: {
						name: nombre.trim(),
						phone: telefono.trim() || actual.phone || undefined,
						dpi: dpiLimpio,
						vendorType: actual.vendorType as "individual" | "empresa",
						companyName: actual.companyName || undefined,
						email: actual.email || undefined,
						address: actual.address || undefined,
						gender: genero || null,
					},
				});
			}
			return client.createVendor({
				name: nombre.trim(),
				phone: telefono.trim() || undefined,
				dpi: dpiLimpio,
				vendorType: "individual",
				gender: genero || null,
			});
		},
		onSuccess: (vendor) => {
			queryClient.invalidateQueries({ queryKey: orpc.getVendors.key() });
			toast.success(existente ? "Vendedor actualizado" : "Vendedor creado");
			onSaved(vendor);
			onOpenChange(false);
		},
		onError: (error) => {
			toast.error(error.message || "No se pudo guardar el vendedor");
		},
	});

	const dpiCompleto = soloDigitosDpi(dpi).length === 13;
	// No se guarda mientras se consulta: los datos en pantalla podrían ser de
	// otro DPI.
	const puedeGuardar =
		dpiCompleto && nombre.trim() && genero && !lookup.isPending;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>
						{initialDpi ? "Completar vendedor" : "Nuevo vendedor del vehículo"}
					</DialogTitle>
					<DialogDescription>
						Escribe el DPI del dueño y se traen su nombre y género de RENAP.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="quick-vendor-dpi">DPI</Label>
						<div className="flex gap-2">
							<Input
								id="quick-vendor-dpi"
								inputMode="numeric"
								placeholder="1234567890101"
								value={dpi}
								onChange={(e) => {
									const nuevo = e.target.value;
									setDpi(nuevo);
									// Otro DPI es otra persona: se descartan los datos traídos
									if (lookup.dpiEditado(nuevo) && existente) {
										setExistente(null);
										setNombre("");
										setGenero("");
									}
									if (soloDigitosDpi(nuevo).length === 13) {
										lookup.buscar(nuevo);
									}
								}}
							/>
							<Button
								type="button"
								variant="outline"
								onClick={() => lookup.buscar(dpi, { force: true })}
								disabled={!dpiCompleto || lookup.isPending}
							>
								{lookup.isPending ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : (
									<Search className="h-4 w-4" />
								)}
							</Button>
						</div>
						{existente && (
							<p className="text-muted-foreground text-xs">
								Ya existe un vendedor con este DPI: se actualizará con estos
								datos.
							</p>
						)}
					</div>

					<div className="space-y-2">
						<Label htmlFor="quick-vendor-nombre">Nombre completo</Label>
						<Input
							id="quick-vendor-nombre"
							placeholder="Como aparece en el DPI"
							value={nombre}
							onChange={(e) => setNombre(e.target.value)}
						/>
					</div>

					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="quick-vendor-genero">Género</Label>
							<VendorGenderSelect
								id="quick-vendor-genero"
								value={genero}
								onChange={setGenero}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="quick-vendor-telefono">Teléfono (opcional)</Label>
							<Input
								id="quick-vendor-telefono"
								placeholder="5555-5555"
								value={telefono}
								onChange={(e) => setTelefono(e.target.value)}
							/>
						</div>
					</div>
				</div>

				<DialogFooter>
					<Button
						type="button"
						onClick={() => saveMutation.mutate()}
						disabled={!puedeGuardar || saveMutation.isPending}
					>
						{saveMutation.isPending ? "Guardando..." : "Guardar vendedor"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
