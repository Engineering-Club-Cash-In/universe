/**
 * Una entrada de un pool antes de recalcular, con la marca de si LLEGÓ por un
 * traspaso.
 *
 * `origenBase` es el número base del crédito que había que borrar para que este
 * inversionista se mude al principal. `null` significa que el crédito ya era del
 * pool y no depende de ningún borrado.
 */
export type EntradaPool<T> = { credito: T; origenBase: string | null };

/** Lo que `eliminarCreditos` reporta por crédito. */
export type DetalleEliminacion = {
  numeroCredito: string;
  status: "success" | "error" | "not_found";
};

/** Estados en los que el crédito origen YA NO ESTÁ en la base. */
const BORRADO_O_INEXISTENTE = new Set(["success", "not_found"]);

/**
 * Saca de la lista a recalcular los traspasos cuyo crédito origen NO se borró.
 *
 * `/pools-raros` hace dos pasos y el segundo depende del primero: borra los
 * créditos que no coinciden con el número del pool y reasigna su inversionista y
 * su capital al crédito principal. Mientras el borrado era incondicional, dar
 * por hecho el segundo paso funcionaba.
 *
 * El guard de rubros rompió ese supuesto: ahora el borrado puede RECHAZARSE
 * —crédito con un cobro adicional con deuda viva— y el rechazo se anotaba en el
 * detalle y nada más. El recálculo seguía sumándole al principal las tenencias
 * de un crédito que quedó en pie, así que el mismo capital terminaba contado
 * DOS veces: inflando `creditos.capital` y `creditos_inversionistas.monto_aportado`
 * del principal contra un origen intacto, con el inversionista cobrando interés
 * y cuota por los dos lados. Reproducido, no supuesto.
 *
 * No alcanza con abortar: hacerlo castigaría a los traspasos sanos del mismo
 * pool. Y TIRAR es peor todavía — los borrados de `eliminarCreditos` son
 * autocommit por crédito, así que una excepción a mitad de camino deja los
 * anteriores ya borrados y el recálculo sin correr: el capital no se duplicaría,
 * DESAPARECERÍA. Se excluye el traspaso y el rechazo queda visible en el detalle.
 *
 * ⚠️ **`not_found` NO excluye**, y la asimetría es el punto: si el crédito origen
 * no existe en la base, no hay nada que pueda quedar duplicado, y excluir ese
 * traspaso le haría perder el capital al inversionista.
 *
 * Un origen que no aparece en el detalle tampoco pasa: sin evidencia de que el
 * borrado ocurrió, ante la duda no se duplica.
 *
 * Los pools que quedan sin ninguna entrada se sacan de la lista — recalcular un
 * pool sin inversionistas le pondría capital 0 al crédito principal, que es peor
 * que no recalcularlo.
 */
/**
 * Por cada crédito origen, si YA NO ESTÁ en la base — o sea si su borrado
 * ocurrió (`success`) o nunca hizo falta (`not_found`).
 *
 * Un origen que no aparece en el detalle cuenta como "sigue ahí": sin evidencia
 * de que el borrado pasó, ante la duda no se duplica.
 */
const mapaDeBorrados = (detalles: DetalleEliminacion[] | null) => {
  const yaNoEsta = new Map<string, boolean>();
  for (const d of detalles ?? []) {
    yaNoEsta.set(d.numeroCredito, BORRADO_O_INEXISTENTE.has(d.status));
  }
  return yaNoEsta;
};

export function excluirTraspasosSinBorrar<T>(
  pools: { numeroCredito: string; entradas: EntradaPool<T>[] }[],
  detalles: DetalleEliminacion[] | null
): { numeroCredito: string; creditos: T[] }[] {
  const yaNoEsta = mapaDeBorrados(detalles);

  return pools
    .map((pool) => ({
      numeroCredito: pool.numeroCredito,
      creditos: pool.entradas
        .filter((e) => e.origenBase === null || yaNoEsta.get(e.origenBase) === true)
        .map((e) => e.credito),
    }))
    .filter((pool) => pool.creditos.length > 0);
}

/**
 * Qué pools NO pueden tocar el plan de pagos, porque alguno de sus traspasos no
 * se borró.
 *
 * `/pools-raros` tiene DOS pasos que consumen la lista de pools, y
 * `excluirTraspasosSinBorrar` sólo cubre el primero —el recálculo de capital—.
 * El segundo recorre los pools y llama `marcarCuotasPagadasHastaNumero` y
 * `updateInstallments` sobre el crédito PRINCIPAL, con el `numeroCuota` y la
 * `cuota` del pool. Esos datos asumen que los traspasos entraron: si uno se
 * rechazó, ese paso marca cuotas del principal como pagadas y le sobrescribe el
 * monto con una foto que no ocurrió, mientras el capital sigue en el crédito
 * origen que quedó vivo.
 *
 * **Se saltea el pool ENTERO, no sólo los que quedaron vacíos**, y la diferencia
 * con el otro filtro es el punto: la cuota del pool no es por traspaso, así que
 * no hay forma de descontarle "la parte" del rechazado. Conservador a propósito
 * — no sobrescribir el plan de pagos del principal con datos que suponían
 * capital que no se movió. El operador anula el rubro y vuelve a correr.
 *
 * Un pool sin traspasos nunca se saltea: no depende de ningún borrado.
 */
export function poolsConTraspasoRechazado<T>(
  pools: { numeroCredito: string; entradas: EntradaPool<T>[] }[],
  detalles: DetalleEliminacion[] | null
): Set<string> {
  const yaNoEsta = mapaDeBorrados(detalles);
  const rechazados = new Set<string>();

  for (const pool of pools) {
    const hayRechazado = pool.entradas.some(
      (e) => e.origenBase !== null && yaNoEsta.get(e.origenBase) !== true
    );
    if (hayRechazado) rechazados.add(pool.numeroCredito);
  }

  return rechazados;
}
