import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Phone, Save } from "lucide-react";
import { useState } from "react";
import {
	codeudoresDeMas,
	esOportunidadDeSociedad,
	representanteLegalDe,
} from "server/src/lib/oportunidad-de-sociedad";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { client } from "@/utils/orpc";

/**
 * Los celulares del cliente y de los codeudores, para revisarlos antes de
 * mandar la oportunidad a contratos.
 *
 * Al aprobar los contratos, cada persona recibe sus enlaces de firma por
 * WhatsApp a este número. Si falta o está mal, no le llega nada y se descubre
 * recién en 85%, con la papelería ya hecha. Acá se ve y se corrige de una vez.
 *
 * En una sociedad no firma la empresa sino su representante legal (un
 * codeudor marcado): se muestra sólo él, porque el teléfono de la empresa
 * suele ser una planta y ahí no le llega el WhatsApp a nadie.
 */
export function TelefonosParaFirmar({
	opportunityId,
	cliente,
	clientType,
	onGuardado,
}: {
	opportunityId: string;
	cliente: { id: string; nombre: string; phone: string | null } | null;
	/** `leads.client_type`: con "empresa" la oportunidad es de sociedad. */
	clientType?: string | null;
	/** Para que la pantalla recargue lo que muestra del cliente. */
	onGuardado?: () => void;
}) {
	const codeudoresQuery = useQuery({
		// La misma clave que `CoDebtorsView`: al marcar al representante o
		// cargarle el celular desde el detalle, esto se actualiza solo.
		queryKey: ["coDebtors", opportunityId],
		queryFn: () => client.getCoDebtorsByOpportunity({ opportunityId }),
	});

	const codeudores = codeudoresQuery.data ?? [];
	const deSociedad = { clientType, coDeudores: codeudores };
	const esSociedad = esOportunidadDeSociedad(deSociedad);
	const representante = esSociedad ? representanteLegalDe(deSociedad) : null;
	const sobran = codeudoresDeMas(deSociedad).length;

	const personas = esSociedad
		? representante
			? [
					{
						clave: `codeudor-${representante.id}`,
						tipo: "codeudor" as const,
						id: representante.id,
						etiqueta: "Representante legal",
						nombre: representante.fullName,
						phone: representante.phone,
					},
				]
			: []
		: [
				...(cliente
					? [
							{
								clave: `lead-${cliente.id}`,
								tipo: "lead" as const,
								id: cliente.id,
								etiqueta: "Cliente",
								nombre: cliente.nombre,
								phone: cliente.phone,
							},
						]
					: []),
				...codeudores.map((cd, i) => ({
					clave: `codeudor-${cd.id}`,
					tipo: "codeudor" as const,
					id: cd.id,
					etiqueta: `Codeudor ${i + 1}`,
					nombre: cd.fullName,
					phone: cd.phone,
				})),
			];
	const faltan =
		personas.filter((p) => !p.phone?.trim()).length +
		(esSociedad && !representante && !codeudoresQuery.isLoading ? 1 : 0);

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<Phone className="h-4 w-4" />
				<Label className="font-medium text-sm">Celulares para la firma</Label>
				{faltan > 0 && (
					<span className="ml-auto text-amber-600 text-xs dark:text-amber-400">
						Falta{faltan > 1 ? `n ${faltan}` : " 1"}
					</span>
				)}
			</div>
			<div className="space-y-2 rounded-lg border p-3">
				{codeudoresQuery.isLoading && (
					<p className="flex items-center gap-1 text-muted-foreground text-xs">
						<Loader2 className="h-3 w-3 animate-spin" />
						Cargando codeudores…
					</p>
				)}
				{personas.map((persona) => (
					<FilaDeTelefono
						key={persona.clave}
						persona={persona}
						onGuardado={() => {
							if (persona.tipo === "codeudor") codeudoresQuery.refetch();
							else onGuardado?.();
						}}
					/>
				))}
				{esSociedad && !representante && !codeudoresQuery.isLoading && (
					<p className="text-amber-700 text-xs dark:text-amber-400">
						Es una sociedad y no tiene marcado a su representante legal. Marcalo
						en los co-firmantes: es quien firma y a quien le llegan los enlaces.
					</p>
				)}
				{esSociedad && sobran > 0 && (
					<p className="text-amber-700 text-xs dark:text-amber-400">
						Los contratos de sociedad sólo los firma el representante: hay{" "}
						{sobran === 1 ? "un co-firmante" : `${sobran} co-firmantes`} de más
						que jurídico no va a poder incluir.
					</p>
				)}
				<p className="text-muted-foreground text-xs">
					{esSociedad
						? "Es una sociedad: los enlaces de firma le llegan por WhatsApp al representante legal, a este número. Tiene que ser su celular, no el teléfono de la empresa."
						: "Al aprobar los contratos, a cada uno le llegan sus enlaces de firma por WhatsApp a este número."}
				</p>
			</div>
		</div>
	);
}

function FilaDeTelefono({
	persona,
	onGuardado,
}: {
	persona: {
		tipo: "lead" | "codeudor";
		id: string;
		etiqueta: string;
		nombre: string;
		phone: string | null;
	};
	onGuardado: () => void;
}) {
	const guardado = persona.phone?.trim() ?? "";
	const [valor, setValor] = useState(guardado);
	const cambio = valor.trim() !== guardado;
	// Guatemala: 8 dígitos, con o sin el 502 adelante.
	const digitos = valor.replace(/\D/g, "");
	const valido = digitos.length >= 8 && digitos.length <= 12;

	const guardar = useMutation({
		mutationFn: async () => {
			if (persona.tipo === "lead") {
				await client.updateLead({ id: persona.id, phone: valor.trim() });
			} else {
				await client.updateCoDebtor({ id: persona.id, phone: valor.trim() });
			}
		},
		onSuccess: () => {
			toast.success(`Celular de ${persona.nombre} guardado`);
			onGuardado();
		},
		onError: (error: Error) => toast.error(error.message),
	});

	return (
		<div className="flex flex-wrap items-center gap-2">
			<div className="min-w-0 flex-1">
				<p className="truncate text-xs">
					<span className="font-medium">{persona.etiqueta}</span>{" "}
					<span className="text-muted-foreground">{persona.nombre}</span>
				</p>
			</div>
			<Input
				value={valor}
				onChange={(e) => setValor(e.target.value)}
				placeholder="Sin celular"
				inputMode="tel"
				className={`h-8 w-40 text-sm ${
					!guardado && !cambio ? "border-amber-400" : ""
				}`}
				aria-label={`Celular de ${persona.nombre}`}
			/>
			{cambio && (
				<Button
					size="sm"
					variant="outline"
					className="h-8"
					disabled={!valido || guardar.isPending}
					title={
						valido ? undefined : "Tiene que tener 8 dígitos (con o sin 502)"
					}
					onClick={() => guardar.mutate()}
				>
					{guardar.isPending ? (
						<Loader2 className="h-3 w-3 animate-spin" />
					) : (
						<Save className="h-3 w-3" />
					)}
				</Button>
			)}
		</div>
	);
}
