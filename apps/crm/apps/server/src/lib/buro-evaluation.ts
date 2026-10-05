/**
 * Evaluación del veredicto del buró (Infornet).
 *
 * Replica la lógica que usa el bot de WhatsApp en
 * `index.ts` (`POST /info/validate-otp`): el buró se considera aprobado
 * cuando la persona NO tiene delitos penales NI morosidad. PEP y la falta
 * de patrimonio solo restan puntos al score, no rechazan.
 *
 * Única diferencia deliberada con el bot: sin análisis de riesgo el bot
 * aprueba (por el optional chaining de `index.ts:696`), aquí se devuelve
 * `sinVeredicto` para que el gate lo trate como fallo técnico bloqueante.
 */

export type AnalisisRiesgoBuro = {
	scoreRiesgo: number;
	nivelRiesgo: "BAJO" | "MEDIO" | "ALTO" | "CRITICO";
	alertas: string[];
	detalles: {
		tieneDelitosPenales: boolean;
		tieneMorosidad: boolean;
		esPEP: boolean;
		tienePatrimonio: boolean;
	};
};

export type EvaluacionBuro = {
	pasoBuro: boolean;
	sinVeredicto: boolean;
	motivosRechazo: string[];
	mensajeBuro: string;
};

export function evaluarBuro(
	analisisRiesgo: AnalisisRiesgoBuro | null,
): EvaluacionBuro {
	if (!analisisRiesgo) {
		return {
			pasoBuro: false,
			sinVeredicto: true,
			motivosRechazo: [],
			mensajeBuro: "No se pudo obtener el análisis de riesgo de Infornet",
		};
	}

	const motivosRechazo: string[] = [];

	if (analisisRiesgo.detalles.tieneDelitosPenales) {
		motivosRechazo.push("Tiene antecedentes penales");
	}
	if (analisisRiesgo.detalles.tieneMorosidad) {
		motivosRechazo.push("Tiene historial de morosidad");
	}

	const pasoBuro = motivosRechazo.length === 0;
	const mensajeBuro = pasoBuro
		? "Aprobado"
		: `Rechazado: ${motivosRechazo.join(", ")}`;

	return { pasoBuro, sinVeredicto: false, motivosRechazo, mensajeBuro };
}
