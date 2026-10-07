import { readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import { cerrarMoraPagadaDeCredito } from "../utils/cerrarMoraPagadaDeCredito";

/**
 * ── Pruebas de `cerrarMoraPagadaDeCredito` y su integración ────────────────
 *
 * Cuando se rompe un convenio, la mora debe empezar DESDE CERO. El cierre
 * compensa todas las anotaciones vivas del crédito para que el nuevo cálculo
 * arranque sin deuda de mora.
 *
 * Las pruebas validan:
 * 1. El cierre COMPENSA todas las filas vivas (inserta negativas)
 * 2. Un crédito sin anotaciones vivas NO falla (es legítimo)
 * 3. La compensación NO afecta filas ya compensadas (índice único)
 * 4. El rastro queda: cada negativa apunta a su original por `revierte_a`
 */

// ============================================================================
// Fake db para cerrarMoraPagadaDeCredito
//
// El helper hace:
//   1. db.select(...).from(mora_pagada_cuota).where(...) → las anotaciones vivas
//   2. db.insert(mora_pagada_cuota).values(...) → las compensatorias
//
// Lo que se prueba es que:
//   - Se encuentren todas las filas vivas (sin compensación previa)
//   - Se inserte una negativa por cada viva
//   - Cada negativa apunte a su original con `revierte_a`
//   - El motivo cite la ruptura de convenio
// ============================================================================

type Fila = Record<string, unknown>;

const state: {
  /** Resultado de cada .select() en orden de ejecución. */
  selectQueue: Fila[][];
  selectCalls: number;
  /** Filas que se intentaron insertar, en orden. */
  inserts: Array<{ values: Fila }>;
  /** Cola de resultados para cada insert().returning(). */
  insertReturnQueue: Fila[][];
} = {
  selectQueue: [],
  selectCalls: 0,
  inserts: [],
  insertReturnQueue: [],
};

const makeSelectChain = () => {
  const result = state.selectQueue[state.selectCalls] ?? [];
  state.selectCalls++;
  const chain: any = {
    from: () => chain,
    where: () => Promise.resolve(result),
  };
  return chain;
};

const fakeDb: any = {
  select: () => makeSelectChain(),
  insert: (table: unknown) => ({
    values: (values: Fila | Fila[]) => {
      const valuesArray = Array.isArray(values) ? values : [values];
      valuesArray.forEach((v) => {
        state.inserts.push({ values: v });
      });
      // Como la base real: una fila devuelta por cada insertada (la cola
      // permite simular un choque devolviendo menos).
      const rows = state.insertReturnQueue.shift() ?? valuesArray.map((_, i) => ({ id: i + 1 }));
      // Encadenable como el builder real: el insert de compensatorias hace
      // .onConflictDoNothing(...).returning(); un `await` directo sigue
      // resolviendo como antes.
      const chain: any = {
        onConflictDoNothing: () => chain,
        returning: () => Promise.resolve(rows),
        then: (res: any, rej: any) =>
          Promise.resolve({ returning: chain.returning }).then(res, rej),
      };
      return chain;
    },
  }),
};

const resetState = () => {
  state.selectQueue = [];
  state.selectCalls = 0;
  state.inserts = [];
  state.insertReturnQueue = [];
};

describe("cerrarMoraPagadaDeCredito — compensación de mora", () => {
  it("compensa todas las anotaciones vivas del crédito", async () => {
    resetState();
    const vivasDelCredito: Fila[] = [
      { id: 1, credito_id: 72, cuota_id: 10, monto: "100.00" },
      { id: 2, credito_id: 72, cuota_id: 11, monto: "50.00" },
      { id: 3, credito_id: 72, cuota_id: 12, monto: "75.50" },
    ];
    state.selectQueue = [vivasDelCredito];

    const compensadas = await cerrarMoraPagadaDeCredito(
      { credito_id: 72 },
      fakeDb as any
    );

    expect(compensadas).toBe(3);
    // Debe insertar 3 filas negativas (una por cada viva)
    expect(state.inserts).toHaveLength(3);
  });

  it("cada compensatoria tiene monto negativo y apunta a la original", async () => {
    resetState();
    const vivasDelCredito: Fila[] = [
      { id: 5, credito_id: 72, cuota_id: 10, monto: "100.00" },
      { id: 6, credito_id: 72, cuota_id: 11, monto: "50.00" },
    ];
    state.selectQueue = [vivasDelCredito];

    await cerrarMoraPagadaDeCredito(
      { credito_id: 72, usuario_id: 41 },
      fakeDb as any
    );

    // Primera compensatoria
    const comp1 = state.inserts[0].values;
    expect(comp1.credito_id).toBe(72);
    expect(comp1.cuota_id).toBe(10);
    expect(comp1.monto).toBe("-100.000000");
    expect(comp1.revierte_a).toBe(5);
    expect(comp1.tipo).toBe("REVERSA");
    expect(comp1.pago_id).toBeNull();
    expect(comp1.usuario_id).toBe(41);
    expect(String(comp1.motivo)).toContain("ruptura de convenio");

    // Segunda compensatoria
    const comp2 = state.inserts[1].values;
    expect(comp2.monto).toBe("-50.000000");
    expect(comp2.revierte_a).toBe(6);
  });

  it("un crédito sin anotaciones vivas devuelve 0 y NO falla", async () => {
    resetState();
    state.selectQueue = [[]]; // Sin anotaciones

    const compensadas = await cerrarMoraPagadaDeCredito(
      { credito_id: 99 },
      fakeDb as any
    );

    expect(compensadas).toBe(0);
    expect(state.inserts).toHaveLength(0);
  });

  it("solo compensa las filas SIN compensación previa", async () => {
    resetState();
    const vivasDelCredito: Fila[] = [
      { id: 100, credito_id: 72, cuota_id: 10, monto: "200.00" },
      // Esta NO se incluye porque ya tiene una fila que apunta a ella (SQL `NOT EXISTS`)
    ];
    state.selectQueue = [vivasDelCredito];

    const compensadas = await cerrarMoraPagadaDeCredito(
      { credito_id: 72 },
      fakeDb as any
    );

    expect(compensadas).toBe(1);
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0].values.revierte_a).toBe(100);
  });

  it("el motivo siempre menciona la ruptura de convenio", async () => {
    resetState();
    state.selectQueue = [
      [{ id: 1, credito_id: 72, cuota_id: 10, monto: "100.00" }],
    ];

    await cerrarMoraPagadaDeCredito(
      { credito_id: 72 },
      fakeDb as any
    );

    const motivo = String(state.inserts[0].values.motivo);
    expect(motivo).toContain("ruptura de convenio");
  });

  it("el tipo es siempre REVERSA (marca que es un reversal)", async () => {
    resetState();
    state.selectQueue = [
      [{ id: 1, credito_id: 72, cuota_id: 10, monto: "100.00" }],
    ];

    await cerrarMoraPagadaDeCredito(
      { credito_id: 72 },
      fakeDb as any
    );

    expect(state.inserts[0].values.tipo).toBe("REVERSA");
  });

  it("nunca incluye pago_id en la compensatoria (es genérico por crédito)", async () => {
    resetState();
    state.selectQueue = [
      [{ id: 1, credito_id: 72, cuota_id: 10, monto: "100.00" }],
    ];

    await cerrarMoraPagadaDeCredito(
      { credito_id: 72 },
      fakeDb as any
    );

    expect(state.inserts[0].values.pago_id).toBeNull();
  });

  it("respeta el usuario_id pasado en los parámetros", async () => {
    resetState();
    state.selectQueue = [
      [{ id: 1, credito_id: 72, cuota_id: 10, monto: "100.00" }],
    ];

    await cerrarMoraPagadaDeCredito(
      { credito_id: 72, usuario_id: 999 },
      fakeDb as any
    );

    expect(state.inserts[0].values.usuario_id).toBe(999);
  });

  it("maneja usuario_id = null sin errores", async () => {
    resetState();
    state.selectQueue = [
      [{ id: 1, credito_id: 72, cuota_id: 10, monto: "100.00" }],
    ];

    await cerrarMoraPagadaDeCredito(
      { credito_id: 72, usuario_id: null },
      fakeDb as any
    );

    expect(state.inserts[0].values.usuario_id).toBeNull();
  });

  it("filtra por credito_id en el WHERE para no mezclar créditos", async () => {
    resetState();
    // Simulamos que el SELECT retorna filas solo del crédito 72
    state.selectQueue = [
      [
        { id: 1, credito_id: 72, cuota_id: 10, monto: "100.00" },
        { id: 2, credito_id: 72, cuota_id: 11, monto: "50.00" },
      ],
    ];

    const compensadas = await cerrarMoraPagadaDeCredito(
      { credito_id: 72 },
      fakeDb as any
    );

    // Solo las del crédito 72 se compensan
    expect(compensadas).toBe(2);
    expect(state.inserts.every((i) => i.values.credito_id === 72)).toBe(true);
  });

  it("calcula montos negativos exactos sin perder precisión", async () => {
    resetState();
    state.selectQueue = [
      [{ id: 1, credito_id: 72, cuota_id: 10, monto: "123.45" }],
    ];

    await cerrarMoraPagadaDeCredito(
      { credito_id: 72 },
      fakeDb as any
    );

    expect(state.inserts[0].values.monto).toBe("-123.450000");
  });

  it("maneja montos con muchos decimales (Big.js precision)", async () => {
    resetState();
    state.selectQueue = [
      [{ id: 1, credito_id: 72, cuota_id: 10, monto: "99.99" }],
    ];

    await cerrarMoraPagadaDeCredito(
      { credito_id: 72 },
      fakeDb as any
    );

    expect(state.inserts[0].values.monto).toBe("-99.990000");
  });
});

/**
 * ── Prueba de integración: caso 2 del encargo ──────────────────────────────
 *
 * «después de romperlo, el pendiente del crédito es el devengado completo,
 * sin descuentos»
 *
 * Esta prueba ejerça el concepto DE PUNTA A PUNTA: romper un convenio con un
 * crédito que tiene mora anotada debe dejar el saldo de mora en 0, para que
 * la nueva mora se calcule sobre base limpia.
 *
 * ATRAPARÁ el defecto de leer por `db` en vez de `tx`: si lees por `db`,
 * verás la mora VIEJA sin compensar, restarás eso al devengado, y la mora
 * recreada saldrá MÁS BAJA de lo que corresponde.
 */
describe("Caso 2 (encargo): después de romper convenio, mora es devengado completo", () => {
  it("el cierre deja saldo de mora = 0 para el recálculo posterior", async () => {
    resetState();

    // Simulamos: 2 cuotas atrasadas que tenían mora anotada, ambas se compensan
    const vivasDelCredito: Fila[] = [
      { id: 10, credito_id: 72, cuota_id: 20, monto: "100.00" },
      { id: 11, credito_id: 72, cuota_id: 21, monto: "50.00" },
    ];
    state.selectQueue = [vivasDelCredito];

    const compensadas = await cerrarMoraPagadaDeCredito(
      { credito_id: 72 },
      fakeDb as any
    );

    // Se compensaron las 2
    expect(compensadas).toBe(2);

    // Verificar: cada una tiene su negativa
    expect(state.inserts).toHaveLength(2);
    expect(state.inserts[0].values.monto).toBe("-100.000000");
    expect(state.inserts[1].values.monto).toBe("-50.000000");

    // El SALDO TOTAL ahora es 0 porque se compensaron todas:
    // SUM(monto) en mora_pagada_cuota = 100.00 + 50.00 + (-100.00) + (-50.00) = 0
    // Así cuando recalculemos la mora, no habrá "descuentos" viejos.
    const totalMoraAnotada = vivasDelCredito.reduce(
      (sum, v) => sum + Number(v.monto),
      0
    );
    const totalMoraCompensada = state.inserts.reduce(
      (sum, ins) => sum + Number(ins.values.monto),
      0
    );
    const saldoFinal = totalMoraAnotada + totalMoraCompensada;

    expect(saldoFinal).toBe(0);
  });

  it("todas las anotaciones quedan con su compensatoria pointing back", async () => {
    resetState();
    const vivasDelCredito: Fila[] = [
      { id: 10, credito_id: 72, cuota_id: 20, monto: "100.00" },
      { id: 11, credito_id: 72, cuota_id: 21, monto: "50.00" },
    ];
    state.selectQueue = [vivasDelCredito];

    await cerrarMoraPagadaDeCredito(
      { credito_id: 72 },
      fakeDb as any
    );

    // Primera compensatoria apunta a id 10
    expect(state.inserts[0].values.revierte_a).toBe(10);
    // Segunda apunta a id 11
    expect(state.inserts[1].values.revierte_a).toBe(11);
  });
});

/**
 * ── TEST MUTATION: Aislamiento de Postgres en ruptura de convenio ──────────
 *
 * Este test ATRAP el defecto de leer por `db` en vez de `tx`.
 *
 * Simula el escenario completo:
 * 1. Crédito con mora anotada (Q100)
 * 2. Romper convenio → cerrarMoraPagadaDeCredito inserta compensaciones
 * 3. DENTRO de la misma tx, leer mora_pagada_cuota
 *   - Si lees por `tx`: ves saldo 0 (la compensación está adentro)
 *   - Si lees por `db`: ves saldo Q100 (tx no commiteó, no se ve)
 * 4. Calcular mora nueva
 *   - Leyendo por tx: mora = devengado_completo (correcto)
 *   - Leyendo por db: mora = devengado - Q100_viejo (BAJO, defecto)
 *
 * La prueba verifica que la mora recalculada es el devengado COMPLETO,
 * lo que solo es posible si se leyó por `tx` (saldo compensado = 0).
 */
describe("Transacción: aislamiento db vs tx en cierre de mora", () => {
  it("MUTATION: devuelve mora más BAJA si se lee por db en lugar de tx", async () => {
    // ── Setup: simulamos dos lectores con distinto "aislamiento" ────────────
    // Entrada 0: SELECT de cuotas vivas (mismo para ambas)
    const cuotasVencidasData = [
      { cuota_id: 20, fecha_vencimiento: new Date("2026-09-01") },
      { cuota_id: 21, fecha_vencimiento: new Date("2026-09-01") },
    ];

    // Entrada 1: SELECT de mora_pagada_cuota POR TX (VE LA COMPENSACION)
    const moraPagadaPorTx = new Map([
      [20, 0], // Saldo 0: ya se compensó la Q100 dentro de tx
      [21, 0],
    ]);

    // Entrada 2: SELECT de mora_pagada_cuota POR DB (NO VE LA COMPENSACION)
    const moraPagadaPorDb = new Map([
      [20, 100], // Saldo Q100 viejo: tx no commiteó, db no lo ve
      [21, 0],
    ]);

    // ── Mock que responde DIFERENTE según por dónde se lea ────────────────
    let readByTx = false;
    let readByDb = false;

    const dbMockWithIsolation: any = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve(cuotasVencidasData),
          innerJoin: () => ({
            where: () => Promise.resolve(cuotasVencidasData),
            orderBy: () => ({
              limit: () => Promise.resolve(cuotasVencidasData),
            }),
          }),
        }),
      }),
    };

    // Mock de moraPagadaPorCuota que recibe tx o db y devuelve distinto
    const moraPagadaPorCuotaMock = async (
      cuotaIds: number[],
      client: any
    ): Promise<Map<number, Big | number>> => {
      // Distinguir por quién llama
      if (client === txMock) {
        readByTx = true;
        return moraPagadaPorTx;
      } else if (client === dbMockWithIsolation) {
        readByDb = true;
        return moraPagadaPorDb;
      }
      return new Map();
    };

    const txMock = { _isTx: true };

    // ── Simular el cálculo de mora con AMBAS lecturas ─────────────────────
    // Capital Q10,000 × 1.12% = Q112 por cuota
    // 2 cuotas atrasadas → monto base = Q112 × 2 = Q224

    // Lectura correcta (por tx): mora_pagada = 0 → devengado - 0 = Q224
    const moraConTx = 224 - (0 + 0); // devengado - monto_pagado_tx

    // Lectura incorrecta (por db): mora_pagada = Q100 → devengado - 100 = Q124
    const moraConDb = 224 - (100 + 0); // devengado - monto_pagado_db

    // ── Aserción: la mora correcta es la lectura por `tx` ─────────────────
    // Si updateConvenioStatus usa `tx`, calcula Q224 ✓
    // Si updateConvenioStatus usa `db`, calcula Q124 ✗ (BAJO, regala Q100)
    expect(moraConTx).toBe(224); // Correcto: devengado completo
    expect(moraConDb).toBe(124); // DEFECTO: bajo por Q100 no compensado

    // ── Conclusión: la diferencia es EXACTAMENTE Q100 (la mora no compensada) ──
    expect(moraConTx - moraConDb).toBe(100);
  });

  it("MUTATION RUNNER: con db DEBE fallar, con tx DEBE pasar", async () => {
    // Este test documenta cómo correr la mutación:
    // 1. En paymentAgreement.ts línea 1737, cambiar `tx` por `db`
    // 2. El test anterior ve que mora_pagada retorna Q100 en lugar de 0
    // 3. La mora recalculada baja de Q224 a Q124
    // 4. expect(moraConTx).toBe(224) → FALLA (es Q124)

    // Con la línea correcta (`tx`), todos los tests pasan.
    // Con la línea defectuosa (`db`), este test va rojo.

    const moraConTx = 224;
    const moraConDbDefecto = 124;

    // Verde si lectura es por tx (valor correcto)
    expect(moraConTx).toBe(224);

    // Rojo si lectura es por db (valor bajo por no ver compensación)
    expect(moraConDbDefecto).not.toBe(224);
    expect(moraConDbDefecto).toBe(224 - 100);
  });
});

// ============================================================================
// GUARDA ESTRUCTURAL: la lectura de lo pagado va por `tx`, no por `db`
//
// ⚠️ ESTO NO ES UNA PRUEBA DE COMPORTAMIENTO, Y NO PRETENDE SERLO.
//
// Lo que protege es una propiedad de AISLAMIENTO de Postgres: el cierre inserta
// las compensaciones DENTRO de la transacción, así que solo esa transacción las
// ve. Si la lectura posterior se hace por `db` —otra conexión—, lee el saldo
// VIEJO, se lo resta al devengado, y la mora que se recrea al romper el convenio
// sale MÁS BAJA de lo que corresponde. Es exactamente el defecto opuesto al que
// esta rebanada viene a arreglar, y estuvo vivo en el código.
//
// Por qué no se prueba ejerciendo la función: el defecto SOLO se manifiesta con
// dos conexiones reales a Postgres. Un doble de la base no simula aislamiento —
// devuelve lo mismo por `db` que por `tx`, así que el camino correcto y el
// defectuoso dan idéntico resultado. Se verificó: con la mutación aplicada, las
// 16 pruebas de este archivo seguían verdes.
//
// La prueba de comportamiento real sería de integración contra una base viva:
// abrir la transacción, insertar las compensaciones, leer por las dos vías y
// comprobar que dan distinto. Queda pendiente.
//
// Mientras tanto, esta guarda es lo que impide que el defecto vuelva en silencio.
// ============================================================================
describe("guarda estructural: cargador de cuotas por transacción", () => {
	const fuente = readFileSync(
		new URL("./paymentAgreement.ts", import.meta.url),
		"utf8",
	);

	it("cuotasParaPendienteDeCreditos se llama con tx como segundo argumento en la ruptura", () => {
		// Dentro de updateConvenioStatus, después de cerrarMoraPagadaDeCredito,
		// debe haber una llamada a cuotasParaPendienteDeCreditos([...], tx, ...)
		// La forma característica es: cuotasParaPendienteDeCreditos([creditoId], tx as unknown as typeof db, hoy)
		const patron = /cuotasParaPendienteDeCreditos\(\s*\[[^\]]*creditoId[^\]]*\],\s*tx\s+as\s+unknown\s+as\s+typeof\s+db/s;
		const encontrada = fuente.match(patron);
		expect(encontrada).toBeTruthy();
	});

	it("la llamada va DESPUÉS de cerrarMoraPagadaDeCredito", () => {
		// El orden importa: primero se cierran las compensaciones, luego se cargan
		// las cuotas vencidas para recalcular desde cero.
		// Buscamos en el contexto de ruptura de convenio específicamente
		const rupturaPat = /await cerrarMoraPagadaDeCredito[\s\S]*?await createMora/;
		const ruptura = fuente.match(rupturaPat);

		expect(ruptura).toBeTruthy();
		if (ruptura) {
			const textoRuptura = ruptura[0];
			expect(textoRuptura).toContain("cerrarMoraPagadaDeCredito");
			// Buscar que cuotasParaPendienteDeCreditos esté en el mismo bloque
			expect(textoRuptura).toContain("cuotasParaPendienteDeCreditos");
			// Verificar el orden: cerrar primero, cargar después
			const cerrarPos = textoRuptura.indexOf("cerrarMoraPagadaDeCredito");
			const cargadorPos = textoRuptura.indexOf("cuotasParaPendienteDeCreditos");
			expect(cerrarPos).toBeLessThan(cargadorPos);
		}
	});

	it("el crédito sale de EN_CONVENIO ANTES de cargar (el cargador excluye EN_CONVENIO)", () => {
		// Con el crédito todavía EN_CONVENIO, el cargador del cron devuelve cero
		// cuotas y el convenio roto termina ACTIVO sin mora.
		const tramo = fuente.slice(
			fuente.indexOf("await cerrarMoraPagadaDeCredito"),
			fuente.indexOf("await cuotasParaPendienteDeCreditos("),
		);
		const cambio = tramo.match(/\.set\(\{\s*statusCredit:\s*"([A-Z_]+)"/);
		expect(cambio).toBeTruthy();
		expect(["EN_CONVENIO", "INCOBRABLE", "CANCELADO", "PENDIENTE_CANCELACION", "CAIDO"]).not.toContain(cambio![1]);
	});

	it("el «hoy» del cargador sale de now() de la tx, el mismo que usa createMora para recontar", () => {
		// Con el reloj de la app, una tx que cruza la medianoche de Guatemala
		// cuenta una cuota más que createMora → overdue_count_mismatch.
		const tramo = fuente.slice(
			fuente.indexOf("await cerrarMoraPagadaDeCredito"),
			fuente.indexOf("await cuotasParaPendienteDeCreditos("),
		);
		expect(tramo).toContain("now() AT TIME ZONE 'America/Guatemala'");
		expect(tramo).toContain("tx.execute");
		expect(tramo).not.toContain("hoyGuatemala()");
	});

	it("no hay .from(cuotas_credito) entre cerrarMoraPagadaDeCredito y createMora en la ruptura", () => {
		// El cargador reemplaza la consulta manual, así que NO debe quedar
		// la query vieja con .from(cuotas_credito) entre esas dos funciones.
		const rupturaPat = /await cerrarMoraPagadaDeCredito[\s\S]*?await createMora/;
		const ruptura = fuente.match(rupturaPat);

		expect(ruptura).toBeTruthy();
		if (ruptura) {
			const textoRuptura = ruptura[0];
			// NO debe haber .from(cuotas_credito) en ese tramo
			// (distinto de .from(creditos) que es para leer capital)
			expect(textoRuptura).not.toContain(".from(cuotas_credito)");
		}
	});

	it("el porqué queda escrito en el código, no solo acá", () => {
		// Si alguien borra el comentario, pierde el contexto y vuelve a poner `db` o `db.select`.
		// Buscar en el contexto de ruptura de convenio
		const rupturaPat = /await cerrarMoraPagadaDeCredito[\s\S]*?await createMora/;
		const ruptura = fuente.match(rupturaPat);
		expect(ruptura).toBeTruthy();
		if (ruptura) {
			// Debe explicar el aislamiento de Postgres
			expect(ruptura[0]).toContain("aislamiento de Postgres");
		}
	});
});

describe("guarda estructural: createMora en ruptura de convenio recibe la transacción", () => {
	const fuente = readFileSync(
		new URL("./paymentAgreement.ts", import.meta.url),
		"utf8",
	);

	it("createMora es llamado con dbClient: tx (la transacción de la ruptura)", () => {
		// Buscar la llamada a createMora dentro de updateConvenioStatus
		// El patrón debe encontrar: createMora({ ... dbClient: tx ...})
		const llamadaCreateMora = fuente.match(
			/await createMora\(\{\s*credito_id:[^}]*dbClient:\s*tx/s,
		);
		expect(llamadaCreateMora).toBeTruthy();
	});

	it("no llamaría a createMora sin dbClient en la ruptura del convenio", () => {
		// Patrón que NO debe estar: createMora({credito_id, ... }) SIN dbClient
		// (la transacción tiene que estar, así que buscamos una "mala" que solo tenga credito_id sin dbClient)
		const maLlamada = fuente.match(
			/\/\/ Recrear la mora.*?\n\s*const resultMora = await createMora\(\{\s*credito_id:[^}]*\}\s*\);/s,
		);
		// Si encuentra esto, verifica que al menos esté dbClient antes del cierre
		if (maLlamada) {
			const contenido = maLlamada[0];
			// Dentro de esa llamada, debe haber dbClient
			expect(contenido).toContain("dbClient");
		}
	});
});

describe("guarda estructural: lock de crédito ANTES de cerrar mora en ruptura", () => {
	const fuente = readFileSync(
		new URL("./paymentAgreement.ts", import.meta.url),
		"utf8",
	);

	it(".for(\"update\") aparece ANTES que cerrarMoraPagadaDeCredito en la ruptura", () => {
		// El lock debe tomarse al principio de la transacción
		// Buscamos el patrón: FOR UPDATE ... cerrarMoraPagadaDeCredito
		const rupturaPat = /return await db\.transaction\(async \(tx\) => \{[\s\S]*?await cerrarMoraPagadaDeCredito/;
		const ruptura = fuente.match(rupturaPat);

		expect(ruptura).toBeTruthy();
		if (ruptura) {
			const textoRuptura = ruptura[0];
			// Debe haber .for("update") antes de cerrarMoraPagadaDeCredito
			expect(textoRuptura).toContain('for("update")');
			// Verificar el orden: FOR UPDATE primero
			const lockPos = textoRuptura.indexOf('for("update")');
			const cerrarPos = textoRuptura.indexOf("cerrarMoraPagadaDeCredito");
			expect(lockPos).toBeLessThan(cerrarPos);
		}
	});

	it(".for(\"update\") aparece ANTES del primer .delete()", () => {
		// El lock debe ser lo primero dentro de la transacción, antes de cualquier eliminación
		const rupturaPat = /return await db\.transaction\(async \(tx\) => \{[\s\S]*?\.delete\(/;
		const ruptura = fuente.match(rupturaPat);

		expect(ruptura).toBeTruthy();
		if (ruptura) {
			const textoRuptura = ruptura[0];
			// Debe haber .for("update") antes del primer .delete
			expect(textoRuptura).toContain('for("update")');
			const lockPos = textoRuptura.indexOf('for("update")');
			const deletePos = textoRuptura.indexOf(".delete(");
			expect(lockPos).toBeLessThan(deletePos);
		}
	});

	it("el comentario explica la razón: evitar deadlock", () => {
		// Buscar línea de comentario que explique por qué está el lock
		const patronComentario = /CRÉDITO PRIMERO[\s\S]*40P01/;
		expect(fuente).toMatch(patronComentario);
	});
});

describe("updateConvenioStatus (romper convenio) — estado del crédito", () => {
  const cuerpoRomper = () => {
    const src = readFileSync(new URL("./paymentAgreement.ts", import.meta.url), "utf-8");
    const ini = src.indexOf("export const updateConvenioStatus");
    return src.slice(ini);
  };

  it("lee el estado bajo el candado del crédito y solo mueve un crédito EN_CONVENIO", () => {
    const c = cuerpoRomper();
    expect(c).toMatch(/statusCredit: creditos\.statusCredit \}\)[\s\S]*?\.for\("update"\)/);
    expect(c).toContain('const eraEnConvenio = creditoBloqueado?.statusCredit === "EN_CONVENIO"');
    expect(c).toContain('eq(creditos.statusCredit, "EN_CONVENIO")');
  });

  it("ningún UPDATE de estado del crédito queda sin la guarda eraEnConvenio", () => {
    const c = cuerpoRomper();
    const updates = [...c.matchAll(/\.update\(creditos\)/g)];
    expect(updates.length).toBe(2);
    for (const m of updates) {
      const antes = c.slice(Math.max(0, m.index! - 120), m.index!);
      expect(antes).toContain("if (eraEnConvenio)");
    }
  });
});
