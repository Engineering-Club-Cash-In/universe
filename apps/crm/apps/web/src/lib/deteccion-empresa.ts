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

/**
 * Cuántos dígitos hacen falta para que valga la pena preguntar.
 *
 * NO son 13. El DPI moderno los tiene, pero en producción hay cédulas viejas de
 * 7 y 8 dígitos —el inversionista 187 tiene `4036613`— y son personas que
 * existen y que también pueden tener empresas. Con el umbral en 13 nunca se les
 * consultaba, y como ya no existe el interruptor "¿Es empresa?", su DPI se
 * quedaba en el campo personal y el alta de su sociedad rebotaba como duplicada
 * sin ninguna salida.
 *
 * Bajar el umbral no convierte un DPI a medio escribir en el de otra persona:
 * cartera busca por igualdad exacta, no por prefijo (`eq(inversionistas.dpi,…)`
 * en `identidadInversionista.ts`). Para que saltara de más, los primeros 7 u 8
 * dígitos de lo que se está tecleando tendrían que ser EXACTAMENTE la cédula
 * completa de alguien, y aun así el panel se descarta con un clic.
 */
const MINIMO_DIGITOS_CONSULTABLES = 7;

export const dpiConsultable = (valor: string): string | null => {
	const digitos = valor.replace(/\D/g, "");
	return digitos.length >= MINIMO_DIGITOS_CONSULTABLES ? digitos : null;
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
 *
 * "No hay DPI escrito" es el campo VACÍO, no "el DPI todavía no es
 * consultable". Son cosas distintas y confundirlas creaba empresas bajo la
 * persona equivocada: con el correo de alguien ya escrito, cada dígito del DPI
 * de OTRA persona entre el primero y el sexto dejaba el disparador en el
 * correo. Si la consulta resolvía en esa ventana, se detectaba al dueño del
 * correo, se le ponía de representante y `camposAlDetectar` limpiaba el DPI a
 * medio teclear — el operador ni veía qué pasó con lo que estaba escribiendo.
 *
 * Mientras haya un dígito en el campo de DPI, entonces, no se consulta nada: el
 * dato que manda está a medias y el correo no lo suple. En cuanto llega al
 * séptimo dígito dispara el DPI, y si se borra el campo vuelve a disparar el
 * correo — sin nada que deshacer en el camino.
 */
export const disparadorDeteccion = (
	dpi: string,
	email: string,
): { dpi: string } | { email: string } | null => {
	const porDpi = dpiConsultable(dpi);
	if (porDpi) return { dpi: porDpi };

	// Se miran dígitos, lo mismo que mira `dpiConsultable`: la identidad de
	// alguien vive ahí. Un guion o un espacio sueltos no son de nadie y no deben
	// apagar la detección por correo sin que se vea por qué.
	if (/\d/.test(dpi)) return null;

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
