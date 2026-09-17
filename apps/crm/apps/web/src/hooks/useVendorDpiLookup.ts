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
 *
 * Solo se aplica la respuesta del DPI vigente: si el usuario cambió el número
 * mientras RENAP respondía, el resultado viejo se descarta para no mezclar la
 * identidad de una persona con el DPI de otra.
 */
export function useVendorDpiLookup(
	onResult: (result: VendorDpiLookupResult) => void,
) {
	const dpiVigente = useRef<string | null>(null);

	const mutation = useMutation({
		mutationFn: (dpi: string) => client.lookupVendorByDpi({ dpi }),
		onSuccess: (result, dpiConsultado) => {
			if (dpiConsultado !== dpiVigente.current) return;
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
		onError: (error, dpiConsultado) => {
			if (dpiConsultado !== dpiVigente.current) return;
			dpiVigente.current = null;
			toast.error(error.message || "No se pudo consultar el DPI");
		},
	});

	const buscar = (dpi: string, { force = false } = {}) => {
		const limpio = soloDigitosDpi(dpi);
		if (limpio.length !== 13) {
			if (force) toast.error("El DPI debe tener 13 dígitos");
			return;
		}
		if (!force && dpiVigente.current === limpio) return;
		dpiVigente.current = limpio;
		mutation.mutate(limpio);
	};

	/**
	 * Avisar que el DPI del campo cambió. Si ya no es el consultado, la
	 * respuesta pendiente deja de aplicar. Devuelve true si cambió.
	 */
	const dpiEditado = (dpi: string) => {
		const limpio = soloDigitosDpi(dpi);
		if (limpio === dpiVigente.current) return false;
		dpiVigente.current = null;
		return true;
	};

	/** Descartar la búsqueda en curso (al abrir o cerrar un formulario). */
	const cancelar = () => {
		dpiVigente.current = null;
	};

	return {
		buscar,
		dpiEditado,
		cancelar,
		/** El DPI cuyos datos están aplicados (o en camino). */
		dpiVigente: () => dpiVigente.current,
		isPending: mutation.isPending,
	};
}
