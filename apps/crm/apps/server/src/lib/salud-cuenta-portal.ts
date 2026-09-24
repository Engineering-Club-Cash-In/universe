/**
 * Las dos decisiones que el CRM toma leyendo una respuesta de acceso al portal:
 * si el botón se apaga (`tieneCuentaSana`) y si el apretón deja fila en la
 * bitácora (`exigeConstancia`).
 *
 * Viven juntas porque leen EL MISMO payload —`estado`, `advertencias`,
 * `motivo`, `correo`, tal como los arma `portalProvisioning.ts` de
 * cartera-back— y porque las dos son asimétricas hacia el mismo lado: ante la
 * duda, `tieneCuentaSana` dice `false` y `exigeConstancia` dice `true`. Las dos
 * eligen el error barato.
 *
 * Y las dos son LISTAS BLANCAS. Es la forma, no un detalle: una lista negra
 * decide "sí" ante lo que no conoce, y lo que no conoce es exactamente lo que
 * va a llegar el día que auth-google agregue un código o renombre uno de los de
 * hoy.
 */

export interface AccesoPortalConsultado {
	estado?: string | null;
	advertencias?: string[] | null;
}

/**
 * ¿La cuenta del portal de este inversionista existe Y SIRVE?
 *
 * POR QUÉ ES UN BOOLEANO Y NO LO DECIDE EL FRONT
 * ----------------------------------------------
 * El CRM pone el botón de "Dar acceso al portal" en GRIS cuando esto dice
 * `true`. O sea que este valor no describe: DESHABILITA. Si marcáramos sana una
 * cuenta rota —existe, pero al entrar no ve ninguna de sus inversiones— esa
 * persona quedaría con el botón deshabilitado y SIN ninguna forma de arreglarlo
 * desde la pantalla, que es el peor desenlace posible: el síntoma desaparece
 * de la vista y nadie lo persigue.
 *
 * Los dos errores no cuestan lo mismo, y por eso esto es asimétrico a propósito:
 *   - Falso positivo (decir sana a una rota): encierra a alguien tras un botón gris.
 *   - Falso negativo (decir rota a una sana): un click de más, que cartera
 *     contesta "ya tenía" sin mandarle ninguna contraseña a nadie.
 * Ante cualquier duda, `false`. Y "duda" incluye una advertencia que no
 * conocemos, una respuesta sin `advertencias` y una lista que no es de textos.
 */

/**
 * Las ÚNICAS advertencias que dejan una cuenta sana. Cualquier otra —conocida o
 * no— la vuelve insana.
 *
 * Es una lista blanca, no una lista negra, y ese es todo el punto: enumerar lo
 * roto significaría devolver `true` ante lo que todavía no existe, y lo que
 * todavía no existe es precisamente lo que va a llegar. Con esta forma, el
 * código que lo desconoce paga un click de más en vez de un botón gris.
 *
 * Por qué cada una es INOCUA (auth-google,
 * `services/provisioning/ensureInvestorAccount.ts`):
 *
 *  - `cuenta_anclada_solo_por_correo` (línea 542): la cuenta FUNCIONA hoy
 *    —tiene el rol y el correo que cartera reconoce— y lo que avisa es un
 *    riesgo futuro. Además el botón tampoco la arreglaría: el módulo reporta
 *    ese vínculo frágil y a propósito NO escribe el DPI. Marcarla insana
 *    dejaría un botón activo que al apretarlo no hace nada.
 *  - `correo_no_enviado`, `correo_redirigido_por_modo_no_prod`,
 *    `cuenta_creada_sin_contrasena_entregada`, `cuenta_creada_sin_marca_de_password`:
 *    hablan de una CONTRASEÑA que no llegó, no de una cuenta que no sirve.
 *    Ninguna puede llegar por el camino de solo lectura, que no manda correos;
 *    están acá para que un cambio en cartera que las dejara pasar no apagara
 *    el botón sobre una cuenta que sí funciona.
 *
 * Las que rompen la cuenta (`cuenta_sin_rol_de_inversionista`,
 * `correo_de_cartera_distinto_al_de_la_cuenta`, `rol_no_promovido`,
 * `cuenta_creada_sin_rol_ni_dpi`) NO se enumeran acá a propósito: con una lista
 * blanca no hace falta nombrarlas para que invaliden. Quien necesita sus
 * nombres es el front, que traduce cada una a una frase
 * (`MOTIVOS_CUENTA_PORTAL_ROTA`, `liquidaciones.$inversionistaId.tsx`); ahí sí
 * es una tabla de textos y su peor caso es callar, no apagar un botón.
 */
export const ADVERTENCIAS_INOCUAS: readonly string[] = [
	"cuenta_anclada_solo_por_correo",
	"correo_no_enviado",
	"correo_redirigido_por_modo_no_prod",
	"cuenta_creada_sin_contrasena_entregada",
	"cuenta_creada_sin_marca_de_password",
];

export const tieneCuentaSana = (
	acceso: AccesoPortalConsultado | null | undefined,
): boolean => {
	// `ya_tenia` es el ÚNICO estado que afirma que la cuenta ya existía. Los
	// demás no: `candidata` es "no tiene", `omitida` es "no le toca" (una
	// empresa entra con su representante legal, no con cuenta propia) y `fallo`
	// es "no sabemos" — y no saber nunca puede deshabilitar el botón.
	if (acceso?.estado !== "ya_tenia") return false;

	// Sin lista de advertencias no sabemos si las hay. Cartera siempre manda un
	// arreglo (`portalProvisioning.ts`: `Array.isArray(...) ? ... : []`), así
	// que su ausencia significa que la forma de la respuesta cambió — y eso es
	// duda, no permiso para apagar el botón.
	if (!Array.isArray(acceso.advertencias)) return false;

	return acceso.advertencias.every((a) => ADVERTENCIAS_INOCUAS.includes(a));
};

export interface AccesoPortalOtorgado {
	estado?: string | null;
	advertencias?: string[] | null;
	motivo?: string | null;
	correo?: { enviado?: boolean | null } | null;
}

/**
 * Los desenlaces de `otorgarAccesoPortal` que cartera decide SIN salir a la red
 * y sin tocar nada: por definición no crearon cuenta ni mandaron correo.
 *
 * Cada uno corta antes del `fetch` a auth-google:
 *  - `inversionista_no_encontrado`: `controllers/otorgarAccesoPortal.ts`, el id
 *    no está en `cartera.inversionistas`.
 *  - `es_empresa_el_acceso_es_del_representante`: `portalProvisioning.ts`, rama
 *    `soloAsegurarCuenta` — el acceso se abre desde la fila del representante.
 *  - `representante_no_encontrado_en_cartera`: `portalProvisioning.ts`, no hay
 *    a quién escribirle.
 *  - `provisionamiento_no_configurado`: `portalProvisioning.ts`, faltan
 *    `AUTH_GOOGLE_URL`/`PORTAL_PROVISIONING_SECRET`; se comprueba antes del
 *    `fetch` justamente para no gastar la espera.
 *
 * NO están `timeout` ni `http_<status>`: en esos SÍ se salió a la red y del
 * otro lado la cuenta pudo quedar creada y la contraseña pudo haber salido.
 * Tampoco está ningún motivo que venga del cuerpo de auth-google: este repo no
 * puede afirmar que no escribió nada.
 */
export const MOTIVOS_SIN_EFECTO: readonly string[] = [
	"inversionista_no_encontrado",
	"es_empresa_el_acceso_es_del_representante",
	"representante_no_encontrado_en_cartera",
	"provisionamiento_no_configurado",
];

/**
 * ¿Este apretón del botón tiene que dejar fila en `investor_activity_log`?
 *
 * POR QUÉ NO SE REGISTRA SIEMPRE
 * ------------------------------
 * Esa tabla existe para conservar UN dato: quién autorizó mandarle una
 * contraseña a alguien. Una fila por apretón la diluye hasta taparlo. El caso
 * que lo demuestra es la empresa: el camino de lectura contesta
 * `omitida/es_empresa` para siempre, así que el botón NUNCA se apaga, y cada
 * apretón vuelve con `fallo/es_empresa_el_acceso_es_del_representante` —nada
 * creado, ningún correo— y escribía una fila igual.
 *
 * POR QUÉ ES UNA LISTA BLANCA DE NO-OPS Y NO UNA DE ACTOS
 * ------------------------------------------------------
 * Enumerar "lo que cuenta como acto" haría que un desenlace nuevo —o uno que
 * auth-google renombre— dejara de registrarse, y ese silencio es irrecuperable:
 * la contraseña ya salió y no hay de dónde reconstruir quién la autorizó. Así
 * que solo se callan los desenlaces que ESTE repo decide, sin red de por medio.
 * Todo lo demás —incluida la duda— deja fila.
 *
 * Y dos cosas fuerzan la fila pase lo que pase, porque son las que no se pueden
 * perder: que haya salido un correo, y que venga cualquier advertencia (trabajo
 * pendiente para alguien; el toast se lo lleva la siguiente pantalla).
 */
export const exigeConstancia = (
	detalle: AccesoPortalOtorgado | null | undefined,
): boolean => {
	// Sin detalle no sabemos qué pasó del otro lado. La duda SIEMPRE registra.
	if (!detalle) return true;

	if (detalle.correo?.enviado === true) return true;

	if (Array.isArray(detalle.advertencias) && detalle.advertencias.length > 0) {
		return true;
	}

	// `omitida` es, en todo este módulo, "no le toca": cartera lo decide con la
	// fila en la mano y sin salir a la red (`decidirProvisionamiento`). Si aun
	// así hubiera habido efecto, habría salido por `correo.enviado` o por una
	// advertencia, que ya devolvieron `true` arriba.
	if (detalle.estado === "omitida") return false;

	if (detalle.estado === "fallo") {
		return !MOTIVOS_SIN_EFECTO.includes(detalle.motivo ?? "");
	}

	// `creada`, `ya_tenia`, `avisada` y cualquier estado que todavía no exista:
	// se registra. `ya_tenia` también, y no es ruido — el camino de escritura de
	// auth-google puede promover el rol o escribir el DPI sobre esa cuenta, y de
	// todos modos alguien autorizó tocarla.
	return true;
};
