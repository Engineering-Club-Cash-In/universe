/**
 * Tarjeta «Proyección de mora del mes» del caso de cobros.
 *
 * La mora sube todos los días, así que «debe Q73» sirve hoy y queda corto el
 * viernes. Acá el asesor ve con cuánto arrancó el mes, cuánto debe hoy y a
 * cuánto llega a fin de mes si el cliente no paga, y puede elegir un día para
 * decirle al cliente cuánto va a deber ESE día.
 *
 * Los días ya pasados son la mora real que registró el sistema (si pagó el 10,
 * ese día baja); de hoy en adelante es una proyección que asume que no entra
 * ningún pago más. Cada día dice cuál de las dos es: una es un hecho y la
 * otra un supuesto.
 */

import { TrendingUp } from "lucide-react";
import { useState } from "react";
import type {
	ProyeccionMoraDia,
	ProyeccionMoraMesResponse,
} from "server/src/types/cartera-back";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * La tarjeta solo tiene sentido si el crédito debe mora o tiene cuotas
 * vencidas (aunque su mora esté en cero porque ya la pagó: mañana vuelve a
 * subir). En un crédito al día sería una fila de ceros.
 */
export function debeMostrarProyeccionMora(caso: {
	montoEnMora?: string | number | null;
	cuotasVencidas?: number | null;
}): boolean {
	return Number(caso.montoEnMora ?? 0) > 0 || (caso.cuotasVencidas ?? 0) > 0;
}

const q = (valor: string | number) =>
	`Q${Number(valor).toLocaleString("es-GT", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;

/** Con signo: «+Q3.73» si sube, «−Q8.67» si ese día bajó (pagó). */
const conSigno = (valor: string) =>
	`${Number(valor) < 0 ? "−" : "+"}${q(Math.abs(Number(valor)))}`;

const ETIQUETA: Record<ProyeccionMoraDia["tipo"], string> = {
	real: "Real",
	hoy: "Hoy",
	proyeccion: "Proyección",
};

function Cifra(props: { titulo: string; valor: string; className?: string }) {
	return (
		<div className="space-y-1">
			<p className="text-muted-foreground text-sm">{props.titulo}</p>
			<p className={`font-bold text-lg ${props.className ?? ""}`}>
				{props.valor}
			</p>
		</div>
	);
}

export function ProyeccionMoraCard(props: {
	montoEnMora?: string | number | null;
	cuotasVencidas?: number | null;
	proyeccion?: ProyeccionMoraMesResponse;
	isLoading?: boolean;
	isError?: boolean;
	/** Día seleccionado al abrir (por defecto, hoy). */
	diaInicial?: string;
}) {
	const [elegido, setElegido] = useState(props.diaInicial);
	if (!debeMostrarProyeccionMora(props)) return null;

	const p = props.proyeccion;
	const dia =
		p?.dias.find((d) => d.fecha === (elegido ?? p.hoy)) ??
		p?.dias.find((d) => d.fecha === p.hoy);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<TrendingUp className="h-5 w-5" />
					Proyección de mora del mes
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				{props.isLoading ? (
					<div className="animate-pulse space-y-2">
						<div className="h-4 rounded bg-gray-200" />
						<div className="h-24 rounded bg-gray-200" />
					</div>
				) : props.isError || !p || !dia ? (
					<p className="text-muted-foreground text-sm">
						No se pudo cargar la proyección de mora.
					</p>
				) : (
					<>
						<div className="grid grid-cols-3 gap-4">
							<Cifra
								titulo="Mora al iniciar el mes"
								valor={q(p.moraInicioMes)}
							/>
							<Cifra
								titulo="Mora hoy"
								valor={q(p.moraHoy)}
								className="text-red-600"
							/>
							<Cifra
								titulo="A fin de mes si no paga"
								valor={q(p.moraFinMes)}
								className="text-purple-700"
							/>
						</div>

						<div className="space-y-3 rounded-lg border p-3">
							<div className="flex flex-wrap items-end gap-3">
								<div className="space-y-1">
									<Label htmlFor="proyeccion-mora-dia">
										Ver un día del mes
									</Label>
									<Input
										id="proyeccion-mora-dia"
										type="date"
										className="w-44"
										// Solo el mes en curso: de otros meses no hay proyección.
										min={p.dias[0]?.fecha}
										max={p.dias[p.dias.length - 1]?.fecha}
										value={dia.fecha}
										onChange={(e) => setElegido(e.target.value)}
									/>
								</div>
								<Badge variant={dia.tipo === "real" ? "secondary" : "outline"}>
									{ETIQUETA[dia.tipo]}
								</Badge>
							</div>
							<div className="grid grid-cols-2 gap-4 md:grid-cols-4">
								<Cifra
									titulo={
										dia.tipo === "real"
											? "Mora al cierre de ese día"
											: "Mora estimada ese día"
									}
									valor={q(dia.mora)}
								/>
								<Cifra
									titulo={
										Number(dia.incremento) < 0 ? "Bajó ese día" : "Sube ese día"
									}
									valor={conSigno(dia.incremento)}
									className={Number(dia.incremento) < 0 ? "text-green-600" : ""}
								/>
								<Cifra
									titulo="Acumulado desde el día 1"
									valor={conSigno(dia.acumuladoMes)}
								/>
								<Cifra
									titulo="Cuotas que siguen sumando"
									// El historial no guarda cuántas cuotas sumaban un día pasado.
									valor={
										dia.cuotasSumando == null ? "—" : `${dia.cuotasSumando}`
									}
								/>
							</div>
						</div>

						<p className="text-muted-foreground text-xs">
							Cada cuota vencida suma {q(p.cargoDiario)} por día, hasta 30 días.
							La proyección asume que no entra ningún pago más e incluye las
							cuotas que vencen en lo que queda del mes.
						</p>
					</>
				)}
			</CardContent>
		</Card>
	);
}
