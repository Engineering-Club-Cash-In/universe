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
 * Pero NO son idénticos ni deben serlo: el consejo de cómo arreglarlo diverge a
 * propósito. Aquí depende de DESDE DÓNDE se está leyendo el aviso —el alta de un
 * inversionista o el botón "Dar acceso al portal"— y el gemelo de carteraFront no
 * tiene esa segunda pantalla. Resincronizar los dos archivos a ciegas reintroduce
 * el bug.
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
 * Desde dónde se está leyendo el aviso. NO es cosmético: cambia qué se puede
 * aconsejar.
 *
 * - `alta`: se acaba de crear el inversionista y el acceso al portal fue un
 *   paso más de ese alta. Ahí "no lo vuelvas a crear" y "abrile el acceso
 *   desde la pantalla del inversionista" son las dos instrucciones correctas:
 *   el inversionista existe y el botón está en OTRA pantalla, a la que hay que
 *   mandar a quien lee.
 * - `boton`: quien lee YA está en esa pantalla y acaba de apretar ese botón.
 *   Nada se creó, así que "no lo vuelvas a crear" habla de algo que no pasó, y
 *   mandarlo a apretar el botón que acaba de fallar es un círculo.
 */
export type OrigenAviso = "alta" | "boton";

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
 * ANTES decía "pedile a cartera": el botón vivía solo en carteraFront. Ya no.
 * El CRM tiene el suyo, en la pantalla del inversionista, así que mandar a
 * pedírselo a otro dejaría a conta esperando por algo que puede hacer ella
 * misma.
 *
 * Y desde ESE botón el texto cambia: quien lee ya está parada ahí, así que
 * mandarla a "la pantalla del inversionista" sería mandarla donde ya está.
 */
const COMO_SE_ARREGLA: Record<OrigenAviso, string> = {
	alta: 'abrile el acceso desde la pantalla del inversionista, opción "Dar acceso al portal"',
	boton: "volvé a intentarlo con este mismo botón",
};

/**
 * Por qué no se pudo, en palabras. Lo que no está en la lista se calla en vez de
 * enseñar el código crudo: el detalle técnico ya viaja en `audit_logs`.
 */
const CAUSA_EN_PALABRAS: Record<string, string> = {
	timeout: "el portal no respondió a tiempo",
	provisionamiento_no_configurado: "al servidor le falta configuración",
	representante_no_encontrado_en_cartera:
		"no se encontró a su representante legal",
	correo_de_cartera_distinto_al_de_la_cuenta:
		"ya tiene cuenta con otro correo y hasta cuadrarlos no vería sus inversiones",
	sin_rol_de_inversionista:
		"su cuenta quedó sin el permiso de inversionista",
	representante_sin_cuenta:
		"su representante legal todavía no tiene cuenta en el portal",
	// `ensureInvestorAccount` devuelve este motivo cuando a la cuenta se llegó
	// solo por el correo y ningún DPI la respalda: ahí se niega a escribirle el
	// rol y corta. Sin esta línea el aviso salía SIN causa —"No se le pudo dar
	// acceso al portal."— y encima aconsejaba reintentar, que es justo lo que
	// vuelve a caer en la misma negativa.
	cuenta_anclada_solo_por_correo:
		"ya tiene cuenta, pero solo se la reconoce por el correo y ningún DPI la respalda",
	// `otorgarAccesoPortal.ts`: el id no está en `cartera.inversionistas`. Salía
	// sin causa y aconsejando reintentar sobre una fila que no existe.
	inversionista_no_encontrado:
		"cartera no encuentra a este inversionista",
	// `ensureInvestorAccount.ts`: la cuenta se creó y no se le pudo marcar la
	// contraseña. Cuando NO se pudo deshacer viene además la advertencia
	// `cuenta_creada_sin_marca_de_password`, que es la que corta el consejo de
	// reintentar; cuando SÍ se deshizo, reintentar es lo correcto y lo único
	// que faltaba era decir qué pasó.
	no_se_pudo_marcar_password_provisionada:
		"la cuenta quedó a medias al crearla",
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
		// Es distinta de la de arriba: aquí la cuenta ni siquiera llegó a quedar usable,
		// y el alta intentó deshacerla y no pudo. Se dice porque cambia la instrucción:
		// el mensaje de "no se pudo dar acceso" manda a apretar otra vez el botón, y
		// sobre esta cuenta a medias ese reintento no crea nada — encuentra la cuenta ya
		// existente y a esas nunca se les manda contraseña.
		case "cuenta_creada_sin_marca_de_password":
			return "La cuenta del portal quedó a medias: se creó pero no se le pudo mandar la contraseña, y tampoco se pudo deshacer. Volver a intentarlo NO la arregla. Avisa a sistemas.";
		case "cuenta_creada_sin_rol_ni_dpi":
			return "La cuenta quedó creada pero sin quedar ligada a este inversionista: si no se corrige, mañana se le puede crear una segunda cuenta. Avisa a sistemas.";
		// Por el camino de ALTA esta advertencia no llega: la emite el camino de
		// solo lectura (`ensureInvestorAccount`, rama de consulta), que no
		// escribe. Se traduce igual porque sin este caso la advertencia se
		// perdería y un `ya_tenia` con la cuenta sin rol saldría en VERDE
		// ("Ya tenía acceso al portal") sobre alguien que entra y no ve nada.
		case "cuenta_sin_rol_de_inversionista":
			return "Ya tenía cuenta, pero sin el permiso de inversionista: al entrar no va a ver su información. Avisa a sistemas.";
		case "rol_no_promovido":
			return "Ya tenía cuenta, pero no se le pudo dar el permiso de inversionista: al entrar no va a ver su información. Avisa a sistemas.";
		case "correo_de_cartera_distinto_al_de_la_cuenta":
			// NO se le dice "entra con ese". El portal resuelve qué inversionistas
			// ve una sesión buscando su correo en cartera, así que mientras los dos
			// correos no sean el mismo, esa cuenta entra y no ve NADA. Mandarla a
			// entrar es mandarla a una pantalla vacía.
			return `Ya tenía cuenta en el portal con otro correo: ${acceso.usuarioEmail ?? "uno distinto"}. Hasta que los dos correos sean el mismo no va a ver sus inversiones al entrar. Avisa a sistemas para cuadrarlos.`;
		case "cuenta_anclada_solo_por_correo":
			return "Ya tenía cuenta y se le reconoció solo por el correo. Si alguien le cambia el correo, se le va a crear una segunda cuenta. Avisa a sistemas.";
		// La marca cartera al crear, mirando el nombre (`pareceSociedad`).
		// Se avisa AQUÍ y no solo en el resumen diario porque el resumen no la ve: el
		// job no crea cuentas, así que por su lado esta fila vuelve como "ya tenía" y
		// se pierde entre las sanas. Aquí quien captura la tiene todavía delante.
		case "parece_sociedad_con_cuenta_propia":
			return "El nombre parece de una sociedad y se le creó cuenta PROPIA del portal, con su contraseña por correo. Si es una empresa, al portal entra su representante legal: capturáselo en Editar → ¿Es empresa? y avisa a sistemas de la cuenta que se creó de más.";
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

/**
 * Motivos que el consejo de siempre —"volvé a intentarlo"/"abrile el acceso
 * desde la pantalla del inversionista"— NO arregla: apretar otra vez vuelve a
 * caer exactamente en el mismo corte, y el aviso quedaba mandando a alguien a
 * dar vueltas en círculo. Peor todavía con
 * `correo_de_cartera_distinto_al_de_la_cuenta`, donde la causa y el consejo se
 * contradecían en la misma línea ("hasta cuadrarlos no vería sus inversiones.
 * Si querés, volvé a intentarlo…").
 *
 * Cada texto nombra el arreglo REAL. Sirve igual desde el alta y desde el
 * botón —por eso no dice "este botón"—, porque desde los dos lados el consejo
 * genérico termina apuntando a la misma acción que no sirve.
 */
const EN_VEZ_DE_REINTENTAR: Record<string, string> = {
	// `portalProvisioning.ts`: la fila SÍ trae `dpi_rep_legal`, pero ese DPI no
	// corresponde a ninguna fila de cartera, así que no hay a quién escribirle.
	// El dato a corregir está en Editar, no en este botón.
	representante_no_encontrado_en_cartera:
		"Abrir el acceso otra vez no lo arregla: el DPI que tiene capturado como representante legal no corresponde a ninguna fila de cartera. Corregilo en Editar → ¿Es empresa?, o dale de alta primero a esa persona.",
	// Cuadrar dos correos es trabajo de sistemas; ningún reintento los junta.
	correo_de_cartera_distinto_al_de_la_cuenta:
		"Abrir el acceso otra vez no lo arregla: avisa a sistemas para cuadrarle los dos correos.",
	// Le falta configuración al servidor: el reintento le pega al mismo muro.
	provisionamiento_no_configurado:
		"Abrir el acceso otra vez no lo arregla: avisa a sistemas.",
	// El provisionamiento se niega a escribir sobre una cuenta que solo el
	// correo respalda. Mientras su DPI no la respalde, el resultado es idéntico.
	cuenta_anclada_solo_por_correo:
		"Abrir el acceso otra vez no lo arregla: hasta que su DPI respalde esa cuenta, el sistema no le va a tocar el permiso. Avisa a sistemas.",
	// La fila no está. Ningún reintento la va a encontrar.
	inversionista_no_encontrado:
		"Abrir el acceso otra vez no lo arregla: revisá que estés en la ficha correcta y, si la fila debería existir, avisa a sistemas.",
};

/**
 * El desenlace cuando el acceso NO se dio.
 *
 * Vive aparte de las advertencias porque no compite con ellas: una cuenta
 * puede volver como `fallo` Y con advertencias, y antes las advertencias se
 * devolvían solas y se comían la única frase que dice que esa persona no
 * puede entrar al portal.
 */
const mensajeDeFallo = (
	acceso: AccesoPortal,
	origen: OrigenAviso,
): AvisoAccesoPortal | null => {
	// El botón apretado sobre una fila de EMPRESA.
	//
	// Sale del `causa()` genérico porque ese texto termina en "abrile el
	// acceso desde la pantalla del inversionista" — o sea, mandaría a apretar
	// OTRA VEZ el mismo botón sobre la misma fila, en círculo.
	//
	// Y el acceso no se abre desde la empresa a propósito: la contraseña cae en
	// el buzón del REPRESENTANTE, y el diálogo de confirmación —el único
	// control que tiene este botón, un humano mirando a dónde va a caer una
	// contraseña— enseña el correo de la EMPRESA. Abrirlo desde aquí mandaría
	// la contraseña a una dirección que nadie revisó.
	if (acceso.motivo === "es_empresa_el_acceso_es_del_representante") {
		return {
			tono: "advertencia",
			texto:
				"No se le abrió acceso: es una empresa, y al portal entra con su representante legal. Abrile el acceso desde la fila del representante (su DPI está en Editar → Representante legal); ahí vas a poder revisar su correo antes de mandarle la contraseña.",
		};
	}

	// El timeout no es un "no se pudo": es un "no sabemos". Abortamos la
	// espera, pero del otro lado la cuenta pudo quedar creada. Sale del
	// `causa()` genérico porque ese texto termina mandando a apretar otra vez
	// "Dar acceso al portal", y eso es justo lo que NO sirve: si la cuenta
	// existe, el reintento contesta "ya tenía" y no manda ninguna contraseña.
	if (acceso.motivo === "timeout") {
		return {
			tono: "advertencia",
			texto:
				"No sabemos si quedó con acceso: el portal no respondió a tiempo y la cuenta pudo haberse creado igual. NO le des acceso de nuevo —si la cuenta existe, el sistema dirá que \"ya tenía\" y no le manda ninguna contraseña—. Avisa a sistemas para que confirmen si le llegó y, si no, le reseteen la contraseña.",
		};
	}

	// Con la cuenta a medias el reintento no arregla nada, y la advertencia
	// que viene pegada abajo ya lo dice y ya manda a sistemas. Aconsejar
	// reintentar acá sería contradecirla en la misma línea.
	const reintentarNoSirve = acceso.advertencias.includes(
		"cuenta_creada_sin_marca_de_password",
	);
	// Los motivos que tampoco se arreglan reintentando, pero que SÍ tienen un
	// arreglo que nombrar. Van por motivo, no por advertencia: son el desenlace.
	const enVezDeReintentar = acceso.motivo
		? EN_VEZ_DE_REINTENTAR[acceso.motivo]
		: undefined;

	// Desde el botón no se creó ningún inversionista: la fila ya existía y
	// sigue igual. Decirle "no lo vuelvas a crear" sería hablarle de un alta
	// que nunca ocurrió.
	if (origen === "boton") {
		const encabezado = `No se le pudo dar acceso al portal${causa(acceso.motivo)}.`;
		if (reintentarNoSirve) return { tono: "advertencia", texto: encabezado };
		return {
			tono: "advertencia",
			texto: enVezDeReintentar
				? `${encabezado} ${enVezDeReintentar}`
				: `${encabezado} Si querés, ${COMO_SE_ARREGLA.boton}; si vuelve a fallar, avisa a sistemas.`,
		};
	}

	// El alta SÍ salió: decirlo es lo que evita que lo vuelvan a crear y se
	// estrellen contra el guard de duplicados.
	//
	// El consejo de cerrar también se calla cuando no sirve: desde el alta
	// manda a apretar el botón, y sobre estos motivos ese botón vuelve a
	// contestar lo mismo.
	const encabezadoAlta = `No se le pudo dar acceso al portal${causa(acceso.motivo)}, pero el inversionista sí quedó creado: no lo vuelvas a crear.`;
	if (reintentarNoSirve) return { tono: "advertencia", texto: encabezadoAlta };
	return {
		tono: "advertencia",
		texto: enVezDeReintentar
			? `${encabezadoAlta} ${enVezDeReintentar}`
			: `${encabezadoAlta} Cuando quieras, ${COMO_SE_ARREGLA.alta}.`,
	};
};

export const avisoAccesoPortal = (
	acceso: AccesoPortal | null | undefined,
	// Por omisión, el alta: es el camino que ya existía y el único que la
	// pantalla de liquidaciones usa. Quien lo llame desde el botón lo dice.
	origen: OrigenAviso = "alta",
): AvisoAccesoPortal | null => {
	if (!acceso) return null;

	const avisos = acceso.advertencias
		.map((a) => texto(a, acceso))
		.filter((t): t is string => t !== null);

	// Las advertencias NO pueden tapar un `fallo`. Se devolvían solas y con eso
	// se perdía lo más importante: que no se le dio acceso. Pasa de verdad —una
	// cuenta CLIENT encontrada solo por correo vuelve como `fallo` CON la
	// advertencia de vínculo frágil— y el operador se quedaba leyendo el detalle
	// sin enterarse de que esa persona no puede entrar. Primero el desenlace,
	// después el detalle.
	const fallo =
		acceso.estado === "fallo" ? mensajeDeFallo(acceso, origen) : null;

	if (fallo) {
		return avisos.length > 0
			? { tono: fallo.tono, texto: [fallo.texto, ...avisos].join(" ") }
			: fallo;
	}

	if (avisos.length > 0) {
		return { tono: "advertencia", texto: avisos.join(" ") };
	}

	if (acceso.estado === "omitida") {
		if (acceso.motivo === "sin_correo") {
			return {
				tono: "advertencia",
				texto: `Quedó sin acceso al portal porque no tiene correo capturado. Agrégaselo y después ${COMO_SE_ARREGLA[origen]}.`,
			};
		}
		if (acceso.motivo === "sin_nombre") {
			return {
				tono: "advertencia",
				texto: `Quedó sin acceso al portal porque no tiene nombre capturado. Agrégaselo y después ${COMO_SE_ARREGLA[origen]}.`,
			};
		}
		// El servicio del CRM no es ADMIN, así que cartera ni lo intentó. Es un
		// fallo de configuración documentado (`apps/cartera-back/DEPLOYMENT.md`) y sin
		// esto caía al `null` de abajo: el modal decía "Inversionista creado
		// correctamente" y se cerraba, con la persona sin acceso y nadie enterado.
		if (acceso.motivo === "origen_no_autorizado") {
			return {
				tono: "advertencia",
				// Falta un permiso del servidor, no un dato de la fila: volver a
				// apretar el botón le pega al mismo muro. Por eso desde el botón
				// NO se aconseja reintentar — solo avisar.
				texto:
					origen === "boton"
						? "Quedó sin acceso al portal: este servicio no tiene permiso para abrirlo. Volver a intentarlo no lo arregla; avisa a sistemas."
						: `Quedó sin acceso al portal: este servicio no tiene permiso para abrirlo. Avisa a sistemas, y mientras tanto ${COMO_SE_ARREGLA.alta}.`,
			};
		}
		if (acceso.motivo === "no_solicitado") {
			return {
				tono: "advertencia",
				// Desde el botón esto no debería pasar: el botón SIEMPRE pide el
				// acceso. Si aparece, el pedido se perdió en el camino — y hablar de
				// "este alta" sería hablarle de un alta que quien lee no hizo.
				texto:
					origen === "boton"
						? "El portal no registró el pedido de acceso. Volvé a intentarlo con este mismo botón y, si se repite, avisa a sistemas."
						: `Este alta no pidió abrirle acceso al portal. Si le toca tenerlo, ${COMO_SE_ARREGLA.alta}.`,
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
