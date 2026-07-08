import type { BucketCatalogoCompleto } from "./buckets-classification";

export type ValidacionCatalogo = {
  ok: boolean;
  problemas: string[];
};

/**
 * Valida consistencia del CONJUNTO del catálogo (no de una fila aislada — eso
 * ya lo cubre el CHECK `buckets_rango_ck` en DB). Sin esto, un catálogo con
 * huecos/overlaps/orden roto pasa silencioso: bucketDeCredito() hace find()
 * first-match, así que un overlap gana por orden y un gap devuelve null
 * (crédito sin bucket, indistinguible de "fuera del funnel").
 *
 * La cobertura por rango de cuotas (orden/overlap/gap/apertura 0..∞) se
 * valida sobre TODAS las filas, no solo las operativas: `es_operativo=false`
 * (p.ej. B5 jurídico) solo controla si el crédito sale del funnel de gestión
 * al llegar ahí — el rango de cuotas sigue siendo parte de la cobertura.
 */
export function validarCatalogoBuckets(
  catalogo: BucketCatalogoCompleto[],
): ValidacionCatalogo {
  const problemas: string[] = [];

  if (catalogo.length === 0) {
    problemas.push("catálogo vacío");
    return { ok: false, problemas };
  }

  const numeros = catalogo.map((b) => b.numero);
  const numerosDuplicados = numeros.filter((n, i) => numeros.indexOf(n) !== i);
  if (numerosDuplicados.length > 0) {
    problemas.push(`numero duplicado en catálogo: ${[...new Set(numerosDuplicados)].join(", ")}`);
  }

  if (!catalogo.some((b) => b.es_operativo)) {
    problemas.push("catálogo sin ninguna fila operativa");
  }

  // Paso (2) de bucketDeCredito() resuelve por estados_incluidos con find()
  // first-match: si el mismo status aparece en dos buckets, gana el primero
  // por orden de array — mis-clasificación silenciosa, y reordenar el
  // catálogo (sin tocar estados_incluidos) cambiaría el resultado.
  const estadoABuckets = new Map<string, number[]>();
  for (const b of catalogo) {
    for (const estado of b.estados_incluidos) {
      const numeros = estadoABuckets.get(estado) ?? [];
      numeros.push(b.numero);
      estadoABuckets.set(estado, numeros);
    }
  }
  for (const [estado, numeros] of estadoABuckets) {
    if (numeros.length > 1) {
      problemas.push(
        `estado "${estado}" incluido en más de un bucket: numero=${numeros.join(", ")}`,
      );
    }
  }

  const porOrden = catalogo.slice().sort((a, b) => a.orden - b.orden);
  const ordenes = porOrden.map((b) => b.orden);
  const ordenesDuplicados = ordenes.filter((o, i) => ordenes.indexOf(o) !== i);
  if (ordenesDuplicados.length > 0) {
    problemas.push(`orden duplicado en catálogo: ${[...new Set(ordenesDuplicados)].join(", ")}`);
  }

  // Cobertura/overlap/gap se caminan por cuotas_min, NO por orden: son
  // columnas independientes (orden es de presentación, cuotas_min/max es el
  // rango real). Un admin puede reordenar la presentación sin tocar rangos —
  // caminar por `orden` ahí compararía filas no-adyacentes por cuota y
  // produciría overlap/gap falsos, tumbando un catálogo válido al fallback.
  const ordenados = catalogo.slice().sort((a, b) => a.cuotas_min - b.cuotas_min);

  if (ordenados[0].cuotas_min !== 0) {
    problemas.push(
      `cobertura incompleta: el primer bucket (numero=${ordenados[0].numero}) empieza en cuotas_min=${ordenados[0].cuotas_min}, no en 0`,
    );
  }

  for (let i = 1; i < ordenados.length; i++) {
    const prev = ordenados[i - 1];
    const cur = ordenados[i];

    if (prev.cuotas_max == null) {
      problemas.push(
        `bucket numero=${prev.numero} (orden=${prev.orden}) tiene cuotas_max abierto pero no es el último del catálogo`,
      );
      continue;
    }

    if (cur.cuotas_min <= prev.cuotas_max) {
      problemas.push(
        `overlap entre bucket numero=${prev.numero} (cuotas_max=${prev.cuotas_max}) y numero=${cur.numero} (cuotas_min=${cur.cuotas_min})`,
      );
    } else if (cur.cuotas_min > prev.cuotas_max + 1) {
      problemas.push(
        `gap entre bucket numero=${prev.numero} (cuotas_max=${prev.cuotas_max}) y numero=${cur.numero} (cuotas_min=${cur.cuotas_min})`,
      );
    }
  }

  const ultimo = ordenados[ordenados.length - 1];
  if (ultimo.cuotas_max != null) {
    problemas.push(
      `cobertura incompleta: el último bucket (numero=${ultimo.numero}) tiene cuotas_max=${ultimo.cuotas_max}, debería ser abierto (null) para cubrir ..∞`,
    );
  }

  return { ok: problemas.length === 0, problemas };
}
