import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";
import { toast } from "sonner";
import { client } from "@/utils/orpc";

export type VendorGender = "male" | "female";

export type VendorDpiLookupResult = Awaited<
	ReturnType<typeof client.lookupVendorByDpi>
>;

export const soloDigitosDpi = (dpi: string) => dpi.replace(/\D/g, "");

/**
 * Busca los datos del dueño por DPI (vendedor registrado → copia local de
 * RENAP → RENAP). Recuerda el último DPI consultado para no volver a pagar
 * RENAP si el usuario re-escribe el mismo número.
 */
export function useVendorDpiLookup(
	onResult: (result: VendorDpiLookupResult) => void,
) {
	const ultimoDpi = useRef<string | null>(null);

	const mutation = useMutation({
		mutationFn: (dpi: string) => client.lookupVendorByDpi({ dpi }),
		onSuccess: (result) => {
			onResult(result);
			if (result.fuente === "renap") {
				toast.success("Datos obtenidos de RENAP");
			} else if (result.fuente === "vendedor") {
				toast.info("Este DPI ya está registrado como vendedor");
			} else {
				toast.warning(
					"RENAP no devolvió datos para este DPI, complétalos a mano",
				);
			}
		},
		onError: (error) => {
			ultimoDpi.current = null;
			toast.error(error.message || "No se pudo consultar el DPI");
		},
	});

	const buscar = (dpi: string, { force = false } = {}) => {
		const limpio = soloDigitosDpi(dpi);
		if (limpio.length !== 13) {
			if (force) toast.error("El DPI debe tener 13 dígitos");
			return;
		}
		if (!force && ultimoDpi.current === limpio) return;
		ultimoDpi.current = limpio;
		mutation.mutate(limpio);
	};

	return { buscar, isPending: mutation.isPending };
}
