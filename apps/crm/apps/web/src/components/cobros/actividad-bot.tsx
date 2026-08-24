/**
 * Actividad del cliente en el bot de WhatsApp, agrupada por referencia.
 *
 * La conversación del bot ya tiene un id —la referencia del paso 1— y el
 * server la devuelve agrupada y numerada (getActividadBot): acá solo se pinta.
 * "Referencia 1" es la sesión más vieja del cliente; se muestran TODAS sus
 * sesiones (titular y codeudores), y lo que fue sobre OTRO crédito va marcado
 * con su SIFCO en vez de esconderse.
 *
 * Contrato: docs/features/bot-whatsapp-cobros/06-historial-interacciones.md
 */

import { useQuery } from "@tanstack/react-query";
import {
	AlertCircle,
	Bot,
	ChevronDown,
	ChevronRight,
	UserRound,
	UsersRound,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { orpc } from "@/utils/orpc";

type InteraccionBot = {
	id: string;
	accion: string;
	exito: boolean;
	codigo: string | null;
	numeroSifco: string | null;
	detalle: Record<string, unknown>;
	creadoEn: string | Date;
};

const fechaHora = (fecha: string | Date) =>
	new Date(fecha).toLocaleString("es-GT", {
		day: "numeric",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});

const hora = (fecha: string | Date) =>
	new Date(fecha).toLocaleTimeString("es-GT", {
		hour: "2-digit",
		minute: "2-digit",
	});

const texto = (valor: unknown): string | null =>
	typeof valor === "string" && valor !== "" ? valor : null;

/** La línea que lee el asesor: qué hizo el cliente, en cristiano. */
function describir(interaccion: InteraccionBot): string {
	const d = interaccion.detalle ?? {};

	switch (interaccion.accion) {
		case "buscar_cliente": {
			const tipo = texto(d.tipoBusqueda)?.toUpperCase();
			const busqueda = texto(d.busqueda);
			const destino = texto(d.otpEnviadoA);
			const simulado = d.otpSimulado === true ? " · simulado" : "";
			return `Entró al bot${tipo ? ` con ${tipo}` : ""}${
				busqueda ? ` (${busqueda})` : ""
			} — código enviado${destino ? ` a ${destino}` : ""}${simulado}`;
		}

		case "acceso_fallido":
			switch (interaccion.codigo) {
				case "DEMASIADOS_ENVIOS":
					return "Quiso entrar, pero ya había pedido demasiados códigos";
				case "SIN_TELEFONO_REGISTRADO":
					return "Quiso entrar, pero no tiene un celular utilizable registrado";
				case "OTP_NO_ENVIADO":
					return "Quiso entrar y nuestro SMS falló";
				default:
					return `Intento de acceso fallido (${interaccion.codigo ?? "sin código"})`;
			}

		case "listar_creditos": {
			if (interaccion.exito) {
				const creditos = typeof d.creditos === "number" ? d.creditos : null;
				return creditos === 1
					? "Código validado — se listó su crédito"
					: `Código validado — se listaron ${creditos ?? "sus"} créditos`;
			}
			switch (interaccion.codigo) {
				case "OTP_INVALIDO": {
					const restantes =
						typeof d.intentosRestantes === "number"
							? ` (le quedaban ${d.intentosRestantes})`
							: "";
					return `Escribió un código incorrecto${restantes}`;
				}
				case "DEMASIADOS_INTENTOS":
					return "Se bloqueó por intentos: necesita pedir un código nuevo";
				case "OTP_VENCIDO":
					return "Escribió un código que ya había vencido";
				case "OTP_YA_USADO":
					return "Reusó un código ya canjeado";
				case "SIN_CREDITOS":
					return "Código validado, pero sin créditos que listar";
				default:
					return `No pudo validar el código (${interaccion.codigo})`;
			}
		}

		case "menu_credito":
			return interaccion.exito
				? "Consultó el menú de su crédito"
				: `No pudo consultar el menú (${interaccion.codigo})`;

		case "estado_cuenta":
			return interaccion.exito
				? "Pidió su estado de cuenta"
				: `No pudo obtener su estado de cuenta (${interaccion.codigo})`;

		case "boleta_leer": {
			if (interaccion.exito) {
				const monto = texto(d.monto);
				const banco = texto(d.banco);
				return `Subió una boleta — leída${monto ? `: Q${monto}` : ""}${
					banco ? ` · ${banco}` : ""
				}`;
			}
			switch (interaccion.codigo) {
				case "BOLETA_ILEGIBLE":
					return "Subió una boleta que no se pudo leer";
				case "BOLETA_DUPLICADA":
					return "Subió una boleta que ya nos había mandado";
				case "DEMASIADOS_INTENTOS":
					return "Agotó sus intentos de lectura de boleta";
				default:
					return `Subió una boleta y la lectura falló (${interaccion.codigo})`;
			}
		}

		case "boleta_confirmar": {
			if (interaccion.exito) {
				const monto = texto(d.monto);
				const pagos = typeof d.pagos === "number" ? d.pagos : null;
				return `Confirmó la boleta — pago${
					monto ? ` de Q${monto}` : ""
				} registrado en cartera${pagos && pagos > 1 ? ` (${pagos} pagos)` : ""}`;
			}
			return `Quiso confirmar la boleta y no se pudo (${interaccion.codigo})`;
		}

		// Una acción futura sin traducción se muestra igual (regla general del
		// historial): mejor cruda que invisible.
		default:
			return `${interaccion.accion.replace(/_/g, " ")}${
				interaccion.exito ? "" : ` — ${interaccion.codigo ?? "falló"}`
			}`;
	}
}

function FilaInteraccion({
	interaccion,
	numeroSifcoCaso,
}: {
	interaccion: InteraccionBot;
	numeroSifcoCaso: string | null;
}) {
	const deOtroCredito =
		interaccion.numeroSifco &&
		numeroSifcoCaso &&
		interaccion.numeroSifco !== numeroSifcoCaso;

	return (
		<div className="flex items-start gap-3 py-1.5">
			<span className="w-12 shrink-0 pt-0.5 text-muted-foreground text-xs tabular-nums">
				{hora(interaccion.creadoEn)}
			</span>
			<div className="min-w-0 flex-1">
				<p
					className={`text-sm ${
						interaccion.exito
							? "text-foreground"
							: "text-amber-700 dark:text-amber-400"
					}`}
				>
					{!interaccion.exito && (
						<AlertCircle className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
					)}
					{describir(interaccion)}
				</p>
				{deOtroCredito && (
					<Badge
						variant="outline"
						className="mt-0.5 text-[10px] text-muted-foreground"
					>
						Crédito {interaccion.numeroSifco}
					</Badge>
				)}
			</div>
		</div>
	);
}

export function ActividadBot({
	casoCobroId,
	numeroSifcoCaso,
}: {
	casoCobroId: string;
	numeroSifcoCaso: string | null;
}) {
	const [abiertas, setAbiertas] = useState<Set<number>>(new Set());
	const [fallidosAbiertos, setFallidosAbiertos] = useState(false);

	const actividad = useQuery({
		...orpc.getActividadBot.queryOptions({ input: { casoCobroId } }),
		enabled: !!casoCobroId,
	});

	const sesiones = actividad.data?.sesiones ?? [];
	const accesosFallidos = actividad.data?.accesosFallidos ?? [];

	const alternar = (numero: number) => {
		setAbiertas((previas) => {
			const siguientes = new Set(previas);
			if (siguientes.has(numero)) siguientes.delete(numero);
			else siguientes.add(numero);
			return siguientes;
		});
	};

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between">
				<CardTitle className="flex items-center gap-2">
					<Bot className="h-5 w-5" />
					Actividad en el bot de WhatsApp
				</CardTitle>
				{sesiones.length > 0 && (
					<span className="text-muted-foreground text-sm">
						{sesiones.length === 1 ? "1 sesión" : `${sesiones.length} sesiones`}
					</span>
				)}
			</CardHeader>
			<CardContent>
				{actividad.isLoading ? (
					<p className="py-6 text-center text-muted-foreground text-sm">
						Cargando actividad del bot…
					</p>
				) : sesiones.length === 0 && accesosFallidos.length === 0 ? (
					<p className="py-6 text-center text-muted-foreground text-sm">
						Este cliente todavía no ha usado el bot de WhatsApp.
					</p>
				) : (
					<div className="space-y-2">
						{sesiones.map((sesion) => {
							const abierta = abiertas.has(sesion.numero);
							return (
								<div
									key={`${sesion.numero}-${sesion.referenciaSufijo}`}
									className="rounded-md border"
								>
									<button
										type="button"
										onClick={() => alternar(sesion.numero)}
										className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50"
										title={`Referencia …${sesion.referenciaSufijo}`}
									>
										{abierta ? (
											<ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
										) : (
											<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
										)}
										<span className="font-medium text-sm">
											Referencia {sesion.numero}
										</span>
										<span className="text-muted-foreground text-xs">
											{fechaHora(sesion.inicio)}
										</span>
										<Badge
											variant="outline"
											className="ml-auto shrink-0 gap-1 text-[10px]"
										>
											{sesion.operadoPor === "codeudor" ? (
												<UsersRound className="h-3 w-3" />
											) : (
												<UserRound className="h-3 w-3" />
											)}
											{sesion.operadoPor === "codeudor"
												? `Codeudor${sesion.codeudorNombre ? `: ${sesion.codeudorNombre}` : ""}`
												: "Titular"}
										</Badge>
										<span className="shrink-0 text-muted-foreground text-xs">
											{sesion.interacciones.length}
										</span>
									</button>
									{abierta && (
										<div className="border-t px-3 py-2">
											{sesion.interacciones.map((interaccion) => (
												<FilaInteraccion
													key={interaccion.id}
													interaccion={interaccion}
													numeroSifcoCaso={numeroSifcoCaso}
												/>
											))}
										</div>
									)}
								</div>
							);
						})}

						{accesosFallidos.length > 0 && (
							<div className="rounded-md border border-dashed">
								<button
									type="button"
									onClick={() => setFallidosAbiertos((previo) => !previo)}
									className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50"
								>
									{fallidosAbiertos ? (
										<ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
									) : (
										<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
									)}
									<span className="font-medium text-muted-foreground text-sm">
										Intentos de acceso sin sesión
									</span>
									<span className="ml-auto shrink-0 text-muted-foreground text-xs">
										{accesosFallidos.length}
									</span>
								</button>
								{fallidosAbiertos && (
									<div className="border-t px-3 py-2">
										{accesosFallidos.map((interaccion) => (
											<div
												key={interaccion.id}
												className="flex items-start gap-3 py-1.5"
											>
												<span className="w-32 shrink-0 pt-0.5 text-muted-foreground text-xs tabular-nums">
													{fechaHora(interaccion.creadoEn)}
												</span>
												<p className="text-amber-700 text-sm dark:text-amber-400">
													<AlertCircle className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
													{describir(interaccion)}
												</p>
											</div>
										))}
									</div>
								)}
							</div>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
