/**
 * Traduce a español claro qué pasó con el acceso al Portal del Inversionista.
 *
 * El alta devuelve `accesoPortal` desde cartera, pero nadie lo miraba: el
 * `onSuccess` mostraba un toast verde y cerraba el modal. En el escenario
 * peligroso —cuenta creada y contraseña desviada, o Resend caído— conta veía
 * "creado correctamente" y seguía, y el inversionista quedaba con una cuenta que
 * no sabe que tiene. Nadie se enteraba hasta el resumen del día siguiente.
 *
 * Los textos van sin jerga a propósito: quien lee esto no sabe qué es SERVER,
 * PROD ni un código de advertencia. Cada uno dice QUÉ pasó y QUÉ hacer, con el
 * inversionista todavía al teléfono.
 *
 * NOTA DE DUPLICACIÓN: carteraFront tiene el gemelo de este archivo en
 * `private/cartera/components/accesoPortal.ts`. Son dos apps sin paquete común
 * (mismo caso que rep-legal-empresa.ts); si cambian los códigos del backend hay
 * que tocar los dos.
 *
 * Pero NO son idénticos ni deben serlo: `COMO_SE_ARREGLA` diverge a propósito,
 * porque el botón que se manda a apretar existe en carteraFront y no aquí.
 * Resincronizar los dos archivos a ciegas reintroduce el bug.
 */

export interface AccesoPortal {
	estado: string;
	usuarioEmail: string | null;
	correo: {
		enviado: boolean;
		plantilla: string | null;
		redirigido: boolean;
		destinatarioReal: string | null;
	};
	advertencias: string[];
	motivo: string | null;
}

export interface AvisoAccesoPortal {
	tono: "exito" | "advertencia";
	texto: string;
}

/**
 * A dónde se manda a quien quedó sin acceso.
 *
 * ANTES esto decía "mañana a las 7:00 a.m.": la reconciliación diaria creaba
 * las cuentas sola. Ya no. Ahora detecta y reporta, y abrir la cuenta lo
 * dispara una persona, porque `cartera.inversionistas` se escribe desde
 * caminos que no prueban identidad y el correo de una fila puede no ser de su
 * dueño; mandar una contraseña sin que nadie mire ese correo era el agujero.
 *
 * Seguir prometiendo el automatismo sería peor que callar: conta cerraría el
 * modal tranquila, nadie apretaría el botón, y la persona se quedaría sin
 * portal esperando algo que no va a pasar.
 *
 * Y dice "pedile a cartera" porque ese botón NO está en esta aplicación: vive
 * en carteraFront (`tableInvestors.tsx`), la ruta es ADMIN de cartera a
 * propósito (`otorgarAccesoPortal.ts`), y el CRM habla con cartera-back con una
 * credencial de servicio compartida, así que exponerlo aquí le daría a
 * cualquiera con acceso a liquidaciones la facultad de mandar contraseñas.
 * Mandar a conta a un botón que en su pantalla no existe la deja buscándolo:
 * el aviso llega, pero a alguien que no puede ejecutarlo. El gemelo de
 * carteraFront dice "abrile el acceso" a secas, y ahí es correcto.
 */
const COMO_SE_ARREGLA =
  'pedile a cartera que le abra el acceso desde el menú del inversionista, opción "Dar acceso al portal"';

/**
 * Por qué no se pudo, en palabras. Lo que no está en la lista se calla en vez de
 * enseñar el código crudo: el detalle técnico ya viaja en `audit_logs`.
 */
const CAUSA_EN_PALABRAS: Record<string, string> = {
	timeout: "el portal no respondió a tiempo",
	provisionamiento_no_configurado: "al servidor le falta configuración",
	representante_no_encontrado_en_cartera:
		"no se encontró a su representante legal",
	representante_sin_cuenta:
		"su representante legal todavía no tiene cuenta en el portal",
};

const causa = (motivo: string | null): string => {
	const texto = motivo ? CAUSA_EN_PALABRAS[motivo] : undefined;
	if (texto) return ` (${texto})`;
	if (motivo?.startsWith("http_")) return " (el portal respondió con un error)";
	return "";
};

/**
 * En orden de gravedad. `correo_no_enviado` va al final porque siempre viene
 * acompañado de la advertencia fuerte cuando lo que se perdió fue el ACCESO;
 * solo se dice solo cuando lo que no salió fue un aviso.
 */
const texto = (
	advertencia: string,
	acceso: AccesoPortal,
): string | null => {
	switch (advertencia) {
		case "cuenta_creada_sin_contrasena_entregada":
			return "Se le creó la cuenta del portal pero el correo con su contraseña NO salió: no puede entrar y no lo sabe. La contraseña no queda guardada, así que hay que restablecerle el acceso a mano. Avisa a sistemas.";
		case "correo_redirigido_por_modo_no_prod":
			return `El correo con su contraseña NO le llegó: el sistema está mandando todos los correos a ${acceso.correo.destinatarioReal ?? "una sola bandeja de pruebas"}. La cuenta sí quedó creada. Avisa a sistemas antes de decirle que ya puede entrar.`;
		case "cuenta_creada_sin_rol_ni_dpi":
			return "La cuenta quedó creada pero sin quedar ligada a este inversionista: si no se corrige, mañana se le puede crear una segunda cuenta. Avisa a sistemas.";
		case "rol_no_promovido":
			return "Ya tenía cuenta, pero no se le pudo dar el permiso de inversionista: al entrar no va a ver su información. Avisa a sistemas.";
		case "correo_de_cartera_distinto_al_de_la_cuenta":
			return `Ya tenía cuenta en el portal con otro correo: ${acceso.usuarioEmail ?? "uno distinto"}. Entra con ese, no con el que acabas de capturar.`;
		case "cuenta_anclada_solo_por_correo":
			return "Ya tenía cuenta y se le reconoció solo por el correo. Si alguien le cambia el correo, se le va a crear una segunda cuenta. Avisa a sistemas.";
		case "correo_no_enviado":
			return acceso.advertencias.includes(
				"cuenta_creada_sin_contrasena_entregada",
			)
				? null
				: "El correo de aviso del portal no salió. Hay que reenviarlo: avisa a sistemas.";
		default:
			return null;
	}
};

export const avisoAccesoPortal = (
	acceso: AccesoPortal | null | undefined,
): AvisoAccesoPortal | null => {
	if (!acceso) return null;

	const avisos = acceso.advertencias
		.map((a) => texto(a, acceso))
		.filter((t): t is string => t !== null);

	if (avisos.length > 0) {
		return { tono: "advertencia", texto: avisos.join(" ") };
	}

	if (acceso.estado === "fallo") {
		// El alta SÍ salió: decirlo es lo que evita que lo vuelvan a crear y se
		// estrellen contra el guard de duplicados.
		return {
			tono: "advertencia",
			texto: `No se le pudo dar acceso al portal${causa(acceso.motivo)}, pero el inversionista sí quedó creado: no lo vuelvas a crear. Cuando quieras, ${COMO_SE_ARREGLA}.`,
		};
	}

	if (acceso.estado === "omitida") {
		if (acceso.motivo === "sin_correo") {
			return {
				tono: "advertencia",
				texto: `Quedó sin acceso al portal porque no tiene correo capturado. Agrégaselo y después ${COMO_SE_ARREGLA}.`,
			};
		}
		if (acceso.motivo === "sin_nombre") {
			return {
				tono: "advertencia",
				texto: `Quedó sin acceso al portal porque no tiene nombre capturado. Agrégaselo y después ${COMO_SE_ARREGLA}.`,
			};
		}
		if (acceso.motivo === "no_solicitado") {
			return {
				tono: "advertencia",
				texto: `Este alta no pidió abrirle acceso al portal. Si le toca tenerlo, ${COMO_SE_ARREGLA}.`,
			};
		}
		if (acceso.motivo === "es_empresa") {
			return {
				tono: "exito",
				texto: "Es una empresa: al portal entra con su representante legal.",
			};
		}
		return null;
	}

	if (acceso.estado === "creada") {
		return {
			tono: "exito",
			texto: "Se le mandó por correo su acceso al portal.",
		};
	}
	if (acceso.estado === "ya_tenia") {
		return { tono: "exito", texto: "Ya tenía acceso al portal." };
	}
	if (acceso.estado === "avisada") {
		return {
			tono: "exito",
			texto:
				"Se le avisó a su representante legal que ahora lo representa en el portal.",
		};
	}

	return null;
};
