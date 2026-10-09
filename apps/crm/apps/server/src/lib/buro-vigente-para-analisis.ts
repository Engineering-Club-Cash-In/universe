type ResultadoBuro = { estado: string } | null;

type SujetoConBuro = {
	buro: ResultadoBuro;
	buroVigente: boolean;
	buroDesactualizado: boolean;
};

type EstadoBuro = SujetoConBuro & {
	exento?: boolean;
	cofirmantes: Array<SujetoConBuro & { nombre: string }>;
};

/** Revisa la bitácora existente sin consultar fuentes externas. */
export function errorBuroVigenteParaAnalisis(
	estado: EstadoBuro,
	accion:
		| "entrar_analisis"
		| "aprobar_analisis"
		| "revalidar_en_analisis" = "aprobar_analisis",
): string | null {
	const instruccion =
		accion === "entrar_analisis"
			? "Consulta Infornet o resuelve el error con validación manual antes de pasar al 30%."
			: accion === "revalidar_en_analisis"
				? "Reconsulta Infornet o resuelve el error con validación manual en el 30% antes de aprobar."
				: "Regresa la oportunidad al 20% para consultar Infornet antes de aprobar el análisis.";
	const revisar = (sujeto: SujetoConBuro, nombre: string): string | null => {
		if (
			sujeto.buro &&
			!sujeto.buroDesactualizado &&
			sujeto.buro.estado !== "error" &&
			sujeto.buroVigente
		) {
			return null;
		}
		return `${nombre} necesita una validación de Buró vigente para su DPI actual. ${instruccion}`;
	};

	return (
		(estado.exento ? null : revisar(estado, "El titular")) ??
		estado.cofirmantes
			.map((cofirmante) =>
				revisar(cofirmante, `El cofirmante ${cofirmante.nombre}`),
			)
			.find((error) => error !== null) ??
		null
	);
}
