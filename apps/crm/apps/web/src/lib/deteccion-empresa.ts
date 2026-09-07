/**
 * Detección de empresa en el alta de inversionista.
 *
 * Una sociedad no se declara: se deduce. Si conta escribe un DPI o un correo
 * que YA es de alguien, no está duplicando por error — está dando de alta la
 * empresa de un inversionista que ya existe. Ese es el único caso real en que
 * esos datos se repiten, y es el que antes rebotaba con "ya existe" y obligaba
 * a inventar un correo (así se llenó producción de correos falsos: cuatro para
 * Richard Kachler, tres para Escondrillas).
 *
 * Por eso desapareció el interruptor "¿Es empresa?": marcarlo a mano era pedirle
 * a conta que declarara algo que el dato ya dice.
 */

export interface IdentidadDetectada {
	inversionista_id: number;
	nombre: string;
	email: string | null;
	/** DPI de la persona, normalizado. Es el que se guarda como representante. */
	dpi: string;
	via: "directo" | "representante_de_la_sociedad";
	/** Razón social por la que se llegó a la persona, si se llegó por una. */
	sociedad: string | null;
}

/** Un DPI de Guatemala tiene 13 dígitos: antes no vale la pena preguntar. */
export const dpiConsultable = (valor: string): string | null => {
	const digitos = valor.replace(/\D/g, "");
	return digitos.length >= 13 ? digitos : null;
};

/** Correo con forma suficiente para consultarlo. */
export const emailConsultable = (valor: string): string | null => {
	const limpio = valor.trim().toLowerCase();
	return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(limpio) ? limpio : null;
};

/**
 * Qué campo dispara la búsqueda.
 *
 * El DPI manda: es el dato con el que conta identifica a una persona. El correo
 * solo consulta cuando no hay DPI escrito, para no tener dos disparadores
 * peleando por el mismo formulario cuando dicen cosas distintas.
 */
export const disparadorDeteccion = (
	dpi: string,
	email: string,
): { dpi: string } | { email: string } | null => {
	const porDpi = dpiConsultable(dpi);
	if (porDpi) return { dpi: porDpi };

	const porEmail = emailConsultable(email);
	if (porEmail) return { email: porEmail };

	return null;
};

/** Clave estable del disparador, para recordar cuáles ya se descartaron. */
export const claveDisparador = (
	disparador: { dpi: string } | { email: string },
): string => ("dpi" in disparador ? `dpi:${disparador.dpi}` : `email:${disparador.email}`);

export interface CamposEmpresa {
	/** La sociedad no tiene DPI propio: el que se escribió era el del humano. */
	dpi: string;
	dpiRepLegal: string;
	email: string;
}

/**
 * Cómo quedan los campos cuando se detecta a la persona.
 *
 * Solo se tocan DPI, representante y correo. Nombre, banco, cuenta y moneda se
 * dejan como están A PROPÓSITO: son los datos que de verdad distinguen a la
 * empresa de su representante, y son la razón de que sean dos fichas y no una.
 * Autorrellenarlos invitaría a guardar la cuenta bancaria del humano a nombre
 * de la sociedad.
 */
export const camposAlDetectar = (
	identidad: IdentidadDetectada,
	emailActual: string,
): CamposEmpresa => ({
	dpi: "",
	dpiRepLegal: identidad.dpi,
	// El correo de la persona solo se pone si conta no escribió otro: puede
	// estar dándole a la sociedad un correo propio, y eso es válido.
	email: emailActual.trim() ? emailActual : (identidad.email ?? ""),
});

/** Cómo quedan al deshacer la detección: el DPI vuelve a donde se escribió. */
export const camposAlDescartar = (
	identidad: IdentidadDetectada,
	emailActual: string,
): CamposEmpresa => ({
	dpi: identidad.dpi,
	dpiRepLegal: "",
	// Si el correo puesto fue el de la persona, se retira: era parte de la
	// suposición que se está deshaciendo.
	email:
		emailActual.trim().toLowerCase() === (identidad.email ?? "").toLowerCase()
			? ""
			: emailActual,
});
