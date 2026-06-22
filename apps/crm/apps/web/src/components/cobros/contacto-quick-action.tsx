import { useQuery } from "@tanstack/react-query";
import { Loader2, Phone } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ContactoModal } from "@/components/contacto-modal";
import { Button } from "@/components/ui/button";
import { orpc } from "@/utils/orpc";

interface ContactoQuickActionProps {
	readonly numeroCredito: string;
}

export function ContactoQuickAction({
	numeroCredito,
}: ContactoQuickActionProps) {
	const [open, setOpen] = useState(false);

	const detalles = useQuery({
		...orpc.getDetallesCreditoCarteraBack.queryOptions({
			input: { creditoId: numeroCredito },
		}),
		enabled: open,
		retry: 1,
	});

	// Detectar errores SOLO al cerrar un ciclo de fetch real (transición
	// fetching → idle). Sin este gate, un error cacheado en react-query haría
	// disparar el toast + close instantáneamente al reabrir, atrapando al usuario
	// en un loop sin posibilidad de reintentar.
	const fetchCycleStartedRef = useRef(false);
	useEffect(() => {
		if (!open) {
			fetchCycleStartedRef.current = false;
			return;
		}
		if (detalles.isFetching) {
			fetchCycleStartedRef.current = true;
			return;
		}
		if (fetchCycleStartedRef.current && detalles.isError) {
			fetchCycleStartedRef.current = false;
			toast.error(
				detalles.error instanceof Error
					? detalles.error.message
					: "No se pudo cargar el caso. Reintentá.",
			);
			setOpen(false);
		}
	}, [open, detalles.isFetching, detalles.isError, detalles.error]);

	// Radix Dialog usa un Portal en el DOM, pero React propaga eventos por el
	// árbol virtual. Sin esto, cualquier click dentro de la modal subiría hasta
	// el <TableRow onClick> y navegaría a /cobros/$id.
	const detenerPropagacion = (e: React.MouseEvent) => {
		e.stopPropagation();
	};

	const handleTriggerClick = (e: React.MouseEvent) => {
		e.stopPropagation();
		setOpen(true);
	};

	const renderBoton = (cargando: boolean) => (
		<Button
			size="icon"
			variant="outline"
			className="h-7 w-7 shrink-0"
			onClick={cargando ? detenerPropagacion : handleTriggerClick}
			disabled={cargando}
			title="Registrar contacto"
			aria-label="Registrar contacto con el cliente"
		>
			{cargando ? (
				<Loader2 className="h-3.5 w-3.5 animate-spin" />
			) : (
				<Phone className="h-3.5 w-3.5" />
			)}
		</Button>
	);

	if (!open) {
		return (
			// biome-ignore lint/a11y/useKeyWithClickEvents: wrapper sólo intercepta clicks para evitar que el row-click navegue; el Button interno mantiene accesibilidad de teclado.
			// biome-ignore lint/a11y/noStaticElementInteractions: wrapper presentacional, sin rol interactivo propio.
			<span role="none" onClick={detenerPropagacion}>
				{renderBoton(false)}
			</span>
		);
	}

	if (detalles.isLoading || !detalles.data) {
		return (
			// biome-ignore lint/a11y/useKeyWithClickEvents: wrapper sólo intercepta clicks para evitar que el row-click navegue; el Button interno mantiene accesibilidad de teclado.
			// biome-ignore lint/a11y/noStaticElementInteractions: wrapper presentacional, sin rol interactivo propio.
			<span role="none" onClick={detenerPropagacion}>
				{renderBoton(true)}
			</span>
		);
	}

	const d = detalles.data;
	const marcaLineaModelo =
		`${d.vehiculoMarca || ""} ${d.vehiculoModelo || ""} ${d.vehiculoYear || ""}`.trim();
	const montoAdeudado = (
		Number(d.montoEnMora || 0) + Number(d.cuotaMensual || 0)
	).toLocaleString("es-GT", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: wrapper sólo intercepta clicks dentro del portal de Radix para evitar que el row-click navegue.
		// biome-ignore lint/a11y/noStaticElementInteractions: wrapper presentacional, sin rol interactivo propio.
		<span role="none" onClick={detenerPropagacion}>
			{renderBoton(false)}
			<ContactoModal
				open={open}
				onOpenChange={setOpen}
				casoCobroId={d.id || ""}
				clienteNombre={d.clienteNombre || ""}
				telefonoPrincipal={d.telefonoPrincipal || ""}
				telefonoAlternativo={
					d.telefonoAlternativo ? String(d.telefonoAlternativo) : undefined
				}
				emailCliente={d.emailContacto || ""}
				metodoInicial="llamada"
				fechaPago={String(d.diaPagoMensual || 15)}
				cuotaMensual={Number(d.cuotaMensual || 0).toLocaleString()}
				placa={d.vehiculoPlaca || ""}
				marcaLineaModelo={marcaLineaModelo}
				montoAdeudado={montoAdeudado}
				cuotasAtraso={d.cuotasVencidas ?? 0}
				estadoMora={d.estadoMora || undefined}
				fechaInicio={d.fechaInicio || null}
				nombreAsesor={d.asesor?.nombre || ""}
				telefonoAsesor={d.asesor?.telefono || ""}
			/>
		</span>
	);
}
