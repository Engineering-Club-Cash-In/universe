export type ClasificacionPosicionCompra =
  | "nueva_posicion"
  | "ampliacion_posicion"
  | "sin_clasificar";

/** El snapshot debe ser tomado antes del nuke/rebuild de la posición. */
export function clasificarCompraCreditoInversionista(
  inversionistasAntes: readonly number[] | undefined,
  inversionistaId: number,
): ClasificacionPosicionCompra {
  if (!inversionistasAntes) return "sin_clasificar";
  return inversionistasAntes.includes(inversionistaId)
    ? "ampliacion_posicion"
    : "nueva_posicion";
}

/** NULL significa que la fuente del momento de liquidar no conocía el modo. */
export function snapshotModoLiquidacion<T extends string>(modo: T | null | undefined): T | null {
  return modo ?? null;
}

export type FilaModoEspejo<T extends string = string> = {
  credito_id: number;
  tipo_reinversion: T | null;
};

export function tieneConflictoExcedenteVariable(
  modos: readonly (string | null | undefined)[],
): boolean {
  return modos.includes("reinversion_excedente") && modos.includes("reinversion_variable");
}

export function resolverModosTrasReemplazo<T extends string>({
  espejos,
  creditoIdsObjetivo,
  modoSolicitado,
  modoParaNulos,
}: {
  espejos: readonly FilaModoEspejo<T>[];
  creditoIdsObjetivo: readonly number[];
  modoSolicitado: T;
  modoParaNulos: T | null;
}): (T | null)[] {
  const objetivos = new Set(creditoIdsObjetivo);
  return [
    ...espejos.map((espejo) => {
      if (objetivos.has(espejo.credito_id)) return modoSolicitado;
      return espejo.tipo_reinversion ?? modoParaNulos;
    }),
    modoSolicitado,
  ];
}

export function resolverModosEfectivosLiquidacion<T extends string>(
  modoGlobal: T | null | undefined,
  creditoIds: readonly number[],
  espejos: readonly FilaModoEspejo<T>[],
): { porCredito: Map<number, T | null>; agregado: T | null } {
  const creditosDistintos = [...new Set(creditoIds)];
  const espejoPorCredito = new Map(espejos.map((fila) => [fila.credito_id, fila.tipo_reinversion]));
  const porCredito = new Map<number, T | null>();
  for (const creditoId of creditosDistintos) {
    porCredito.set(
      creditoId,
      modoGlobal && modoGlobal !== "reinversion_combinada"
        ? modoGlobal
        : snapshotModoLiquidacion(espejoPorCredito.get(creditoId)),
    );
  }
  const modos = [...porCredito.values()];
  const agregado = modos.length > 0 && modos.every((modo) => modo !== null) && new Set(modos).size === 1
    ? modos[0]
    : null;
  return { porCredito, agregado };
}
