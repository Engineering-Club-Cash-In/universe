import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
	encabezadoReferencia,
	TEXTO_SIN_VERIFICAR,
	textoAvisoReferencia,
	textoCoincidencia,
	textoMas,
} from "@/lib/texto-referencia-repetida";
import type { AlertaReferencias } from "../../../../server/src/routers/client-forms";

type ParticipanteConReferencias = AlertaReferencias["participantes"][number];
export type ReferenciaRepetida =
	ParticipanteConReferencias["referencias"][number];

function AlertaAmbar({ children }: { children: ReactNode }) {
	return (
		<Alert variant="default" className="border-amber-500 bg-amber-50">
			<AlertTriangle className="h-4 w-4 text-amber-600" />
			<AlertDescription className="space-y-3 text-amber-800 text-sm">
				{children}
			</AlertDescription>
		</Alert>
	);
}

/**
 * Alerta ámbar (no bloquea nada) de las referencias de un participante que ya
 * figuran en otro cliente. Con detalle, quién es cada uno; sin detalle (el
 * servidor no lo mandó), solo el aviso. Sin referencias no muestra nada.
 */
export function AlertaReferenciasRepetidas({
	referencias,
}: {
	referencias: ReferenciaRepetida[];
}) {
	if (referencias.length === 0) return null;
	return (
		<AlertaAmbar>
			{referencias.map((ref) => {
				const clave = `${ref.tipo}:${ref.indice}`;
				if (!ref.coincidencias) {
					return <p key={clave}>{textoAvisoReferencia(ref)}</p>;
				}
				const conDetalle = { ...ref, coincidencias: ref.coincidencias };
				return (
					<div key={clave} className="space-y-1">
						<p>{encabezadoReferencia(conDetalle)}</p>
						<ul className="list-disc space-y-0.5 pl-5">
							{conDetalle.coincidencias.map((c) => (
								<li key={`${c.tipo}:${c.leadId ?? c.oportunidadId}`}>
									{textoCoincidencia(c)}
								</li>
							))}
							{textoMas(conDetalle) && <li>{textoMas(conDetalle)}</li>}
						</ul>
					</div>
				);
			})}
		</AlertaAmbar>
	);
}

/** La búsqueda falló: se dice, para no confundirlo con «sin coincidencias». */
export function AlertaSinVerificar() {
	return (
		<AlertaAmbar>
			<p>{TEXTO_SIN_VERIFICAR}</p>
		</AlertaAmbar>
	);
}

/** «Titular: Ana López», «Co-firmante 1: Carlos» o solo la etiqueta si no hay nombre propio. */
export function tituloDelParticipante(p: { nombre: string; etiqueta: string }) {
	return p.nombre && p.nombre !== p.etiqueta
		? `${p.etiqueta}: ${p.nombre}`
		: p.etiqueta;
}

/** Las alertas de varios participantes, cada una con quién es. */
export function ReferenciasPorParticipante({
	participantes,
}: {
	participantes: ParticipanteConReferencias[];
}) {
	return participantes.map((participante) => (
		<div
			key={`${participante.personType}:${participante.personId}`}
			className="space-y-1"
		>
			<p className="font-medium text-sm">
				Referencias de la solicitud · {tituloDelParticipante(participante)}
			</p>
			<AlertaReferenciasRepetidas referencias={participante.referencias} />
		</div>
	));
}
