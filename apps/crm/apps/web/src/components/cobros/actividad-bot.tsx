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
import { AlertCircle, Bot, UserRound, UsersRound } from "lucide-react";
import {
	HistorialGestiones,
	type ItemGestion,
	SeccionHistorial,
} from "@/components/cobros/ficha/ficha-pestanas";
import { Badge } from "@/components/ui/badge";
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
			return `Ingresó al bot${tipo ? ` con ${tipo}` : ""}${
				busqueda ? ` (${busqueda})` : ""
			} — código enviado${destino ? ` a ${destino}` : ""}${simulado}`;
		}

		case "acceso_fallido":
			switch (interaccion.codigo) {
				case "DEMASIADOS_ENVIOS":
					return "Intentó ingresar, pero ya había solicitado demasiados códigos";
				case "SIN_TELEFONO_REGISTRADO":
					return "Intentó ingresar, pero no tiene un celular válido registrado";
				case "OTP_NO_ENVIADO":
					return "Intentó ingresar, pero no se pudo enviar el SMS";
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
					return `Ingresó un código incorrecto${restantes}`;
				}
				case "DEMASIADOS_INTENTOS":
					return "Se bloqueó por exceso de intentos; debe solicitar un código nuevo";
				case "OTP_VENCIDO":
					return "Ingresó un código vencido";
				case "OTP_YA_USADO":
					return "Ingresó un código que ya había utilizado";
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
				? "Solicitó su estado de cuenta"
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
					return "Subió una boleta que ya había enviado";
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
			return `No se pudo confirmar la boleta (${interaccion.codigo})`;
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
	const actividad = useQuery({
		...orpc.getActividadBot.queryOptions({ input: { casoCobroId } }),
		enabled: !!casoCobroId,
	});

	const sesiones = actividad.data?.sesiones ?? [];
	const accesosFallidos = actividad.data?.accesosFallidos ?? [];

	const items: ItemGestion[] = sesiones.map((sesion) => {
		const fallidas = sesion.interacciones.filter((i) => !i.exito).length;
		return {
			id: `${sesion.numero}-${sesion.referenciaSufijo}`,
			cuando: fechaHora(sesion.inicio),
			titulo: (
				<span
					className="inline-flex items-center gap-1.5"
					title={`Referencia …${sesion.referenciaSufijo}`}
				>
					<Bot className="h-3.5 w-3.5" />
					Referencia {sesion.numero}
				</span>
			),
			badge: (
				<Badge variant="outline" className="gap-1 text-[10px]">
					{sesion.operadoPor === "codeudor" ? (
						<UsersRound className="h-3 w-3" />
					) : (
						<UserRound className="h-3 w-3" />
					)}
					{sesion.operadoPor === "codeudor"
						? `Codeudor${sesion.codeudorNombre ? `: ${sesion.codeudorNombre}` : ""}`
						: "Titular"}
				</Badge>
			),
			subtitulo: `${sesion.interacciones.length} ${sesion.interacciones.length === 1 ? "interacción" : "interacciones"}${fallidas > 0 ? ` · ${fallidas} con error` : ""}`,
			tono: fallidas > 0 ? "sin-contacto" : "logrado",
			detalleEtiqueta: "Ver lo que hizo en el bot",
			detalleNodo: (
				<div>
					{sesion.interacciones.map((interaccion) => (
						<FilaInteraccion
							key={interaccion.id}
							interaccion={interaccion}
							numeroSifcoCaso={numeroSifcoCaso}
						/>
					))}
				</div>
			),
		};
	});
	if (accesosFallidos.length > 0) {
		items.push({
			id: "accesos-fallidos",
			cuando: fechaHora(accesosFallidos[0].creadoEn),
			titulo: "Intentos de acceso sin sesión",
			subtitulo: `${accesosFallidos.length} ${accesosFallidos.length === 1 ? "intento" : "intentos"}`,
			tono: "fallido",
			detalleEtiqueta: "Ver los intentos",
			detalleNodo: (
				<div>
					{accesosFallidos.map((interaccion) => (
						<div key={interaccion.id} className="flex items-start gap-3 py-1.5">
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
			),
		});
	}

	return (
		<SeccionHistorial
			titulo="Actividad en el bot de WhatsApp"
			conteo={actividad.isLoading ? "…" : sesiones.length}
			icono={<Bot />}
			// Codex (PR #1411): un fallo de red/permiso NO es "nunca usó el bot" —
			// decir eso convertiría un error nuestro en historial falso.
			estado={
				actividad.isLoading
					? "cargando"
					: actividad.isError
						? "error"
						: items.length === 0
							? "vacio"
							: "ok"
			}
			onReintentar={() => actividad.refetch()}
			vacio="Este cliente todavía no ha usado el bot de WhatsApp."
		>
			<HistorialGestiones items={items} />
		</SeccionHistorial>
	);
}
