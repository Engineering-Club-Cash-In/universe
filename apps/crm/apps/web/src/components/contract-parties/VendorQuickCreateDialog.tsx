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
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSaved: (vendor: QuickVendor) => void;
}) {
	const queryClient = useQueryClient();
	const [dpi, setDpi] = useState("");
	const [nombre, setNombre] = useState("");
	const [genero, setGenero] = useState<VendorGender | "">("");
	const [telefono, setTelefono] = useState("");
	const [existenteId, setExistenteId] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		setDpi("");
		setNombre("");
		setGenero("");
		setTelefono("");
		setExistenteId(null);
	}, [open]);

	const lookup = useVendorDpiLookup((result) => {
		setExistenteId(result.vendorId);
		if (result.nombre) setNombre(result.nombre);
		if (result.genero) setGenero(result.genero);
	});

	const saveMutation = useMutation({
		mutationFn: async (): Promise<QuickVendor> => {
			const dpiLimpio = soloDigitosDpi(dpi);
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
			toast.success(
				existenteId ? "Vendedor actualizado" : "Vendedor creado",
			);
			onSaved(vendor);
			onOpenChange(false);
		},
		onError: (error) => {
			toast.error(error.message || "No se pudo guardar el vendedor");
		},
	});

	const dpiCompleto = soloDigitosDpi(dpi).length === 13;
	const puedeGuardar = dpiCompleto && nombre.trim() && genero;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Nuevo vendedor del vehículo</DialogTitle>
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
									setDpi(e.target.value);
									if (soloDigitosDpi(e.target.value).length === 13) {
										lookup.buscar(e.target.value);
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
						{existenteId && (
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
