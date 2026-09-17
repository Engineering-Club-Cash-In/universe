import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { cuiValido } from "@/lib/dpi";
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
	const [correo, setCorreo] = useState("");
	const [telefono, setTelefono] = useState("");
	// Vendedor registrado con el DPI consultado. Guarda también ese DPI para
	// no actualizar a una persona con el DPI de otra.
	const [existente, setExistente] = useState<{
		id: string;
		dpi: string;
	} | null>(null);

	// DPI del que salieron el nombre y el género en pantalla (null si se
	// escribieron a mano). La identidad sigue al DPI: si cambia, se limpia.
	const datosDe = useRef<string | null>(null);

	const lookup = useVendorDpiLookup((result) => {
		setExistente(
			result.vendorId ? { id: result.vendorId, dpi: result.dpi } : null,
		);
		if (result.nombre || result.genero) datosDe.current = result.dpi;
		if (result.nombre) setNombre(result.nombre);
		if (result.genero) setGenero(result.genero);
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: solo al abrir
	useEffect(() => {
		// Una búsqueda de la apertura anterior no debe llenar esta
		lookup.cancelar();
		if (!open) return;
		setDpi(initialDpi ?? "");
		setNombre("");
		setGenero("");
		setCorreo("");
		setTelefono("");
		setExistente(null);
		datosDe.current = null;
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
						email: correo.trim() || actual.email || undefined,
						address: actual.address || undefined,
						gender: genero || null,
					},
				});
			}
			return client.createVendor({
				name: nombre.trim(),
				email: correo.trim() || undefined,
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

	const dpiLimpio = soloDigitosDpi(dpi);
	const dpiCompleto = dpiLimpio.length === 13;
	// Un vendedor nuevo no se crea con un DPI que no existe: se valida el
	// dígito verificador, igual que el servidor. A uno ya registrado no se le
	// exige, porque hay DPI viejos que solo se validaron por largo y si no no
	// se les podría completar el género.
	const dpiEsDeRegistrado = existente?.dpi === dpiLimpio;
	const dpiInvalido =
		dpiCompleto && !dpiEsDeRegistrado && !cuiValido(dpiLimpio);
	// El correo es opcional, pero el servidor lo rechaza si está mal escrito
	const correoInvalido = correo.trim() !== "" && !/^\S+@\S+\.\S+$/.test(correo.trim());
	// No se guarda mientras se consulta: los datos en pantalla podrían ser de
	// otro DPI.
	const puedeGuardar =
		dpiCompleto &&
		!dpiInvalido &&
		nombre.trim() &&
		genero &&
		!correoInvalido &&
		!lookup.isPending;

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
								aria-invalid={dpiInvalido}
								className={dpiInvalido ? "border-destructive" : ""}
								onChange={(e) => {
									const nuevo = e.target.value;
									const anterior = soloDigitosDpi(dpi);
									const digitos = soloDigitosDpi(nuevo);
									setDpi(nuevo);
									lookup.dpiEditado(nuevo);
									// Otro DPI es otra persona: se descartan los datos traídos,
									// vengan del vendedor registrado o de RENAP
									if (existente && existente.dpi !== digitos) {
										setExistente(null);
									}
									// De quién es el nombre y el género en pantalla: de la
									// búsqueda (datosDe) o, si se escribieron a mano, de la
									// persona del DPI que estaba completo antes de editarlo.
									const duenoIdentidad =
										datosDe.current ??
										(anterior.length === 13 ? anterior : null);
									if (duenoIdentidad && duenoIdentidad !== digitos) {
										datosDe.current = null;
										setNombre("");
										setGenero("");
									}
									if (digitos.length === 13) {
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
						{dpiInvalido && (
							<p className="text-destructive text-xs">
								Este número no es un DPI guatemalteco válido: revisa los
								dígitos.
							</p>
						)}
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

					<div className="space-y-2">
						<Label htmlFor="quick-vendor-genero">Género</Label>
						<VendorGenderSelect
							id="quick-vendor-genero"
							value={genero}
							onChange={setGenero}
						/>
					</div>

					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="quick-vendor-correo">Correo (opcional)</Label>
							<Input
								id="quick-vendor-correo"
								type="email"
								placeholder="correo@ejemplo.com"
								value={correo}
								onChange={(e) => setCorreo(e.target.value)}
								aria-invalid={correoInvalido}
								className={correoInvalido ? "border-destructive" : ""}
							/>
							{correoInvalido && (
								<p className="text-destructive text-xs">
									Escribe un correo válido o déjalo vacío.
								</p>
							)}
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
