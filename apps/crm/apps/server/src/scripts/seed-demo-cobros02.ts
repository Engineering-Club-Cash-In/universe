/**
 * Seed de datos de demo de COBROS-02 — SOLO DEV (Neon `ep-green-tree`).
 * Plan y decisiones: docs/features/cobros-02/24-seed-datos-demo.md
 *
 *   TZ=UTC bun run src/scripts/seed-demo-cobros02.ts --dry-run
 *   TZ=UTC bun run src/scripts/seed-demo-cobros02.ts --confirmar-bd=ep-green-tree
 *   TZ=UTC bun run src/scripts/seed-demo-cobros02.ts --convenios --confirmar-bd=ep-green-tree
 *   TZ=UTC bun run src/scripts/seed-demo-cobros02.ts --limpiar [--corrida=demo-…] --confirmar-bd=ep-green-tree
 *
 * Parámetros:
 *   --dias=N   Días hacia atrás que se llenan, contando hoy (N=1 → ayer y hoy).
 *              Default: 90 en la primera siembra; 1 cuando ya hubo una.
 *   La primera corrida reconstruye la historia y siembra todo. Las siguientes son
 *   INCREMENTALES: siguen después de la última gestión sembrada (no duplican),
 *   continúan las promesas abiertas y no vuelven a crear solicitudes, eventos GPS,
 *   coberturas ni avisos; esos y las subidas/bajadas del cierre los llenan los jobs
 *   (`CIERRE_DIARIO_ENABLED`, alertas y promesas). Ejemplo, cada mañana:
 *     TZ=UTC bun run src/scripts/seed-demo-cobros02.ts --dias=1 --confirmar-bd=ep-green-tree
 *
 * Qué hace (todo en una transacción, salvo los convenios):
 *   1. Vida del crédito: reconstruye `buckets_historial` y `credito_asesor_historial`
 *      de cartera a partir de las cuotas y los pagos reales (bucket = cuotas vencidas
 *      sin pagar ese día). Termina siempre en el bucket y el asesor actuales, así que
 *      el motor no tiene nada que corregir. Lo que había se respalda en
 *      `cartera_cobros2._seed_demo_bk_*` y `--limpiar` lo devuelve.
 *   2. Gestiones SOLO para créditos `CRM-…` vivos (regla de Daniel), con o sin caso:
 *      el caso que falte se crea igual que `getDetallesCreditoCarteraBack`.
 *      Llamadas, WhatsApp, promesas (su estado sale de las cuotas pagadas, como
 *      `evaluarPromesa`), visitas, referencias, redes, recuperaciones, apagados,
 *      eventos GPS, jurídico y rebaja de mora.
 *   3. Supervisión: cierre diario, agendas cerradas de los últimos 30 días, metas,
 *      una cobertura por vacaciones y notificaciones de cobros.
 *   4. `--convenios`: convenios por la API real del sandbox (crearConvenioDesdeFicha
 *      como el asesor dueño y decidirConvenio como supervisor). Pendientes,
 *      aprobados y rechazados.
 *
 * Nunca envía mensajes: solo inserta. Cada fila sembrada queda en
 * `public.seed_demo_filas` y `--limpiar` borra exactamente eso.
 */

import { SQL } from "bun";

// ─── Argumentos y candados ────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) =>
	argv
		.find((a) => a.startsWith(`--${n}=`))
		?.split("=")
		.slice(1)
		.join("=");

const DRY = flag("dry-run");
const LIMPIAR = flag("limpiar");
const CONVENIOS = flag("convenios");
const DIAS_ARG = opt("dias");
const SEMILLA = Number(opt("semilla") ?? 20261013);
const CRM_API =
	opt("crm-api") ?? "https://tgmt4r4n8pjjqpi7rjqf5lfb.devteamatcci.site";
const CLAVE_DEV = process.env.SEED_DEMO_PASSWORD ?? "CobrosDev2026!";
const CS = "cartera_cobros2";

if (process.env.TZ !== "UTC") {
	console.error("Correr con TZ=UTC (las fechas se arman en UTC a mano).");
	process.exit(1);
}
const URL_BASE = process.env.DATABASE_URL ?? "";
const HOST = URL_BASE ? new URL(URL_BASE).hostname : "";
if (
	!HOST.includes("ep-green-tree") ||
	/supabase\.com|ep-winter-butterfly/.test(HOST)
) {
	console.error(`Host no permitido: «${HOST}». Este seed es solo para DEV.`);
	process.exit(1);
}
if (!DRY) {
	const confirmado = opt("confirmar-bd");
	if (!confirmado || !HOST.includes(confirmado)) {
		console.error(
			`Falta --confirmar-bd=<parte del host> (host: ${HOST}). Primero --dry-run.`,
		);
		process.exit(1);
	}
}
// Conexión directa: nunca el pooler (ver feedback de search_path y restores).
const sql = new SQL(URL_BASE.replace("-pooler", ""));

// ─── Fechas (todo en UTC; Guatemala = UTC-6 sin horario de verano) ─────────

const pad = (n: number) => String(n).padStart(2, "0");
const fmtUtc = (d: Date) =>
	`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
const diaGT = (d: Date) => {
	const g = new Date(d.getTime() - 6 * 3600e3);
	return `${g.getUTCFullYear()}-${pad(g.getUTCMonth() + 1)}-${pad(g.getUTCDate())}`;
};
const partes = (dia: string) =>
	dia.split("-").map(Number) as [number, number, number];
function sumarDias(dia: string, n: number): string {
	const [y, m, d] = partes(dia);
	const t = new Date(Date.UTC(y, m - 1, d + n));
	return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
const diaSemana = (dia: string) => {
	const [y, m, d] = partes(dia);
	return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
const habil = (dia: string) => diaSemana(dia) !== 0;
/** Hora de Guatemala → timestamp UTC «YYYY-MM-DD HH:MM:SS». */
function enGT(dia: string, h: number, m = 0, s = 0): string {
	const [y, mo, d] = partes(dia);
	return fmtUtc(new Date(Date.UTC(y, mo - 1, d, h + 6, m, s)));
}
const ms = (ts: string) => Date.parse(`${ts.replace(" ", "T")}Z`);
function sumarHabiles(dia: string, n: number): string {
	let d = dia;
	let k = 0;
	while (k < n) {
		d = sumarDias(d, 1);
		if (habil(d)) k++;
	}
	return d;
}
function habilesEntre(desde: string, hasta: string): number {
	let n = 0;
	for (let d = sumarDias(desde, 1); d <= hasta; d = sumarDias(d, 1))
		if (habil(d)) n++;
	return n;
}
function* dias(desde: string, hasta: string) {
	for (let d = desde; d <= hasta; d = sumarDias(d, 1)) yield d;
}
const fechaLegible = (dia: string) => {
	const [y, m, d] = partes(dia);
	return `${pad(d)}/${pad(m)}/${y}`;
};

const AHORA = new Date();
const HOY = diaGT(AHORA);
/** Primer día que se siembra. Se fija en `sembrar()`: 90 días la primera vez,
 *  1 (ayer y hoy) cuando ya hay una siembra anterior, o lo que diga --dias. */
let INICIO = sumarDias(HOY, -90);
/** Modo incremental: ya hubo una siembra; solo se agregan los días que faltan. */
let INCREMENTAL = false;
/** Nada se siembra en o antes de esto (la última gestión de la siembra anterior). */
let MIN_TS = "0000-00-00 00:00:00";
/** Nada sembrado después de esto: la demo no puede tener gestiones "del futuro". */
const CORTE_HOY = fmtUtc(new Date(AHORA.getTime() - 10 * 60e3));
const CORRIDA =
	opt("corrida") ??
	`demo-${HOY}-${fmtUtc(new Date(AHORA.getTime() - 6 * 3600e3))
		.slice(11, 16)
		.replace(":", "")}`;

// ─── RNG con semilla (reproducible) ────────────────────────────────────────

function mulberry32(semilla: number) {
	let a = semilla;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
function crearRng(semilla: number) {
	const f = mulberry32(semilla);
	return {
		f,
		int: (a: number, b: number) => a + Math.floor(f() * (b - a + 1)),
		pick: <T>(xs: readonly T[]): T => xs[Math.floor(f() * xs.length)],
		chance: (p: number) => f() < p,
		/** Elige con pesos: [[valor, peso], …]. */
		pesos: <T>(xs: readonly (readonly [T, number])[]): T => {
			const total = xs.reduce((s, [, w]) => s + w, 0);
			let r = f() * total;
			for (const [v, w] of xs) {
				r -= w;
				if (r <= 0) return v;
			}
			return xs[xs.length - 1][0];
		},
	};
}
type Rng = ReturnType<typeof crearRng>;
const rngDe = (k: number) => crearRng((SEMILLA * 7919 + k * 104729) | 0);
const uuid = () => crypto.randomUUID();
/** Hora hábil de Guatemala (lunes a viernes 8:00–17:30, sábado 8:00–12:30). */
function horaHabil(rng: Rng, dia: string, desdeH = 8): string {
	const finH = diaSemana(dia) === 6 ? 12.5 : 17.5;
	const h = desdeH + rng.f() * Math.max(0.5, finH - desdeH);
	return enGT(dia, Math.floor(h), Math.floor((h % 1) * 60), rng.int(0, 59));
}
const sumarMin = (ts: string, min: number) =>
	fmtUtc(new Date(ms(ts) + min * 60e3));
const q2 = (n: number) => Math.round(n * 100) / 100;

// ─── Tipos ────────────────────────────────────────────────────────────────

type Cuota = {
	id: number;
	n: number;
	fv: string;
	pagado: boolean;
	pagadaDia: string | null;
	pagadaTs: string | null;
};
type Segmento = {
	desde: string;
	b: number;
	atr: number;
	asesor: number | null;
};
type Credito = {
	id: number;
	sifco: string;
	st: string;
	asesorId: number | null;
	cuota: number;
	deuda: number;
	creado: string;
	mora: number;
	esCrm: boolean;
	cuotas: Cuota[];
	bucketActual: number | null;
	intocable: boolean;
	segmentos: Segmento[];
};
type Fila = Record<string, unknown>;

// ─── Utilidades de base ───────────────────────────────────────────────────

const arrInt = (xs: number[]) => `{${xs.join(",")}}`;
const arrTxt = (xs: string[]) =>
	`{${xs.map((x) => `"${x.replaceAll('"', '\\"')}"`).join(",")}}`;

type Tx = Pick<SQL, "unsafe">;

/** INSERT masivo vía jsonb_populate_recordset (respeta enums, arrays y jsonb). */
async function insertar(
	tx: Tx,
	tabla: string,
	filas: Fila[],
	extra = "",
): Promise<Fila[]> {
	if (filas.length === 0) return [];
	const cols = [...new Set(filas.flatMap((f) => Object.keys(f)))];
	const lista = cols.map((c) => `"${c}"`).join(",");
	const out: Fila[] = [];
	for (let i = 0; i < filas.length; i += 800) {
		const trozo = filas
			.slice(i, i + 800)
			.map((f) => Object.fromEntries(cols.map((c) => [c, f[c] ?? null])));
		const r = await tx.unsafe(
			`INSERT INTO ${tabla} (${lista}) SELECT ${lista} FROM jsonb_populate_recordset(NULL::${tabla}, $1::text::jsonb) ${extra}`,
			[JSON.stringify(trozo)],
		);
		out.push(...(r as Fila[]));
	}
	return out;
}

const marcadas: { tabla: string; pk: string }[] = [];
const marcar = (tabla: string, pks: unknown[]) => {
	for (const pk of pks) marcadas.push({ tabla, pk: String(pk) });
};

async function prepararTablasDeMarca(tx: Tx) {
	await tx.unsafe(`CREATE TABLE IF NOT EXISTS public.seed_demo_filas (
		corrida text NOT NULL, tabla text NOT NULL, pk text NOT NULL,
		creado_en timestamp NOT NULL DEFAULT now())`);
	await tx.unsafe(
		"CREATE INDEX IF NOT EXISTS seed_demo_filas_corrida_idx ON public.seed_demo_filas (corrida, tabla)",
	);
	await tx.unsafe(
		`CREATE TABLE IF NOT EXISTS ${CS}._seed_demo_bk_buckets_historial AS SELECT *, ''::text AS seed_corrida FROM ${CS}.buckets_historial WITH NO DATA`,
	);
	await tx.unsafe(
		`CREATE TABLE IF NOT EXISTS ${CS}._seed_demo_bk_credito_asesor_historial AS SELECT *, ''::text AS seed_corrida FROM ${CS}.credito_asesor_historial WITH NO DATA`,
	);
}

// ─── Limpieza ─────────────────────────────────────────────────────────────

/** Orden de borrado: primero lo que apunta a otras filas sembradas. */
const ORDEN_LIMPIEZA = [
	"public.notifications",
	"public.agenda_cobros_snapshot_items",
	"public.agenda_cobros_snapshots",
	"public.cierre_diario_credito_cobros",
	"public.inmovilizaciones_unidad_eventos",
	"public.inmovilizaciones_unidad",
	"public.hallazgos_localizacion_cobros",
	"public.contactos_referencias_cobros",
	"public.investigaciones_redes_cobros",
	"public.visitas_cobros",
	"public.recuperaciones_vehiculo",
	"public.gps_eventos",
	"public.solicitudes_juridico_cobros",
	"public.solicitudes_rebaja_mora_cobros",
	"public.coberturas_agenda_cobros",
	"public.metas_asesor_cobros",
	"public.contactos_cobros",
	"public.casos_cobros",
	`${CS}.buckets_historial`,
	`${CS}.credito_asesor_historial`,
];
const PK: Record<string, string> = {
	[`${CS}.buckets_historial`]: "historial_id",
	[`${CS}.credito_asesor_historial`]: "historial_id",
};

async function limpiar() {
	const corridas = (await sql
		.unsafe(
			"SELECT corrida, count(*)::int n FROM public.seed_demo_filas WHERE $1::text IS NULL OR corrida = $1 GROUP BY 1 ORDER BY 1 DESC",
			[opt("corrida") ?? null],
		)
		.catch(() => [])) as { corrida: string; n: number }[];
	if (corridas.length === 0) {
		console.log("No hay nada sembrado.");
		return;
	}
	for (const { corrida, n } of corridas) {
		console.log(`Limpiando corrida ${corrida} (${n} filas marcadas)…`);
		await sql.begin(async (tx) => {
			for (const tabla of ORDEN_LIMPIEZA) {
				const pk = PK[tabla] ?? "id";
				const tipo = PK[tabla] ? "int" : "uuid";
				// Los casos creados por el seed solo se borran si ya nadie los usa
				// (en la demo alguien pudo registrar algo real sobre ellos).
				const condicionExtra =
					tabla === "public.casos_cobros"
						? ` AND NOT EXISTS (SELECT 1 FROM public.contactos_cobros c WHERE c.caso_cobro_id = t.id)
						    AND NOT EXISTS (SELECT 1 FROM public.cierre_diario_credito_cobros c WHERE c.caso_cobro_id = t.id)
						    AND NOT EXISTS (SELECT 1 FROM public.agenda_cobros_snapshot_items c WHERE c.caso_cobro_id = t.id)`
						: "";
				const r = await tx.unsafe(
					`DELETE FROM ${tabla} t WHERE t.${pk} IN (
						SELECT pk::${tipo} FROM public.seed_demo_filas WHERE corrida = $1 AND tabla = $2)${condicionExtra}`,
					[corrida, tabla],
				);
				if (r.count) console.log(`  ${tabla}: ${r.count} borradas`);
			}
			// Devolver la historia de cartera que se reemplazó.
			for (const t of ["buckets_historial", "credito_asesor_historial"]) {
				const cols = (
					(await tx.unsafe(
						`SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position) c
						 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
						[CS, t],
					)) as { c: string }[]
				)[0].c;
				const r = await tx.unsafe(
					`INSERT INTO ${CS}.${t} (${cols}) OVERRIDING SYSTEM VALUE
					 SELECT ${cols} FROM ${CS}._seed_demo_bk_${t} WHERE seed_corrida = $1
					 ON CONFLICT DO NOTHING`,
					[corrida],
				);
				await tx.unsafe(
					`DELETE FROM ${CS}._seed_demo_bk_${t} WHERE seed_corrida = $1`,
					[corrida],
				);
				console.log(`  ${CS}.${t}: ${r.count} filas originales devueltas`);
			}
			await tx.unsafe("DELETE FROM public.seed_demo_filas WHERE corrida = $1", [
				corrida,
			]);
		});
	}
	console.log(
		"Listo. Los convenios creados por la API no se tocan: se van con la próxima alineación de cartera (o se rechazan a mano).",
	);
}

// ─── Carga de datos ───────────────────────────────────────────────────────

const ESTADOS_VIVOS = [
	"ACTIVO",
	"MOROSO",
	"EN_CONVENIO",
	"PENDIENTE_CANCELACION",
	"INCOBRABLE",
	"EN_RECUPERACION",
	"EN_JURIDICO",
];

async function cargar() {
	const vivos = arrTxt(ESTADOS_VIVOS);
	const creditosRaw = (await sql.unsafe(
		`SELECT c.credito_id::int id, c.numero_credito_sifco sifco, c."statusCredit" st,
		        c.asesor_id::int asesor_id, coalesce(c.cuota, 0)::float8 cuota,
		        coalesce(c.deudatotal, 0)::float8 deuda,
		        coalesce(to_char(c.fecha_creacion AT TIME ZONE 'America/Guatemala', 'YYYY-MM-DD'), '2024-01-01') creado,
		        coalesce(m.monto_mora, 0)::float8 mora
		 FROM ${CS}.creditos c
		 LEFT JOIN LATERAL (SELECT monto_mora FROM ${CS}.moras_credito m
		                    WHERE m.credito_id = c.credito_id AND m.activa
		                    ORDER BY m.mora_id DESC LIMIT 1) m ON true
		 WHERE c."statusCredit" = ANY($1::text::text[])`,
		[vivos],
	)) as Fila[];

	const cuotasRaw = (await sql.unsafe(
		`WITH pg AS (
			SELECT cuota_id, max(coalesce(fecha_pago, fecha_aplicado)) m
			FROM ${CS}.pagos_credito
			WHERE pagado AND NOT coalesce("paymentFalse", false) AND cuota_id IS NOT NULL
			GROUP BY 1)
		 SELECT q.credito_id::int cid, q.cuota_id::int id, q.numero_cuota::int n,
		        q.fecha_vencimiento::text fv, coalesce(q.pagado, false) pagado,
		        to_char(pg.m, 'YYYY-MM-DD HH24:MI:SS') pagada
		 FROM ${CS}.cuotas_credito q
		 JOIN ${CS}.creditos c USING (credito_id)
		 LEFT JOIN pg USING (cuota_id)
		 WHERE q.numero_cuota > 0 AND q.fecha_vencimiento IS NOT NULL
		   AND c."statusCredit" = ANY($1::text::text[])
		 ORDER BY 1, 3`,
		[vivos],
	)) as Fila[];

	const histRaw = (await sql.unsafe(
		`SELECT credito_id::int cid,
		        (array_agg(bucket_nuevo ORDER BY fecha DESC, historial_id DESC))[1]::int b,
		        bool_or(tipo_evento = 'CONGELADO' OR (origen = 'API_MANUAL' AND tipo_evento <> 'INICIAL')) intocable,
		        bool_or(referencia_externa LIKE 'seed-demo:%') sembrado
		 FROM ${CS}.buckets_historial GROUP BY 1`,
	)) as Fila[];

	const cuotasPor = new Map<number, Cuota[]>();
	for (const r of cuotasRaw) {
		const pagada = r.pagada as string | null;
		const lista = cuotasPor.get(r.cid as number) ?? [];
		lista.push({
			id: r.id as number,
			n: r.n as number,
			fv: r.fv as string,
			pagado: r.pagado as boolean,
			pagadaDia: r.pagado ? (pagada?.slice(0, 10) ?? null) : null,
			pagadaTs: r.pagado ? pagada : null,
		});
		cuotasPor.set(r.cid as number, lista);
	}
	const histPor = new Map(histRaw.map((h) => [h.cid as number, h]));
	const yaSembrado = histRaw.some((h) => h.sembrado);

	const creditos: Credito[] = creditosRaw.map((r) => {
		const h = histPor.get(r.id as number);
		return {
			id: r.id as number,
			sifco: r.sifco as string,
			st: r.st as string,
			asesorId: (r.asesor_id as number | null) ?? null,
			cuota: r.cuota as number,
			deuda: r.deuda as number,
			creado: r.creado as string,
			mora: r.mora as number,
			esCrm: (r.sifco as string)?.startsWith("CRM-") ?? false,
			cuotas: cuotasPor.get(r.id as number) ?? [],
			bucketActual: h ? (h.b as number) : null,
			intocable: h ? (h.intocable as boolean) || r.st === "EN_CONVENIO" : true,
			segmentos: [],
		};
	});

	const pool = (await sql.unsafe(
		`SELECT ab.bucket::int b, a.asesor_id::int asesor, a.nombre, u.id user_id
		 FROM ${CS}.asesor_bucket ab JOIN ${CS}.asesores a USING (asesor_id)
		 LEFT JOIN public."user" u ON lower(u.email) = lower(a.email_cash_in) AND u.banned IS NOT TRUE
		 WHERE ab.activo ORDER BY 1, 2`,
	)) as Fila[];
	const supervisores = (await sql.unsafe(
		`SELECT id, name FROM public."user" WHERE role = 'cobros_supervisor' AND banned IS NOT TRUE ORDER BY name`,
	)) as { id: string; name: string }[];
	const sistema = (
		(await sql.unsafe(
			`SELECT id FROM public."user" WHERE role = 'admin' ORDER BY created_at, id LIMIT 1`,
		)) as { id: string }[]
	)[0].id;

	const casos = (await sql.unsafe(
		`SELECT DISTINCT ON (numero_credito_sifco) id, numero_credito_sifco sifco
		 FROM public.casos_cobros WHERE activo AND numero_credito_sifco LIKE 'CRM-%'
		 ORDER BY numero_credito_sifco, created_at`,
	)) as { id: string; sifco: string }[];

	const fichas = (await sql.unsafe(
		`SELECT DISTINCT ON (o.numero_sifco) o.numero_sifco sifco, o.id opp, o.lead_id,
		        trim(concat_ws(' ', l.first_name, l.last_name)) nombre, l.phone, l.email, l.direccion,
		        v.id vehicle_id, v.wialon_unit_id::int wialon, v.license_plate placa, v.make, v.model,
		        ca.id sol_id, ca.referencias_personales::text refs, ca.direccion_residencia,
		        ca.empresa, ca.direccion_trabajo
		 FROM public.opportunities o
		 LEFT JOIN public.leads l ON l.id = o.lead_id
		 LEFT JOIN public.vehicles v ON v.id = o.vehicle_id
		 LEFT JOIN LATERAL (SELECT * FROM public.credit_applications ca
		                    WHERE ca.opportunity_id = o.id AND (ca.person_type = 'lead' OR ca.person_type IS NULL)
		                    ORDER BY ca.created_at ASC LIMIT 1) ca ON true
		 WHERE o.numero_sifco LIKE 'CRM-%'
		 ORDER BY o.numero_sifco, o.created_at DESC`,
	)) as Fila[];

	const referencias = (await sql.unsafe(
		`SELECT numero_credito_sifco sifco, contrato_financiamiento_id contrato
		 FROM public.cartera_back_references WHERE numero_credito_sifco LIKE 'CRM-%'`,
	)) as { sifco: string; contrato: string | null }[];

	const buckets = (await sql.unsafe(
		`SELECT numero::int b, prefijo, nombre, coalesce(dias_sla, 0)::int sla FROM ${CS}.buckets ORDER BY 1`,
	)) as { b: number; prefijo: string; nombre: string; sla: number }[];

	return {
		yaSembrado,
		creditos,
		pool,
		supervisores,
		sistema,
		casos,
		fichas,
		referencias,
		buckets,
	};
}

// ─── 1. Vida del crédito ──────────────────────────────────────────────────

function atrasadas(c: Credito, dia: string): number {
	let n = 0;
	for (const q of c.cuotas) {
		if (q.fv >= dia) break; // ordenadas por número ≈ por fecha
		if (!q.pagado || (q.pagadaDia !== null && q.pagadaDia > dia)) n++;
	}
	return n;
}
const cuotasVencidas = (c: Credito, dia: string) =>
	c.cuotas.filter(
		(q) =>
			q.fv < dia && (!q.pagado || (q.pagadaDia !== null && q.pagadaDia > dia)),
	);

/** Bucket por día desde `desde`, forzando el último tramo al bucket/asesor actuales. */
function armarSegmentos(
	c: Credito,
	desde: string,
	poolPorBucket: Map<number, number[]>,
): Segmento[] {
	const crudos: { desde: string; b: number; atr: number }[] = [];
	for (const d of dias(desde, HOY)) {
		const atr = atrasadas(c, d);
		const b = Math.min(atr, 5);
		const ult = crudos[crudos.length - 1];
		if (!ult || ult.b !== b) crudos.push({ desde: d, b, atr });
	}
	if (c.bucketActual !== null) crudos[crudos.length - 1].b = c.bucketActual;
	// Fusionar tramos iguales que quedaron pegados al forzar el final.
	const tramos: typeof crudos = [];
	for (const t of crudos) {
		const ult = tramos[tramos.length - 1];
		if (ult && ult.b === t.b) continue;
		tramos.push({ ...t });
	}
	// Asesor por tramo: el del pool del bucket, pegajoso (el motor no reasigna si
	// el asesor sigue siendo elegible) y el último es siempre el actual.
	const segs: Segmento[] = [];
	let previo: number | null = null;
	tramos.forEach((t, i) => {
		const esUltimo = i === tramos.length - 1;
		const lista = poolPorBucket.get(t.b) ?? [];
		let asesor: number | null;
		if (esUltimo && c.asesorId !== null) asesor = c.asesorId;
		else if (previo !== null && lista.includes(previo)) asesor = previo;
		else if (c.asesorId !== null && lista.includes(c.asesorId))
			asesor = c.asesorId;
		else asesor = lista.length ? lista[c.id % lista.length] : null;
		segs.push({ ...t, asesor });
		previo = asesor;
	});
	return segs;
}

function segmentoEn(c: Credito, dia: string): Segmento | null {
	let s: Segmento | null = null;
	for (const x of c.segmentos) {
		if (x.desde <= dia) s = x;
		else break;
	}
	return s;
}

function historiaDeCartera(c: Credito, rng: Rng) {
	const bh: Fila[] = [];
	const cah: Fila[] = [];
	c.segmentos.forEach((s, i) => {
		const esUltimo = i === c.segmentos.length - 1;
		const st = esUltimo ? c.st : s.b >= 1 ? "MOROSO" : "ACTIVO";
		let fecha: string;
		if (i === 0)
			fecha =
				c.esCrm && s.desde === c.creado
					? enGT(s.desde, 10, rng.int(0, 59))
					: enGT(s.desde, 0, 5, rng.int(0, 59));
		else if (s.b > c.segmentos[i - 1].b)
			fecha = enGT(s.desde, 0, rng.int(8, 25), rng.int(0, 59));
		else {
			// Bajada: a la hora del pago si la trae; si no, en horario hábil.
			const pago = c.cuotas.find((q) => q.pagadaDia === s.desde)?.pagadaTs;
			fecha =
				pago && !pago.endsWith("00:00:00")
					? sumarMin(pago, 6 * 60)
					: horaHabil(rng, s.desde, 9);
		}
		if (s.desde === HOY && ms(fecha) > ms(CORTE_HOY)) fecha = CORTE_HOY;
		bh.push({
			credito_id: c.id,
			bucket_anterior: i === 0 ? null : c.segmentos[i - 1].b,
			bucket_nuevo: s.b,
			tipo_evento:
				i === 0 ? "INICIAL" : s.b > c.segmentos[i - 1].b ? "SUBIDA" : "BAJADA",
			origen: "PROCESO_AUTO",
			cuotas_atrasadas_nuevas: s.atr,
			status_credito: st,
			asesor_id: null,
			pago_id: null,
			motivo:
				i === 0 ? "Línea base — primer registro en el motor de buckets" : null,
			fecha,
			referencia_externa: `seed-demo:${c.id}:${i}`,
		});
		const anterior = i === 0 ? null : c.segmentos[i - 1].asesor;
		if (i === 0 || anterior !== s.asesor)
			cah.push({
				credito_id: c.id,
				asesor_anterior: anterior,
				asesor_nuevo: s.asesor,
				bucket: s.b,
				origen: "PROCESO_AUTO",
				motivo:
					i === 0
						? "Asignación inicial por bucket"
						: `Reasignación automática por cambio de bucket B${c.segmentos[i - 1].b}→B${s.b}`,
				usuario_id: null,
				fecha: sumarMin(fecha, 0.02),
			});
	});
	return { bh, cah };
}

// ─── 2. Gestiones ─────────────────────────────────────────────────────────

const ZONAS = [
	"Zona 7, Ciudad de Guatemala",
	"Zona 18, Ciudad de Guatemala",
	"Mixco, colonia El Naranjo",
	"Villa Nueva, Ciudad Real",
	"Zona 12, Ciudad de Guatemala",
	"San Miguel Petapa, Villa Hermosa",
	"Zona 6, Ciudad de Guatemala",
	"Villa Canales, Boca del Monte",
];
const TXT = {
	noContesta: [
		"Se llamó al titular; no contestó.",
		"Timbra y se va al buzón de voz.",
		"Teléfono apagado; se intentará más tarde.",
		"No contesta en dos intentos seguidos.",
		"Llamada sin respuesta; se deja mensaje de voz.",
	],
	wspEnviado: [
		"Se envió mensaje por WhatsApp con el saldo vencido y las formas de pago.",
		"Se envió recordatorio de la cuota vencida por WhatsApp.",
		"Se compartieron por WhatsApp las cuentas para depósito.",
		"Mensaje por WhatsApp solicitando comunicarse a la brevedad.",
	],
	contactado: [
		"Cliente indica que paga esta semana; está esperando su salario.",
		"Cliente reconoce el atraso y pide que le envíen los números de cuenta.",
		"Cliente comenta que tuvo un gasto médico; se le explicó la mora acumulada.",
		"Se confirmó dirección y lugar de trabajo; el cliente revisará su presupuesto.",
		"Cliente dice que su negocio bajó las ventas; pide unos días para ordenarse.",
		"Cliente atiende la llamada y pide que lo contacten por WhatsApp.",
	],
	contactadoWsp: [
		"Cliente respondió por WhatsApp; pide el detalle del saldo.",
		"Cliente confirma que recibió el mensaje y que pasará a pagar.",
		"Cliente envió mensaje: está esperando un pago para ponerse al día.",
	],
	rechaza: [
		"Cliente indica que no puede pagar por ahora; perdió el empleo.",
		"Cliente se niega a pagar; reclama por el cobro del seguro.",
		"Cliente dice que no pagará hasta hablar con un supervisor.",
	],
	equivocado: [
		"Contestó otra persona; dice no conocer al titular.",
		"El número ya no pertenece al cliente.",
	],
	parcial: [
		"Cliente abonará una parte esta semana y el resto la próxima.",
		"Se acordó un abono parcial; el saldo lo completa con su próximo salario.",
	],
	d0: [
		"Se recordó al cliente su cuota que vence hoy; indica que paga en el transcurso del día.",
		"Cliente confirma que hoy deposita la cuota del mes.",
		"Se confirmó con el cliente el pago de la cuota de hoy por transferencia.",
	],
	supervisor: [
		"Llamada de supervisión: el cliente explica su situación y se compromete a regularizar.",
		"Llamada de supervisión: se le recordaron las consecuencias de seguir en mora.",
	],
	recordatorioPromesa: [
		"Se le recordó por WhatsApp la promesa de pago de mañana.",
		"Recordatorio por WhatsApp del compromiso de pago.",
	],
	seguimiento: [
		"Seguimiento de la promesa: el pago no se reflejó; cliente pide unos días más.",
		"Seguimiento: la promesa no se cumplió; el cliente no tiene fondos todavía.",
	],
};

type EstadoContacto =
	| "contactado"
	| "no_contesta"
	| "numero_equivocado"
	| "promesa_pago"
	| "acuerdo_parcial"
	| "rechaza_pagar"
	| "mensaje_enviado";

type Contexto = {
	pool: Map<number, string>; // asesor cartera → user.id
	nombreUsuario: Map<string, string>;
	supervisores: { id: string; name: string }[];
	sistema: string;
	cobertura: {
		titular: string;
		suplente: string;
		desde: string;
		hasta: string;
	} | null;
};

type Simulacion = {
	contactos: Fila[];
	visitas: Fila[];
	refs: Fila[];
	hallazgos: Fila[];
	redes: Fila[];
	/** Día → hubo contacto (para la agenda). */
	contactadoEn: Set<string>;
	/** Promesas (día prometido → estado) para agenda y notificaciones. */
	promesas: {
		dia: string;
		estado: string;
		contactoId: string;
		usuario: string;
	}[];
	ultimoContacto: string | null;
};

function usuarioDelDia(ctx: Contexto, asesor: number | null, dia: string) {
	const u = asesor !== null ? (ctx.pool.get(asesor) ?? null) : null;
	if (
		u &&
		ctx.cobertura &&
		u === ctx.cobertura.titular &&
		dia >= ctx.cobertura.desde &&
		dia <= ctx.cobertura.hasta
	)
		return ctx.cobertura.suplente;
	return u;
}

function simularCredito(
	c: Credito,
	casoId: string,
	ficha: Fila | undefined,
	ctx: Contexto,
	rng: Rng,
	previo?: { ultimo: string | null; promesa: string | null },
): Simulacion {
	const sim: Simulacion = {
		contactos: [],
		visitas: [],
		refs: [],
		hallazgos: [],
		redes: [],
		contactadoEn: new Set(),
		promesas: [],
		ultimoContacto: null,
	};
	const telefono = (ficha?.phone as string | null) ?? null;
	const refsVentas = leerReferencias(ficha);
	// En modo incremental se sigue donde quedó: último contacto efectivo y
	// promesa vigente (la app no deja registrar otra mientras esa siga abierta).
	let promesa: { dia: string; contactoId: string } | null =
		previo?.promesa && previo.promesa >= INICIO
			? { dia: previo.promesa, contactoId: "" }
			: null;
	let ultimoDia: string | null = previo?.ultimo ?? null;
	if (previo?.ultimo) sim.contactadoEn.add(previo.ultimo);
	let gap = 1;
	const extrasHechos = new Set<string>();
	const desde = c.creado > INICIO ? c.creado : INICIO;

	const contacto = (
		dia: string,
		ts: string,
		usuario: string,
		b: number,
		metodo: string,
		estado: EstadoContacto | "promesa_pago",
		comentarios: string,
		extra: Fila = {},
	) => {
		const id = uuid();
		sim.contactos.push({
			id,
			caso_cobro_id: casoId,
			fecha_contacto: ts,
			metodo_contacto: metodo,
			estado_contacto: estado,
			duracion_llamada:
				metodo === "llamada" && estado !== "no_contesta"
					? rng.int(45, 420)
					: null,
			comentarios,
			requiere_seguimiento:
				estado === "no_contesta" || estado === "mensaje_enviado",
			realizado_por: usuario,
			created_at: ts,
			incluye_mora: false,
			bucket_snapshot: b,
			participante_tipo: "titular",
			direccion_contacto: "saliente",
			telefono_contactado:
				metodo === "llamada" || metodo === "whatsapp" ? telefono : null,
			...extra,
		});
		if (
			[
				"contactado",
				"acuerdo_parcial",
				"rechaza_pagar",
				"promesa_pago",
			].includes(estado)
		)
			sim.contactadoEn.add(dia);
		sim.ultimoContacto = dia;
		return id;
	};

	const registrarPromesa = (
		dia: string,
		ts: string,
		usuario: string,
		b: number,
		metodo: string,
		vencidas: Cuota[],
	) => {
		const oldest = vencidas[0];
		const rango = b >= 2 && rng.chance(0.6) ? vencidas : [oldest];
		let prometido: string;
		const pagoReal = oldest.pagadaDia;
		if (pagoReal && pagoReal > dia && habilesEntre(dia, pagoReal) <= 8)
			prometido = pagoReal;
		else prometido = sumarHabiles(dia, rng.int(2, 5));
		const cumplida = rango.every((q) => q.pagado);
		const vencio = ms(enGT(prometido, 0)) + 24 * 3600e3 <= AHORA.getTime();
		const estado = cumplida ? "cumplida" : vencio ? "incumplida" : "pendiente";
		const monto = q2(c.cuota * rango.length);
		const ini = Math.min(...rango.map((q) => q.n));
		const fin = Math.max(...rango.map((q) => q.n));
		const id = contacto(
			dia,
			ts,
			usuario,
			b,
			metodo,
			"promesa_pago",
			ini === fin
				? `Cliente se compromete a pagar la cuota ${ini} el ${fechaLegible(prometido)}.`
				: `Promesa de pago de las cuotas ${ini} a ${fin} (Q${monto.toFixed(2)}) para el ${fechaLegible(prometido)}.`,
			{
				cuota_inicio: ini,
				cuota_fin: fin,
				estado_promesa: estado,
				monto_comprometido: monto,
				fecha_proximo_contacto: enGT(prometido, 0),
				fecha_alerta: enGT(sumarDias(prometido, -1), 0),
				compromisos_pago: `Q${monto.toFixed(2)} el ${fechaLegible(prometido)}`,
				proximo_paso: `Verificar el pago el ${fechaLegible(prometido)}`,
				requiere_seguimiento: true,
				updated_at: ts,
			},
		);
		sim.promesas.push({ dia: prometido, estado, contactoId: id, usuario });
		promesa = { dia: prometido, contactoId: id };
	};

	for (const dia of dias(desde, HOY)) {
		const seg = segmentoEn(c, dia);
		if (!seg) continue;
		const b = seg.b;
		const usuario = usuarioDelDia(ctx, seg.asesor, dia);
		if (!usuario || !habil(dia)) continue;
		const finDia = dia === HOY ? CORTE_HOY : null;
		const ok = (ts: string) => ts > MIN_TS && (!finDia || ms(ts) <= ms(finDia));

		if (b === 0) {
			promesa = null;
			// B0: aviso el día que vence la cuota (cartera sana, recordatorio preventivo).
			if (c.cuotas.some((q) => q.fv === dia) && rng.chance(0.6)) {
				const ts = horaHabil(rng, dia);
				if (ok(ts))
					contacto(
						dia,
						ts,
						usuario,
						0,
						rng.chance(0.6) ? "whatsapp" : "llamada",
						"contactado",
						rng.pick(TXT.d0),
					);
			}
			continue;
		}
		const vencidas = cuotasVencidas(c, dia);
		if (vencidas.length === 0) continue;

		// Extras de B2+ una vez por tramo: visita, referencias, redes, supervisor.
		const claveTramo = `${seg.desde}:${b}`;
		const diasEnTramo = habilesEntre(seg.desde, dia);
		const tramoNuevo = !INCREMENTAL || seg.desde >= INICIO;
		if (
			b >= 2 &&
			tramoNuevo &&
			!extrasHechos.has(claveTramo) &&
			diasEnTramo >= rng.int(2, 4)
		) {
			extrasHechos.add(claveTramo);
			extrasDeTramo(
				c,
				casoId,
				ficha,
				refsVentas,
				dia,
				b,
				usuario,
				ctx,
				rng,
				sim,
				contacto,
				ok,
				(d, ts, u, bb, m, v) => registrarPromesa(d, ts, u, bb, m, v),
				() => promesa,
			);
		}

		if (promesa) {
			if (dia < promesa.dia) {
				if (sumarHabiles(dia, 1) === promesa.dia && rng.chance(0.45)) {
					const ts = horaHabil(rng, dia, 9);
					if (ok(ts))
						contacto(
							dia,
							ts,
							usuario,
							b,
							"whatsapp",
							"mensaje_enviado",
							rng.pick(TXT.recordatorioPromesa),
						);
				}
				continue;
			}
			if (dia === promesa.dia) {
				// El día de la promesa se confirma el pago con el cliente.
				const ts = horaHabil(rng, dia, 9);
				if (ok(ts) && rng.chance(0.75)) {
					const cumple =
						vencidas[0]?.pagadaDia !== null &&
						vencidas[0].pagadaDia <= sumarDias(dia, 1);
					if (cumple || rng.chance(0.55))
						contacto(
							dia,
							ts,
							usuario,
							b,
							rng.chance(0.6) ? "llamada" : "whatsapp",
							"contactado",
							cumple
								? "El cliente confirma que hoy realiza el pago prometido."
								: "El cliente pide uno o dos días más para completar el pago.",
						);
					else
						contacto(
							dia,
							ts,
							usuario,
							b,
							"llamada",
							"no_contesta",
							rng.pick(TXT.noContesta),
						);
				}
				continue;
			}
			// Venció la promesa y la cuota sigue vencida: seguimiento hoy.
			promesa = null;
			const ts = horaHabil(rng, dia, 8.5);
			if (ok(ts)) {
				const r = rng.pesos([
					["no_contesta", 0.4],
					["seguimiento", 0.35],
					["promesa", 0.25],
				] as const);
				if (r === "no_contesta")
					contacto(
						dia,
						ts,
						usuario,
						b,
						"llamada",
						"no_contesta",
						rng.pick(TXT.noContesta),
					);
				else if (r === "seguimiento")
					contacto(
						dia,
						ts,
						usuario,
						b,
						"llamada",
						"contactado",
						rng.pick(TXT.seguimiento),
					);
				else registrarPromesa(dia, ts, usuario, b, "llamada", vencidas);
				ultimoDia = dia;
				gap = gapDe(b, rng);
			}
			continue;
		}
		if (ultimoDia && habilesEntre(ultimoDia, dia) < gap) continue;

		// Intento del día.
		let ts = horaHabil(rng, dia);
		if (!ok(ts)) continue;
		const porLlamada = rng.chance(b === 1 ? 0.7 : 0.75);
		if (porLlamada) {
			let r: string = rng.pesos(
				b === 1
					? ([
							["no_contesta", 0.3],
							["contactado", 0.27],
							["promesa", 0.33],
							["equivocado", 0.02],
							["rechaza", 0.02],
							["parcial", 0.06],
						] as const)
					: b <= 3
						? ([
								["no_contesta", 0.35],
								["contactado", 0.25],
								["promesa", 0.22],
								["equivocado", 0.03],
								["rechaza", 0.08],
								["parcial", 0.07],
							] as const)
						: ([
								["no_contesta", 0.4],
								["contactado", 0.25],
								["promesa", 0.12],
								["equivocado", 0.03],
								["rechaza", 0.14],
								["parcial", 0.06],
							] as const),
			);
			// Promete quien de verdad va a pagar pronto; el resto casi siempre solo atiende.
			if (r === "promesa" && !pagaPronto(vencidas, dia) && rng.chance(0.55))
				r = "contactado";
			if (r === "promesa")
				registrarPromesa(dia, ts, usuario, b, "llamada", vencidas);
			else {
				const estado: EstadoContacto =
					r === "no_contesta"
						? "no_contesta"
						: r === "equivocado"
							? "numero_equivocado"
							: r === "rechaza"
								? "rechaza_pagar"
								: r === "parcial"
									? "acuerdo_parcial"
									: "contactado";
				const texto =
					r === "no_contesta"
						? TXT.noContesta
						: r === "equivocado"
							? TXT.equivocado
							: r === "rechaza"
								? TXT.rechaza
								: r === "parcial"
									? TXT.parcial
									: TXT.contactado;
				contacto(dia, ts, usuario, b, "llamada", estado, rng.pick(texto), {
					proximo_paso:
						estado === "no_contesta"
							? "Volver a llamar mañana"
							: estado === "rechaza_pagar"
								? "Escalar con el supervisor"
								: null,
				});
				// Si no contestó, casi siempre se le deja un WhatsApp.
				if (estado === "no_contesta" && rng.chance(0.6)) {
					ts = sumarMin(ts, rng.int(3, 40));
					if (ok(ts))
						contacto(
							dia,
							ts,
							usuario,
							b,
							"whatsapp",
							"mensaje_enviado",
							rng.pick(TXT.wspEnviado),
						);
				}
			}
		} else {
			let r: string = rng.pesos([
				["enviado", 0.5],
				["contactado", 0.32],
				["promesa", 0.18],
			] as const);
			if (r === "promesa" && !pagaPronto(vencidas, dia) && rng.chance(0.55))
				r = "contactado";
			if (r === "promesa")
				registrarPromesa(dia, ts, usuario, b, "whatsapp", vencidas);
			else if (r === "contactado")
				contacto(
					dia,
					ts,
					usuario,
					b,
					"whatsapp",
					"contactado",
					rng.pick(TXT.contactadoWsp),
				);
			else
				contacto(
					dia,
					ts,
					usuario,
					b,
					"whatsapp",
					"mensaje_enviado",
					rng.pick(TXT.wspEnviado),
				);
		}
		ultimoDia = dia;
		// Sin contacto efectivo hoy: la agenda lo vuelve a poner mañana y se reintenta.
		gap = sim.contactadoEn.has(dia) ? gapDe(b, rng) : rng.chance(0.8) ? 1 : 2;
	}
	return sim;
}

/** Días hábiles hasta el próximo intento tras un contacto efectivo: dentro del SLA del bucket. */
function gapDe(b: number, rng: Rng) {
	if (b <= 2) return rng.int(1, 3);
	return rng.int(1, 2);
}

/** ¿La cuota más vieja se pagó en los próximos 12 días hábiles? */
function pagaPronto(vencidas: Cuota[], dia: string) {
	const p = vencidas[0]?.pagadaDia;
	return !!p && p > dia && habilesEntre(dia, p) <= 12;
}

function leerReferencias(ficha: Fila | undefined) {
	if (!ficha?.refs || !ficha.sol_id) return [];
	try {
		const filas = JSON.parse(ficha.refs as string) as {
			nombre?: string;
			relacion?: string;
			telefono?: string;
		}[];
		return filas
			.map((f, indice) => ({
				key: `ventas_personal:${ficha.sol_id}:${indice}`,
				nombre: (f.nombre ?? "").trim(),
				relacion: (f.relacion ?? "").trim(),
				telefono: (f.telefono ?? "").replace(/\D/g, "").slice(0, 8),
			}))
			.filter((f) => f.nombre && f.telefono.length >= 8);
	} catch {
		return [];
	}
}

type FnContacto = (
	dia: string,
	ts: string,
	usuario: string,
	b: number,
	metodo: string,
	estado: EstadoContacto | "promesa_pago",
	comentarios: string,
	extra?: Fila,
) => string;

function extrasDeTramo(
	c: Credito,
	casoId: string,
	ficha: Fila | undefined,
	refsVentas: ReturnType<typeof leerReferencias>,
	dia: string,
	b: number,
	usuario: string,
	ctx: Contexto,
	rng: Rng,
	sim: Simulacion,
	contacto: FnContacto,
	ok: (ts: string) => boolean,
	promesaDesdeVisita: (
		dia: string,
		ts: string,
		u: string,
		b: number,
		m: string,
		v: Cuota[],
	) => void,
	hayPromesa: () => unknown,
) {
	const vencidas = cuotasVencidas(c, dia);
	// Referencias (las que vienen de la solicitud de ventas).
	if (refsVentas.length && rng.chance(b === 2 ? 0.55 : 0.75)) {
		for (const ref of refsVentas.slice(
			0,
			rng.int(1, Math.min(2, refsVentas.length)),
		)) {
			const ts = horaHabil(rng, dia, 9);
			if (!ok(ts)) continue;
			const resultado = rng.pesos([
				["dio_informacion", 0.3],
				["pasara_mensaje", 0.3],
				["no_contesta", 0.25],
				["sin_informacion", 0.1],
				["numero_equivocado", 0.05],
			] as const);
			const id = uuid();
			sim.refs.push({
				id,
				caso_cobro_id: casoId,
				referencia_key: ref.key,
				referencia_origen: "ventas_personal",
				referencia_nombre: ref.nombre,
				telefono: ref.telefono,
				metodo_contacto: "llamada",
				resultado,
				comentarios:
					resultado === "dio_informacion"
						? "La referencia confirmó que el cliente sigue viviendo en la misma dirección y dio un número nuevo."
						: resultado === "pasara_mensaje"
							? "La referencia le pasará el mensaje al cliente."
							: resultado === "no_contesta"
								? "La referencia no contestó."
								: resultado === "sin_informacion"
									? "La referencia no tiene contacto reciente con el cliente."
									: "El número de la referencia no corresponde.",
				realizado_por: usuario,
				fecha_contacto: ts,
				created_at: ts,
			});
			if (resultado === "dio_informacion" && rng.chance(0.6)) {
				const tel = rng.chance(0.6);
				sim.hallazgos.push({
					id: uuid(),
					caso_cobro_id: casoId,
					contacto_referencia_id: id,
					tipo: tel ? "telefono" : "direccion",
					valor: tel ? `5${rng.int(1000000, 9999999)}` : rng.pick(ZONAS),
					enlace_mapa: null,
					notas: tel
						? "Número nuevo que dio la referencia."
						: "Dirección donde estaría viviendo ahora.",
					registrado_por: usuario,
					created_at: sumarMin(ts, 2),
				});
			}
		}
	}
	// Investigación en redes (B2–B3).
	if (b <= 3 && rng.chance(0.35)) {
		const ts = horaHabil(rng, dia, 9);
		if (ok(ts)) {
			const con = rng.chance(0.5);
			sim.redes.push({
				id: uuid(),
				caso_cobro_id: casoId,
				fuente: rng.pesos([
					["facebook", 0.55],
					["instagram", 0.2],
					["tiktok", 0.1],
					["linkedin", 0.1],
					["google", 0.05],
				] as const),
				fuente_otra: null,
				enlace_perfil: null,
				resultado: con ? "con_hallazgos" : "sin_hallazgos",
				hallazgos: con
					? rng.pick([
							"Publica fotos recientes con el vehículo; aparece activo en su negocio.",
							"Perfil activo; indica que trabaja en una empresa de la zona 4.",
							"Publicó que se mudó a Villa Nueva hace dos meses.",
						])
					: "No se encontró un perfil que coincida con el nombre y la fotografía del cliente.",
				fecha_investigacion: ts,
				bucket_snapshot: b,
				registrada_por: usuario,
				created_at: ts,
			});
		}
	}
	// Llamada del supervisor en B3.
	if (b === 3 && rng.chance(0.4) && ctx.supervisores.length) {
		const ts = horaHabil(rng, dia, 10);
		if (ok(ts))
			contacto(
				dia,
				ts,
				rng.pick(ctx.supervisores).id,
				b,
				"llamada",
				"contactado",
				rng.pick(TXT.supervisor),
			);
	}
	// Visita a la residencia (y al trabajo en B3+).
	const pVisita = b === 2 ? 0.5 : b === 3 ? 0.7 : b === 4 ? 0.8 : 0.3;
	if (rng.chance(pVisita)) {
		visita("residencia");
		if (b >= 3 && rng.chance(0.4)) visita("trabajo");
	}

	function visita(tipo: "residencia" | "trabajo") {
		const programada = sumarHabiles(dia, rng.int(0, 2));
		const direccion =
			(tipo === "residencia"
				? (ficha?.direccion_residencia as string) ||
					(ficha?.direccion as string)
				: (ficha?.direccion_trabajo as string)) || rng.pick(ZONAS);
		const empresa =
			tipo === "trabajo"
				? (ficha?.empresa as string) || "Lugar de trabajo registrado"
				: null;
		const lat = 14.6 + (rng.f() - 0.5) * 0.12;
		const lng = -90.53 + (rng.f() - 0.5) * 0.12;
		const progTs = enGT(programada, 6, 0);
		const creada = horaHabil(rng, dia, 8);
		const base = {
			id: uuid(),
			caso_cobro_id: casoId,
			tipo,
			direccion,
			referencia:
				tipo === "residencia" ? "Casa de dos niveles, portón negro" : null,
			empresa,
			responsable_id: usuario,
			fecha_programada: progTs,
			notas_programacion:
				"Visita para conocer la situación del cliente y negociar el pago.",
			programada_por: usuario,
			created_at: ok(creada) ? creada : CORTE_HOY,
		};
		const fechaVisita = horaHabil(rng, programada, 9.5);
		if (programada > HOY || !ok(fechaVisita)) {
			// Sigue programada (próximos días).
			if (segmentoEn(c, HOY)?.b === b)
				sim.visitas.push({
					...base,
					estado: "programada",
					updated_at: base.created_at,
				});
			return;
		}
		const pagoPronto =
			vencidas[0]?.pagadaDia &&
			habilesEntre(programada, vencidas[0].pagadaDia) <= 2 &&
			vencidas[0].pagadaDia >= programada;
		const resultado = pagoPronto
			? "pago"
			: rng.pesos([
					["sin_contacto", 0.35],
					["promesa", 0.4],
					["pago_parcial_promesa", 0.12],
					["convenio", b >= 2 ? 0.08 : 0],
					["entrega_voluntaria", b >= 4 ? 0.05 : 0],
				] as const);
		const estadoContacto: EstadoContacto =
			resultado === "pago_parcial_promesa"
				? "acuerdo_parcial"
				: resultado === "sin_contacto"
					? "no_contesta"
					: "contactado";
		const comentarios =
			resultado === "sin_contacto"
				? "Se visitó la dirección registrada; no se encontró al cliente. Se dejó aviso con un familiar."
				: resultado === "pago"
					? "El cliente atendió la visita y confirmó el pago de la cuota vencida."
					: resultado === "promesa"
						? "El cliente atendió la visita; se comprometió a pagar en los próximos días."
						: resultado === "pago_parcial_promesa"
							? "El cliente entregó un abono parcial y se comprometió a completar el pago."
							: resultado === "convenio"
								? "El cliente pide un convenio de pago; se le explicaron los requisitos."
								: "El cliente manifestó que quiere entregar el vehículo.";
		const contactoId = contacto(
			programada,
			fechaVisita,
			usuario,
			b,
			tipo === "residencia" ? "visita_domicilio" : "visita_trabajo",
			estadoContacto,
			comentarios,
		);
		let promesaId: string | null = null;
		if (
			(resultado === "promesa" || resultado === "pago_parcial_promesa") &&
			!hayPromesa()
		) {
			const v = cuotasVencidas(c, programada);
			if (v.length) {
				const antes = sim.contactos.length;
				promesaDesdeVisita(
					programada,
					sumarMin(fechaVisita, 5),
					usuario,
					b,
					tipo === "residencia" ? "visita_domicilio" : "visita_trabajo",
					v,
				);
				if (sim.contactos.length > antes)
					promesaId = sim.contactos[sim.contactos.length - 1].id as string;
			}
		}
		sim.visitas.push({
			...base,
			estado: "realizada",
			fecha_visita: fechaVisita,
			resultado,
			motivo_sin_contacto:
				resultado === "sin_contacto"
					? rng.pick(["no_estaba", "no_atendieron", "no_estaba"])
					: null,
			monto_recibido:
				resultado === "pago"
					? q2(c.cuota)
					: resultado === "pago_parcial_promesa"
						? q2(c.cuota * 0.4)
						: null,
			comentarios,
			proximo_paso:
				resultado === "sin_contacto"
					? "Volver a visitar en horario de la tarde"
					: "Confirmar el pago acordado",
			ubicacion_lat: Number(lat.toFixed(7)),
			ubicacion_lng: Number(lng.toFixed(7)),
			ubicacion_precision_m: rng.int(8, 40),
			registrada_por: usuario,
			contacto_cobro_id: contactoId,
			promesa_contacto_id: promesaId,
			updated_at: fechaVisita,
		});
	}
}

// ─── Programa principal ───────────────────────────────────────────────────

async function sembrar() {
	const datos = await cargar();
	INCREMENTAL = datos.yaSembrado;
	const diasVentana = DIAS_ARG ? Number(DIAS_ARG) : INCREMENTAL ? 1 : 90;
	INICIO = sumarDias(HOY, -diasVentana);
	if (INCREMENTAL) {
		const r = (await sql.unsafe(
			`SELECT to_char(max(c.fecha_contacto), 'YYYY-MM-DD HH24:MI:SS') t
			 FROM public.contactos_cobros c
			 JOIN public.seed_demo_filas f ON f.tabla = 'public.contactos_cobros' AND f.pk::uuid = c.id`,
		)) as { t: string | null }[];
		MIN_TS = r[0]?.t ?? MIN_TS;
	}
	console.log(
		`Seed demo COBROS-02 · corrida ${CORRIDA} · ${INCREMENTAL ? `INCREMENTAL (sigue después de ${MIN_TS} UTC)` : "PRIMERA SIEMBRA"} · ventana ${INICIO} → ${HOY} · ${DRY ? "DRY-RUN" : "ESCRITURA"}`,
	);
	const poolPorBucket = new Map<number, number[]>();
	const userPorAsesor = new Map<number, string>();
	const nombreUsuario = new Map<string, string>();
	for (const p of datos.pool) {
		const lista = poolPorBucket.get(p.b as number) ?? [];
		lista.push(p.asesor as number);
		poolPorBucket.set(p.b as number, lista);
		if (p.user_id) {
			userPorAsesor.set(p.asesor as number, p.user_id as string);
			nombreUsuario.set(p.user_id as string, p.nombre as string);
		}
	}
	for (const s of datos.supervisores) nombreUsuario.set(s.id, s.name);
	const bucketNombre = new Map(
		datos.buckets.map((b) => [b.b, `${b.prefijo} · ${b.nombre}`]),
	);
	const slaDe = new Map(datos.buckets.map((b) => [b.b, b.sla || 3]));

	// Cobertura por vacaciones: el asesor de B1 se fue una semana y lo cubrió uno de B2.
	const titular = userPorAsesor.get(poolPorBucket.get(1)?.[0] ?? -1);
	const suplente = userPorAsesor.get(poolPorBucket.get(2)?.[0] ?? -1);
	let lunes = sumarDias(HOY, -18);
	while (diaSemana(lunes) !== 1) lunes = sumarDias(lunes, 1);
	const cobertura =
		titular && suplente && !INCREMENTAL
			? { titular, suplente, desde: lunes, hasta: sumarDias(lunes, 4) }
			: null;
	const ctx: Contexto = {
		pool: userPorAsesor,
		nombreUsuario,
		supervisores: datos.supervisores,
		sistema: datos.sistema,
		cobertura,
	};

	// 1. Vida del crédito.
	const reconstruir: Credito[] = [];
	const historiaBH: Fila[] = [];
	const historiaCAH: Fila[] = [];
	for (const c of datos.creditos) {
		if (c.bucketActual === null) continue; // fuera del motor (sin historia)
		// Primera siembra: la vida completa de los CRM-. Incremental: la historia
		// ya existe (y el motor la sigue escribiendo); solo hace falta saber en qué
		// bucket estaba cada día, con margen para reconocer tramos ya empezados.
		const desde = INCREMENTAL
			? sumarDias(INICIO, -120)
			: c.esCrm
				? c.creado < INICIO
					? c.creado
					: INICIO
				: INICIO;
		c.segmentos = armarSegmentos(c, desde, poolPorBucket);
		if (c.intocable || INCREMENTAL) continue;
		reconstruir.push(c);
		const { bh, cah } = historiaDeCartera(c, rngDe(c.id));
		historiaBH.push(...bh);
		historiaCAH.push(...cah);
	}

	// 2. Casos que falten (solo créditos CRM-) y gestiones.
	const casoPorSifco = new Map(datos.casos.map((k) => [k.sifco, k.id]));
	const fichaPorSifco = new Map(
		datos.fichas.map((f) => [f.sifco as string, f]),
	);
	const contratoPorSifco = new Map(
		datos.referencias.map((r) => [r.sifco, r.contrato]),
	);
	const casosNuevos: Fila[] = [];
	const crm = datos.creditos.filter((c) => c.esCrm && c.segmentos.length);
	for (const c of crm) {
		if (casoPorSifco.has(c.sifco)) continue;
		const f = fichaPorSifco.get(c.sifco);
		const cuotasAtr = atrasadas(c, HOY);
		const id = uuid();
		casosNuevos.push({
			id,
			contrato_id: contratoPorSifco.get(c.sifco) ?? null,
			numero_credito_sifco: c.sifco,
			estado_mora:
				["al_dia", "mora_30", "mora_60", "mora_90", "mora_120"][cuotasAtr] ??
				"mora_120_plus",
			monto_en_mora: q2(c.mora),
			dias_mora_maximo: cuotasAtr
				? Math.max(
						0,
						Math.round(
							(ms(enGT(HOY, 0)) - ms(enGT(cuotasVencidas(c, HOY)[0].fv, 0))) /
								86400e3,
						),
					)
				: 0,
			cuotas_vencidas: cuotasAtr,
			telefono_principal: (f?.phone as string) || "00000000",
			email_contacto: (f?.email as string) || "sin-email@example.com",
			direccion_contacto: (f?.direccion as string) || "Sin dirección",
			activo: true,
			etiquetas: [],
			created_at: fmtUtc(AHORA),
			updated_at: fmtUtc(AHORA),
		});
		casoPorSifco.set(c.sifco, id);
	}

	const previos = new Map<
		string,
		{ ultimo: string | null; promesa: string | null }
	>();
	if (INCREMENTAL) {
		const filas = (await sql.unsafe(
			`SELECT caso_cobro_id::text caso,
			        max((fecha_contacto - interval '6 hours')::date) FILTER (
			          WHERE estado_contacto IN ('contactado','acuerdo_parcial','rechaza_pagar','promesa_pago'))::text ultimo,
			        max((fecha_proximo_contacto - interval '6 hours')::date) FILTER (
			          WHERE estado_contacto = 'promesa_pago' AND coalesce(estado_promesa::text, 'pendiente') = 'pendiente')::text promesa
			 FROM public.contactos_cobros
			 WHERE caso_cobro_id = ANY($1::text::uuid[])
			 GROUP BY 1`,
			[arrTxt([...casoPorSifco.values()])],
		)) as { caso: string; ultimo: string | null; promesa: string | null }[];
		for (const f of filas) previos.set(f.caso, f);
	}
	const sims = new Map<number, Simulacion>();
	for (const c of crm) {
		const casoId = casoPorSifco.get(c.sifco);
		if (!casoId) continue;
		// La semilla incluye el día de inicio: cada corrida incremental sortea distinto.
		const semillaCredito = INCREMENTAL
			? c.id * 31 + Number(INICIO.replaceAll("-", ""))
			: c.id + 1;
		sims.set(
			c.id,
			simularCredito(
				c,
				casoId,
				fichaPorSifco.get(c.sifco),
				ctx,
				rngDe(semillaCredito),
				previos.get(casoId),
			),
		);
	}
	const contactos = [...sims.values()].flatMap((s) => s.contactos);
	const visitas = [...sims.values()].flatMap((s) => s.visitas);
	const refs = [...sims.values()].flatMap((s) => s.refs);
	const hallazgos = [...sims.values()].flatMap((s) => s.hallazgos);
	const redes = [...sims.values()].flatMap((s) => s.redes);

	// Solicitudes de B3/B4/B5 sobre la foto ACTUAL (lo que la bandeja muestra hoy).
	const rng = rngDe(-1);
	const actual = (c: Credito) => c.segmentos[c.segmentos.length - 1]?.b ?? 0;
	const enMora = crm.filter(
		(c) =>
			["MOROSO", "PENDIENTE_CANCELACION"].includes(c.st) &&
			casoPorSifco.has(c.sifco),
	);
	const dueno = (c: Credito) =>
		userPorAsesor.get(c.asesorId ?? -1) ?? ctx.sistema;
	const recuperaciones: Fila[] = [];
	const inmovilizaciones: Fila[] = [];
	const eventosInm: Fila[] = [];
	const gpsEventos: Fila[] = [];
	const juridico: Fila[] = [];
	const rebajas: Fila[] = [];
	const supervisorDe = () => rng.pick(datos.supervisores).id;

	// Las solicitudes (bandeja) y los eventos GPS solo se siembran la primera vez:
	// en modo incremental ya existen y tienen restricciones de "una abierta por caso".
	const soloPrimera = <T>(xs: T[]) => (INCREMENTAL ? [] : xs);
	const b4 = soloPrimera(
		enMora.filter((c) => actual(c) >= 4 && actual(c) <= 4),
	);
	const b3 = soloPrimera(enMora.filter((c) => actual(c) === 3));
	const b23 = soloPrimera(
		enMora.filter((c) => actual(c) === 2 || actual(c) === 3),
	);
	const b5 = soloPrimera(
		enMora.filter((c) => actual(c) === 5 && c.st === "MOROSO"),
	);
	const conGps = (c: Credito) => fichaPorSifco.get(c.sifco)?.wialon != null;

	const checklist = (c: Credito) => {
		const s = sims.get(c.id);
		const cs = s?.contactos ?? [];
		const llamadas = cs.filter((x) => x.metodo_contacto === "llamada");
		const mensajes = cs.filter((x) => x.metodo_contacto === "whatsapp");
		const promesas = cs.filter((x) => x.estado_contacto === "promesa_pago");
		const visRes = (s?.visitas ?? []).filter(
			(v) => v.tipo === "residencia" && v.estado === "realizada",
		);
		const visTra = (s?.visitas ?? []).filter(
			(v) => v.tipo === "trabajo" && v.estado === "realizada",
		);
		const dia = (ts: unknown) => fechaLegible(String(ts).slice(0, 10));
		const ult = (xs: Fila[], k: string) =>
			xs
				.map((x) => String(x[k]))
				.sort()
				.at(-1);
		const paso = (
			paso: string,
			titulo: string,
			hecho: boolean,
			evidencia: string,
			just?: [string, string],
		) => ({
			paso,
			titulo,
			estado: hecho ? "hecho" : "pendiente",
			evidencia,
			justificacion: hecho ? null : (just?.[0] ?? "otro"),
			justificacionEtiqueta: hecho ? null : (just?.[1] ?? "Otro motivo"),
			nota: null,
		});
		return [
			paso(
				"llamadas_cliente",
				"Llamadas al cliente",
				llamadas.length > 0,
				llamadas.length
					? `${llamadas.length} llamadas, la última el ${dia(ult(llamadas, "fecha_contacto"))}.`
					: "Ninguna llamada registrada.",
				[
					"numeros_invalidos",
					"Los números registrados no existen o están fuera de servicio",
				],
			),
			paso(
				"mensajes",
				"WhatsApp, SMS o correo",
				mensajes.length > 0,
				mensajes.length
					? `${mensajes.length} mensajes, el último el ${dia(ult(mensajes, "fecha_contacto"))}.`
					: "Ningún mensaje registrado.",
				["cliente_bloqueo", "El cliente bloqueó los números de la empresa"],
			),
			paso(
				"promesa_pago",
				"Promesa de pago",
				promesas.length > 0,
				promesas.length
					? `${promesas.length} promesas, la última el ${dia(ult(promesas, "fecha_contacto"))}.`
					: "No hay promesas de pago.",
				["cliente_se_niega", "El cliente manifestó que no pagará"],
			),
			paso(
				"convenio_pago",
				"Convenio de pago",
				false,
				"No hay convenios generados.",
				["cliente_rechaza", "El cliente rechazó la propuesta de convenio"],
			),
			paso(
				"referencias",
				"Referencias y contactos de emergencia",
				(s?.refs.length ?? 0) > 0,
				s?.refs.length
					? `${s.refs.length} gestiones con referencias.`
					: "Ninguna referencia gestionada.",
				["no_contestan", "Las referencias no contestan"],
			),
			paso(
				"visita_residencia",
				"Visita a la residencia",
				visRes.length > 0,
				visRes.length
					? `Visita realizada el ${dia(visRes[0].fecha_visita)}.`
					: "Sin visita a la residencia.",
				["otro", "Otro motivo"],
			),
			paso(
				"visita_trabajo",
				"Visita al lugar de trabajo",
				visTra.length > 0,
				visTra.length
					? `Visita realizada el ${dia(visTra[0].fecha_visita)}.`
					: "Sin visita al lugar de trabajo.",
				["otro", "Otro motivo"],
			),
			paso(
				"ubicacion_gps",
				"Ubicación del vehículo por GPS",
				conGps(c),
				conGps(c)
					? "Consultada 3 veces, la última hace dos días."
					: "El vehículo no tiene GPS vinculado.",
				["otro", "Otro motivo"],
			),
			paso(
				"apagado_unidad",
				"Apagado de la unidad",
				false,
				"No se ha pedido el apagado.",
				["otro", "Otro motivo"],
			),
		];
	};

	const saldoSnapshot = (c: Credito) => {
		const v = cuotasVencidas(c, HOY);
		return {
			saldo_pendiente: q2(c.deuda),
			cuotas_vencidas: v.length,
			monto_vencido: q2(c.cuota * v.length),
			monto_mora: q2(c.mora),
			total_para_ponerse_al_dia: q2(c.cuota * v.length + c.mora),
			saldo_tomado_at: fmtUtc(AHORA),
		};
	};

	// Recuperaciones: 2 pendientes (bandeja) y 1 rechazada de historial.
	const candidatosRec = [...b4, ...b3.filter(conGps)].slice(0, 3);
	candidatosRec.forEach((c, i) => {
		const casoId = casoPorSifco.get(c.sifco)!;
		const f = fichaPorSifco.get(c.sifco);
		const creada = enGT(sumarHabiles(sumarDias(HOY, -6), i), 10, 15 + i * 7);
		const tomado = i !== 1;
		recuperaciones.push({
			id: uuid(),
			caso_cobro_id: casoId,
			tipo_recuperacion: tomado ? "tomado" : "entrega_voluntaria",
			motivos: tomado
				? [
						"atrasos_constantes",
						"promesas_incumplidas",
						...(conGps(c) ? ["riesgo_ocultamiento"] : []),
					]
				: ["no_puede_pagar", "bajaron_ingresos"],
			motivo_detalle: tomado
				? "El cliente acumula cuatro cuotas vencidas, incumplió las promesas y dejó de contestar."
				: "El cliente informa que ya no puede pagar y quiere entregar el vehículo.",
			trasladado: false,
			bucket_origen: actual(c),
			ubicacion_direccion: (f?.direccion as string) || rng.pick(ZONAS),
			ubicacion_fuente: conGps(c) ? "gps" : "manual",
			gps_unidad: conGps(c) ? String(f?.wialon) : null,
			estado_vehiculo: "regular",
			documentos: [],
			...saldoSnapshot(c),
			registrado_por: dueno(c),
			responsable_recuperacion: dueno(c),
			estado_solicitud: i === 2 ? "rechazada" : "pendiente",
			checklist: checklist(c),
			decidido_por: i === 2 ? supervisorDe() : null,
			decidido_at: i === 2 ? sumarMin(creada, 26 * 60) : null,
			motivo_decision:
				i === 2
					? "Antes de recuperar, agote la visita al lugar de trabajo y el apagado de la unidad."
					: null,
			created_at: creada,
			updated_at: creada,
		});
	});

	// Apagados: 1 pendiente de aprobación y 1 ejecutado con su reactivación.
	const candidatosInm = soloPrimera(
		enMora.filter((c) => actual(c) >= 3 && conGps(c)),
	).slice(0, 2);
	candidatosInm.forEach((c, i) => {
		const casoId = casoPorSifco.get(c.sifco)!;
		const f = fichaPorSifco.get(c.sifco)!;
		const sol = dueno(c);
		const t0 = enGT(sumarHabiles(sumarDias(HOY, -9), i * 3), 9, 40);
		const base = {
			caso_cobro_id: casoId,
			numero_credito_sifco: c.sifco,
			vehicle_id: f.vehicle_id,
			wialon_unit_id: f.wialon,
			bucket_snapshot: actual(c),
			solicitado_por: sol,
			modo_ejecucion: "manual",
		};
		const ubic = {
			fuente: "gps",
			lat: 14.62,
			lng: -90.51,
			direccion: rng.pick(ZONAS),
		};
		if (i === 0) {
			const id = uuid();
			const t = enGT(
				HOY > sumarDias(HOY, 0) ? HOY : sumarHabiles(sumarDias(HOY, -2), 1),
				11,
				5,
			);
			inmovilizaciones.push({
				id,
				...base,
				accion: "apagado",
				estado: "pendiente_aprobacion",
				motivo:
					"Promesas incumplidas, Riesgo de ocultamiento — dejó de contestar y el GPS lo ubica fuera de su zona habitual",
				motivos: ["promesas_incumplidas", "riesgo_ocultamiento"],
				motivo_detalle:
					"Dejó de contestar y el GPS lo ubica fuera de su zona habitual.",
				ubicacion_solicitud: ubic,
				solicitado_at: t,
				created_at: t,
				updated_at: t,
			});
			eventosInm.push({
				id: uuid(),
				inmovilizacion_id: id,
				evento: "solicitar",
				estado_anterior: null,
				estado_nuevo: "pendiente_aprobacion",
				usuario_id: sol,
				detalle: null,
				created_at: t,
			});
		} else {
			const sup = supervisorDe();
			const idA = uuid();
			const aprob = sumarMin(t0, 50);
			const ejec = sumarMin(t0, 140);
			inmovilizaciones.push({
				id: idA,
				...base,
				accion: "apagado",
				estado: "ejecutada",
				motivo: "Atrasos constantes — cuatro cuotas vencidas sin respuesta",
				motivos: ["atrasos_constantes"],
				motivo_detalle: "Cuatro cuotas vencidas sin respuesta.",
				decidido_por: sup,
				decidido_at: aprob,
				nota_decision: "Aprobado: se agotaron llamadas y visita.",
				ejecutado_por: sup,
				ejecutado_at: ejec,
				referencia_ejecucion: "Apagado confirmado por el proveedor de GPS",
				ubicacion_solicitud: ubic,
				ubicacion_ejecucion: ubic,
				resultado: "reactivada",
				solicitado_at: t0,
				created_at: t0,
				updated_at: ejec,
			});
			const t1 = sumarMin(t0, 2 * 24 * 60 + 90);
			const idR = uuid();
			inmovilizaciones.push({
				id: idR,
				...base,
				accion: "reactivacion",
				estado: "ejecutada",
				motivo:
					"Pago parcial + promesa — abonó una cuota y se comprometió a pagar el resto",
				motivos: null,
				que_paso: "pago_parcial_promesa",
				respaldo_reactivacion: {
					promesa: { fecha: sumarDias(String(t1).slice(0, 10), 5) },
				},
				inmovilizacion_origen_id: idA,
				decidido_por: sup,
				decidido_at: sumarMin(t1, 20),
				ejecutado_por: sup,
				ejecutado_at: sumarMin(t1, 45),
				solicitado_at: t1,
				created_at: t1,
				updated_at: sumarMin(t1, 45),
			});
			eventosInm.push(
				{
					id: uuid(),
					inmovilizacion_id: idA,
					evento: "solicitar",
					estado_anterior: null,
					estado_nuevo: "pendiente_aprobacion",
					usuario_id: sol,
					detalle: null,
					created_at: t0,
				},
				{
					id: uuid(),
					inmovilizacion_id: idA,
					evento: "aprobar",
					estado_anterior: "pendiente_aprobacion",
					estado_nuevo: "aprobada",
					usuario_id: sup,
					detalle: null,
					created_at: aprob,
				},
				{
					id: uuid(),
					inmovilizacion_id: idA,
					evento: "marcar_ejecutada",
					estado_anterior: "aprobada",
					estado_nuevo: "ejecutada",
					usuario_id: sup,
					detalle: null,
					created_at: ejec,
				},
				{
					id: uuid(),
					inmovilizacion_id: idR,
					evento: "solicitar",
					estado_anterior: null,
					estado_nuevo: "pendiente_aprobacion",
					usuario_id: sol,
					detalle: null,
					created_at: t1,
				},
				{
					id: uuid(),
					inmovilizacion_id: idR,
					evento: "aprobar",
					estado_anterior: "pendiente_aprobacion",
					estado_nuevo: "aprobada",
					usuario_id: sup,
					detalle: null,
					created_at: sumarMin(t1, 20),
				},
				{
					id: uuid(),
					inmovilizacion_id: idR,
					evento: "marcar_ejecutada",
					estado_anterior: "aprobada",
					estado_nuevo: "ejecutada",
					usuario_id: sup,
					detalle: null,
					created_at: sumarMin(t1, 45),
				},
			);
		}
	});

	// Eventos GPS de los créditos de B3+ con unidad vinculada.
	for (const c of soloPrimera(
		enMora.filter((x) => actual(x) >= 3 && conGps(x)),
	).slice(0, 8)) {
		const f = fichaPorSifco.get(c.sifco)!;
		const r = rngDe(c.id + 7);
		for (let k = 0; k < r.int(2, 5); k++) {
			const dia = sumarDias(HOY, -r.int(1, 20));
			const ts = enGT(dia, r.int(6, 21), r.int(0, 59), r.int(0, 59));
			const tipo = r.pesos([
				["ignicion", 0.5],
				["desconexion_energia", 0.3],
				["sin_reportar", 0.2],
			] as const);
			gpsEventos.push({
				id: uuid(),
				tipo,
				wialon_unit_id: f.wialon,
				vehicle_id: f.vehicle_id,
				caso_cobro_id: casoPorSifco.get(c.sifco),
				ocurrido_at: ts,
				recibido_at: sumarMin(ts, 3),
				lat: 14.6 + (r.f() - 0.5) * 0.1,
				lon: -90.53 + (r.f() - 0.5) * 0.1,
				velocidad_kmh: tipo === "ignicion" ? r.int(0, 60) : 0,
				payload: { origen: "seed-demo" },
				notificado: true,
				dedup_key: `seed-demo:${c.id}:${k}`,
				created_at: sumarMin(ts, 3),
			});
		}
	}

	// Jurídico (B5) y rebaja de mora (B2–B3): solo cuentan en los KPI del supervisor.
	for (const c of b5.slice(0, 2)) {
		const t = enGT(sumarHabiles(sumarDias(HOY, -4), 1), 11, 20);
		juridico.push({
			id: uuid(),
			caso_cobro_id: casoPorSifco.get(c.sifco),
			numero_credito_sifco: c.sifco,
			bucket_snapshot: 5,
			motivo: rng.pick(["no_contacto", "no_quiere_pagar"]),
			nota_juridico:
				"Se agotó la gestión de cobro: llamadas, visitas y referencias sin resultado.",
			estado: "pendiente",
			solicitado_por: dueno(c),
			solicitado_en: t,
		});
	}
	for (const c of b23.filter((x) => x.mora > 50).slice(0, 2)) {
		const t = enGT(sumarHabiles(sumarDias(HOY, -3), 1), 15, 10);
		rebajas.push({
			id: uuid(),
			caso_cobro_id: casoPorSifco.get(c.sifco),
			numero_credito_sifco: c.sifco,
			mora_snapshot: q2(c.mora),
			monto_solicitado: q2(c.mora * 0.5),
			notas:
				"El cliente se pone al día con las cuotas si se le rebaja la mitad de la mora.",
			estado: "pendiente",
			solicitado_por: dueno(c),
			solicitado_en: t,
		});
	}

	// 3a. Cierre diario (días cerrados; hoy lo calcula la app en vivo).
	const cierre: Fila[] = [];
	const contactoCaso = new Map<string, string>(); // caso → sifco
	for (const c of crm) {
		const k = casoPorSifco.get(c.sifco);
		if (k) contactoCaso.set(k, c.sifco);
	}
	for (const x of contactos) {
		const dia = diaGT(new Date(ms(x.fecha_contacto as string)));
		if (dia >= HOY) continue;
		cierre.push({
			id: uuid(),
			fecha: dia,
			asesor_id: x.realizado_por,
			tipo: "contacto",
			caso_cobro_id: x.caso_cobro_id,
			numero_credito_sifco: contactoCaso.get(x.caso_cobro_id as string),
			contacto_id: x.id,
			estado_contacto: x.estado_contacto,
			es_efectivo_manual: [
				"contactado",
				"acuerdo_parcial",
				"rechaza_pagar",
			].includes(x.estado_contacto as string),
			fecha_contacto: x.fecha_contacto,
			generado_en: enGT(sumarDias(dia, 1), 0, 15),
		});
	}
	// Subidas/bajadas: solo la primera vez. Después las cierra el job
	// (CIERRE_DIARIO_ENABLED) con la historia real que escribe el motor.
	const todosConSegmentos = INCREMENTAL
		? []
		: datos.creditos.filter((c) => c.segmentos.length);
	for (const c of todosConSegmentos) {
		c.segmentos.forEach((s, i) => {
			if (i === 0 || s.desde < INICIO || s.desde >= HOY) return;
			const previo = c.segmentos[i - 1];
			// Dueño de la mañana: el del tramo anterior.
			const asesorUser =
				previo.asesor !== null ? userPorAsesor.get(previo.asesor) : undefined;
			if (!asesorUser) return;
			cierre.push({
				id: uuid(),
				fecha: s.desde,
				asesor_id: asesorUser,
				tipo: s.b > previo.b ? "subida" : "bajada",
				caso_cobro_id: casoPorSifco.get(c.sifco) ?? null,
				numero_credito_sifco: c.sifco,
				bucket_anterior: previo.b,
				bucket: s.b,
				es_efectivo_manual: false,
				generado_en: enGT(sumarDias(s.desde, 1), 0, 15),
			});
		});
	}

	// 3b. Metas del mes (agosto a octubre) a partir de lo recuperado de verdad.
	const recuperado = (await sql.unsafe(
		`SELECT c.asesor_id::int asesor, to_char(p.fecha_pago, 'YYYY-MM') mes,
		        sum(coalesce(p.abono_capital,0)+coalesce(p.abono_interes,0)+coalesce(p.abono_iva_12,0)
		            +coalesce(p.abono_seguro,0)+coalesce(p.abono_gps,0)+coalesce(p.membresias_pago,0)+coalesce(p.mora,0))::float8 monto
		 FROM ${CS}.pagos_credito p JOIN ${CS}.creditos c USING (credito_id)
		 WHERE p.fecha_vencimiento < p.fecha_pago::date AND NOT coalesce(p."paymentFalse", false)
		   AND p.validation_status::text IN ('validated','pending','no_required')
		   AND p.fecha_pago >= $1::date
		 GROUP BY 1, 2`,
		[sumarDias(HOY, -75).slice(0, 7) + "-01"],
	)) as { asesor: number; mes: string; monto: number }[];
	const metas: Fila[] = [];
	const meses = [
		...new Set(
			[sumarDias(HOY, -62), sumarDias(HOY, -31), HOY].map((d) => d.slice(0, 7)),
		),
	];
	for (const asesor of userPorAsesor.keys()) {
		const base =
			Math.max(
				...recuperado.filter((r) => r.asesor === asesor).map((r) => r.monto),
				0,
			) || 15000;
		meses.forEach((mes, i) => {
			metas.push({
				id: uuid(),
				asesor_id: asesor,
				anio: Number(mes.slice(0, 4)),
				mes: Number(mes.slice(5, 7)),
				monto_recuperacion: Math.max(
					5000,
					Math.round((base * (1.05 + 0.05 * i)) / 1000) * 1000,
				),
				actualizado_por: datos.supervisores[0]?.id ?? ctx.sistema,
				created_at: enGT(`${mes}-01`, 9),
				updated_at: enGT(`${mes}-01`, 9),
			});
		});
	}

	// 3c. Cobertura.
	const coberturas: Fila[] = cobertura
		? [
				{
					id: uuid(),
					titular_id: cobertura.titular,
					suplente_id: cobertura.suplente,
					motivo: "vacaciones",
					desde: cobertura.desde,
					hasta: cobertura.hasta,
					creada_por: datos.supervisores[0]?.id ?? ctx.sistema,
					created_at: enGT(sumarDias(cobertura.desde, -3), 15),
				},
			]
		: [];

	// 3d. Agendas de los últimos 30 días (cerradas con el mismo SQL del job).
	const snapshots: Fila[] = [];
	const items: Fila[] = [];
	// Primera siembra: 30 días. Incremental: los días de la ventana; si el job ya
	// capturó la agenda de ese día, se respeta y solo se vuelve a cerrar.
	const diasAgenda = [
		...dias(INCREMENTAL ? INICIO : sumarDias(HOY, -30), sumarDias(HOY, -1)),
	].filter(habil);
	const agendaExistente = new Set(
		(
			(await sql.unsafe(
				"SELECT fecha_gt::text || '|' || asesor_id k FROM public.agenda_cobros_snapshots WHERE fecha_gt >= $1::date",
				[diasAgenda[0] ?? HOY],
			)) as { k: string }[]
		).map((r) => r.k),
	);
	for (const dia of diasAgenda) {
		const porAsesor = new Map<string, Fila[]>();
		for (const c of crm) {
			const seg = segmentoEn(c, dia);
			const casoId = casoPorSifco.get(c.sifco);
			if (!seg || seg.asesor === null || !casoId) continue;
			const dueñoUser = userPorAsesor.get(seg.asesor);
			if (!dueñoUser) continue;
			const s = sims.get(c.id);
			let motivo: string | null = null;
			if (seg.b === 0) {
				if (c.cuotas.some((q) => q.fv === dia)) motivo = "D-0";
			} else if (cuotasVencidas(c, dia).length) {
				const promesaHoy = s?.promesas.some((p) => p.dia === dia);
				const contactado = s?.contactadoEn.has(dia);
				const ult = [...(s?.contactadoEn ?? [])]
					.filter((d) => d < dia)
					.sort()
					.at(-1);
				const sinContacto =
					!ult || habilesEntre(ult, dia) >= (slaDe.get(seg.b) ?? 3);
				if (promesaHoy) motivo = "promesa_hoy";
				else if (contactado || sinContacto) motivo = "sla_hoy";
			}
			if (!motivo) continue;
			const lista = porAsesor.get(dueñoUser) ?? [];
			lista.push({
				caso_cobro_id: casoId,
				numero_credito_sifco: c.sifco,
				bucket_snapshot: seg.b,
				motivo_agenda: motivo,
			});
			porAsesor.set(dueñoUser, lista);
		}
		for (const [asesorUser, lista] of porAsesor) {
			if (agendaExistente.has(`${dia}|${asesorUser}`)) continue;
			const id = uuid();
			snapshots.push({
				id,
				fecha_gt: dia,
				asesor_id: asesorUser,
				capturado_en: enGT(dia, 6, 30),
				total_planificado: lista.length,
				total_atendidos: 0,
				total_pendientes: lista.length,
				estado: "abierto",
			});
			for (const it of lista)
				items.push({
					id: uuid(),
					snapshot_id: id,
					...it,
					atendido: false,
					promesa_cumplida: false,
				});
		}
	}

	// 3e. Notificaciones de cobros.
	const notifs: Fila[] = [];
	const notif = (n: Fila) => {
		// En modo incremental los avisos los generan los jobs (promesas, alertas).
		if (INCREMENTAL) return;
		const leida = n.status === "read";
		notifs.push({
			id: uuid(),
			type: "reminder",
			status: "pending",
			related_entity_type: "collection_case",
			redirect_page: "cobros_detail",
			read_at: leida ? sumarMin(n.created_at as string, 90) : null,
			updated_at: n.created_at,
			...n,
		});
	};
	for (const c of crm) {
		const s = sims.get(c.id);
		const casoId = casoPorSifco.get(c.sifco);
		if (!s || !casoId) continue;
		for (const p of s.promesas) {
			if (p.estado !== "incumplida" || p.dia < sumarDias(HOY, -12)) continue;
			const creado = enGT(sumarDias(p.dia, 1), 0, 30);
			if (ms(creado) > ms(CORTE_HOY)) continue;
			notif({
				titulo: "Promesa de pago incumplida",
				descripcion: `La promesa de pago del crédito ${c.sifco} venció y la(s) cuota(s) prometida(s) siguen pendientes.`,
				status: p.dia >= sumarDias(HOY, -3) ? "pending" : "read",
				cobros_tipo: "promesa_incumplida",
				created_by: p.usuario,
				created_by_role: "cobros",
				assigned_to_role: "cobros",
				assigned_to: p.usuario,
				related_entity_id: casoId,
				created_at: creado,
			});
		}
		// Subidas de los últimos días: aviso al dueño nuevo.
		c.segmentos.forEach((seg, i) => {
			if (
				i === 0 ||
				seg.desde < sumarDias(HOY, -6) ||
				seg.b <= c.segmentos[i - 1].b
			)
				return;
			const u = seg.asesor !== null ? userPorAsesor.get(seg.asesor) : undefined;
			if (!u) return;
			const creado = enGT(seg.desde, 8, 0);
			if (ms(creado) > ms(CORTE_HOY)) return;
			notif({
				titulo: "Cliente subió de bucket",
				descripcion: `El crédito ${c.sifco} (${(fichaPorSifco.get(c.sifco)?.nombre as string) || "cliente"}) subió a ${bucketNombre.get(seg.b)}. Priorice el contacto para que baje de bucket.`,
				status: seg.desde >= sumarDias(HOY, -2) ? "pending" : "read",
				cobros_tipo: "cliente_subido",
				created_by: u,
				created_by_role: "cobros",
				assigned_to_role: "cobros",
				assigned_to: u,
				related_entity_id: casoId,
				created_at: creado,
			});
		});
		// Sin contacto 3 días hábiles: asesor y supervisores.
		const b = actual(c);
		const ult = [...s.contactadoEn].sort().at(-1);
		if (b >= 1 && b <= 4 && (!ult || habilesEntre(ult, HOY) >= 3)) {
			const u = userPorAsesor.get(c.asesorId ?? -1);
			const creado = enGT(HOY, 8, 0);
			if (u && ms(creado) <= ms(CORTE_HOY)) {
				const base = {
					titulo: "Cliente vencido: 3 días hábiles sin contacto",
					descripcion: `El crédito ${c.sifco} lleva 3+ días hábiles en ${bucketNombre.get(b)} sin registro de contacto. Es una falta pendiente por atender.`,
					cobros_tipo: "sin_contacto_3d",
					related_entity_id: casoId,
					created_at: creado,
					status: "pending",
				};
				notif({
					...base,
					created_by: u,
					created_by_role: "cobros",
					assigned_to_role: "cobros",
					assigned_to: u,
				});
				for (const sup of datos.supervisores)
					notif({
						...base,
						descripcion: `${base.descripcion} Asesor: ${nombreUsuario.get(u) ?? ""}.`,
						created_by: ctx.sistema,
						created_by_role: "admin",
						assigned_to_role: "cobros_supervisor",
						assigned_to: sup.id,
					});
			}
		}
	}
	// Bandeja: avisos de recuperaciones y apagados pendientes a los supervisores.
	for (const r of recuperaciones.filter(
		(x) => x.estado_solicitud === "pendiente",
	))
		for (const sup of datos.supervisores)
			notif({
				titulo: "Solicitud de recuperación del vehículo",
				descripcion:
					"Un asesor pidió aprobar la recuperación del vehículo. Revise el checklist en Solicitudes.",
				type: "action_required",
				cobros_tipo: "recuperacion_pendiente_aprobacion",
				created_by: r.registrado_por,
				created_by_role: "cobros",
				assigned_to_role: "cobros_supervisor",
				assigned_to: sup.id,
				related_entity_id: r.caso_cobro_id,
				created_at: r.created_at,
			});
	for (const m of inmovilizaciones.filter(
		(x) => x.estado === "pendiente_aprobacion",
	))
		for (const sup of datos.supervisores)
			notif({
				titulo: "Apagado de unidad por aprobar",
				descripcion: `El crédito ${m.numero_credito_sifco} tiene un apagado pendiente de aprobación.`,
				type: "action_required",
				cobros_tipo: "inmovilizacion_pendiente_aprobacion",
				created_by: m.solicitado_por,
				created_by_role: "cobros",
				assigned_to_role: "cobros_supervisor",
				assigned_to: sup.id,
				related_entity_id: m.caso_cobro_id,
				inmovilizacion_id: m.id,
				created_at: m.created_at,
			});

	// ─── Resumen ─────────────────────────────────────────────────────────
	const resumen: [string, number][] = [
		[
			`${CS}.buckets_historial (reconstruida, ${INCREMENTAL ? 0 : reconstruir.length} créditos)`,
			historiaBH.length,
		],
		[`${CS}.credito_asesor_historial`, historiaCAH.length],
		["casos_cobros (nuevos)", casosNuevos.length],
		["contactos_cobros", contactos.length],
		[
			"  · promesas",
			contactos.filter((x) => x.estado_contacto === "promesa_pago").length,
		],
		["visitas_cobros", visitas.length],
		["contactos_referencias_cobros", refs.length],
		["hallazgos_localizacion_cobros", hallazgos.length],
		["investigaciones_redes_cobros", redes.length],
		["recuperaciones_vehiculo", recuperaciones.length],
		["inmovilizaciones_unidad", inmovilizaciones.length],
		["gps_eventos", gpsEventos.length],
		["solicitudes_juridico_cobros", juridico.length],
		["solicitudes_rebaja_mora_cobros", rebajas.length],
		["cierre_diario_credito_cobros", cierre.length],
		["metas_asesor_cobros", metas.length],
		["coberturas_agenda_cobros", coberturas.length],
		["agenda_cobros_snapshots", snapshots.length],
		["agenda_cobros_snapshot_items", items.length],
		["notifications", notifs.length],
	];
	console.table(Object.fromEntries(resumen));
	const porUsuario = new Map<string, number>();
	for (const x of contactos)
		porUsuario.set(
			nombreUsuario.get(x.realizado_por as string) ?? String(x.realizado_por),
			(porUsuario.get(nombreUsuario.get(x.realizado_por as string) ?? "") ??
				0) + 1,
		);
	console.log("Gestiones por usuario:", Object.fromEntries(porUsuario));
	const estadosPromesa = new Map<string, number>();
	for (const x of contactos.filter((y) => y.estado_promesa))
		estadosPromesa.set(
			x.estado_promesa as string,
			(estadosPromesa.get(x.estado_promesa as string) ?? 0) + 1,
		);
	console.log("Promesas por estado:", Object.fromEntries(estadosPromesa));
	if (DRY) return;

	// ─── Escritura (una transacción) ─────────────────────────────────────
	await sql.begin(async (tx) => {
		await prepararTablasDeMarca(tx);
		const ids = arrInt(INCREMENTAL ? [] : reconstruir.map((c) => c.id));
		await tx.unsafe(
			`INSERT INTO ${CS}._seed_demo_bk_buckets_historial SELECT *, $2 FROM ${CS}.buckets_historial WHERE credito_id = ANY($1::text::int[])`,
			[ids, CORRIDA],
		);
		await tx.unsafe(
			`INSERT INTO ${CS}._seed_demo_bk_credito_asesor_historial SELECT *, $2 FROM ${CS}.credito_asesor_historial WHERE credito_id = ANY($1::text::int[])`,
			[ids, CORRIDA],
		);
		await tx.unsafe(
			`DELETE FROM ${CS}.buckets_historial WHERE credito_id = ANY($1::text::int[])`,
			[ids],
		);
		await tx.unsafe(
			`DELETE FROM ${CS}.credito_asesor_historial WHERE credito_id = ANY($1::text::int[])`,
			[ids],
		);
		const bhIns = await insertar(
			tx,
			`${CS}.buckets_historial`,
			historiaBH,
			"RETURNING historial_id, credito_id, bucket_anterior, bucket_nuevo, tipo_evento, to_char(fecha, 'YYYY-MM-DD HH24:MI:SS') fecha",
		);
		marcar(
			`${CS}.buckets_historial`,
			bhIns.map((r) => r.historial_id),
		);
		const cahIns = await insertar(
			tx,
			`${CS}.credito_asesor_historial`,
			historiaCAH,
			"RETURNING historial_id",
		);
		marcar(
			`${CS}.credito_asesor_historial`,
			cahIns.map((r) => r.historial_id),
		);

		// Tareas de B3 para el supervisor: ingresos a B3 de los últimos 3 días hábiles.
		const desdeB3 =
			sumarHabiles(sumarDias(HOY, -6), 0) < sumarDias(HOY, -4)
				? sumarDias(HOY, -4)
				: sumarDias(HOY, -6);
		for (const r of bhIns) {
			if (r.tipo_evento !== "SUBIDA" || r.bucket_nuevo !== 3) continue;
			const fecha = String(r.fecha);
			if (fecha.slice(0, 10) < desdeB3) continue;
			const c = datos.creditos.find((x) => x.id === r.credito_id);
			const casoId = c ? casoPorSifco.get(c.sifco) : undefined;
			if (!c || !casoId) continue;
			const vence = enGT(
				sumarHabiles(sumarDias(fecha.slice(0, 10), 1), 3),
				23,
				59,
				59,
			);
			for (const sup of datos.supervisores)
				notif({
					titulo: "Llamar al cliente: ingresó a B3",
					descripcion: `El crédito ${c.sifco} (${(fichaPorSifco.get(c.sifco)?.nombre as string) || "cliente"}) ingresó a ${bucketNombre.get(3)}. Llame al cliente antes del ${fechaLegible(vence.slice(0, 10))} para intervenir; si no se cumple, se generará una alerta.`,
					type: "action_required",
					cobros_tipo: "b3_llamada_supervisor",
					cobros_dedup_key: `b3:${r.historial_id}`,
					fecha_vencimiento: vence,
					created_by: ctx.sistema,
					created_by_role: "admin",
					assigned_to_role: "cobros_supervisor",
					assigned_to: sup.id,
					related_entity_id: casoId,
					created_at: sumarMin(fecha, 8 * 60),
				});
		}

		const ins = async (tabla: string, filas: Fila[], extra = "") => {
			const r = await insertar(
				tx,
				`public.${tabla}`,
				filas,
				extra || "RETURNING id",
			);
			marcar(
				`public.${tabla}`,
				r.map((x) => x.id),
			);
			console.log(`  ${tabla}: ${r.length}`);
		};
		await ins("casos_cobros", casosNuevos);
		await ins("contactos_cobros", contactos);
		await ins("visitas_cobros", visitas);
		await ins("contactos_referencias_cobros", refs);
		await ins("hallazgos_localizacion_cobros", hallazgos);
		await ins("investigaciones_redes_cobros", redes);
		await ins("recuperaciones_vehiculo", recuperaciones);
		await ins(
			"inmovilizaciones_unidad",
			inmovilizaciones.filter((x) => !x.inmovilizacion_origen_id),
		);
		await ins(
			"inmovilizaciones_unidad",
			inmovilizaciones.filter((x) => x.inmovilizacion_origen_id),
		);
		await ins("inmovilizaciones_unidad_eventos", eventosInm);
		await ins("gps_eventos", gpsEventos);
		await ins("solicitudes_juridico_cobros", juridico);
		await ins("solicitudes_rebaja_mora_cobros", rebajas);
		await ins(
			"cierre_diario_credito_cobros",
			cierre,
			"ON CONFLICT DO NOTHING RETURNING id",
		);
		await ins(
			"metas_asesor_cobros",
			metas,
			"ON CONFLICT (asesor_id, anio, mes) DO NOTHING RETURNING id",
		);
		await ins("coberturas_agenda_cobros", coberturas);
		await ins("agenda_cobros_snapshots", snapshots);
		await ins("agenda_cobros_snapshot_items", items);
		for (const dia of diasAgenda) await cerrarAgenda(tx, dia);
		await ins("notifications", notifs);

		await insertar(
			tx,
			"public.seed_demo_filas",
			marcadas.map((m) => ({ corrida: CORRIDA, tabla: m.tabla, pk: m.pk })),
		);
		console.log(
			`Marcadas ${marcadas.length} filas en public.seed_demo_filas (corrida ${CORRIDA}).`,
		);
	});
}

/** Copia del cierre de `cerrarSnapshotsAgenda` (jobs/agenda-cobros-snapshots.ts). */
async function cerrarAgenda(tx: Tx, fecha: string) {
	await tx.unsafe(
		`UPDATE agenda_cobros_snapshot_items i
		 SET atendido = false, contacto_cobro_id = NULL, atendido_en = NULL, resultado_contacto = NULL,
		     realizado_por = NULL, promesa_cumplida = false, promesa_contacto_cobro_id = NULL, promesa_cumplida_en = NULL
		 FROM agenda_cobros_snapshots s WHERE i.snapshot_id = s.id AND s.fecha_gt = $1::date`,
		[fecha],
	);
	await tx.unsafe(
		`WITH promesas_cumplidas AS (
			SELECT DISTINCT ON (i.id) i.id AS item_id, cc.id AS promesa_contacto_id,
			       COALESCE(cc.updated_at, cc.fecha_contacto) AS cumplida_en
			FROM agenda_cobros_snapshots s
			JOIN agenda_cobros_snapshot_items i ON i.snapshot_id = s.id
			JOIN contactos_cobros cc ON cc.estado_contacto = 'promesa_pago' AND cc.estado_promesa = 'cumplida'
			 AND cc.fecha_proximo_contacto >= ($1::date + interval '6 hours')
			 AND cc.fecha_proximo_contacto < ($1::date + interval '1 day 6 hours')
			JOIN casos_cobros caso_promesa ON caso_promesa.id = cc.caso_cobro_id
			WHERE s.fecha_gt = $1::date
			  AND (i.caso_cobro_id = cc.caso_cobro_id OR caso_promesa.numero_credito_sifco = i.numero_credito_sifco)
			ORDER BY i.id, cc.updated_at ASC NULLS LAST, cc.id ASC)
		 UPDATE agenda_cobros_snapshot_items i
		 SET promesa_cumplida = true, promesa_contacto_cobro_id = p.promesa_contacto_id, promesa_cumplida_en = p.cumplida_en
		 FROM promesas_cumplidas p WHERE i.id = p.item_id`,
		[fecha],
	);
	await tx.unsafe(
		`WITH primeros AS (
			SELECT DISTINCT ON (i.id) i.id AS item_id, cc.id AS contacto_id, cc.fecha_contacto,
			       cc.estado_contacto, cc.realizado_por
			FROM agenda_cobros_snapshots s
			JOIN agenda_cobros_snapshot_items i ON i.snapshot_id = s.id
			LEFT JOIN coberturas_agenda_cobros cobertura ON cobertura.titular_id = s.asesor_id
			 AND cobertura.desde <= $1::date AND cobertura.hasta >= $1::date
			JOIN contactos_cobros cc ON cc.realizado_por IN (s.asesor_id, cobertura.suplente_id)
			 AND (cobertura.suplente_id IS NULL OR cc.realizado_por = s.asesor_id
			      OR (cobertura.created_at <= cc.fecha_contacto
			          AND (cobertura.cancelada_en IS NULL OR cobertura.cancelada_en > cc.fecha_contacto)))
			 AND cc.fecha_contacto >= ($1::date + interval '6 hours')
			 AND cc.fecha_contacto < ($1::date + interval '1 day 6 hours')
			 AND cc.estado_contacto = ANY('{contactado,acuerdo_parcial,rechaza_pagar,promesa_pago}'::estado_contacto[])
			 AND cc.comentarios NOT LIKE 'Recordatorio automático%'
			 AND cc.comentarios NOT LIKE 'Envío masivo de WhatsApp%'
			JOIN casos_cobros caso_contacto ON caso_contacto.id = cc.caso_cobro_id
			WHERE s.fecha_gt = $1::date
			  AND (i.caso_cobro_id = cc.caso_cobro_id OR caso_contacto.numero_credito_sifco = i.numero_credito_sifco)
			ORDER BY i.id, (cc.realizado_por = s.asesor_id) DESC, cc.fecha_contacto ASC, cc.id ASC)
		 UPDATE agenda_cobros_snapshot_items i
		 SET atendido = true, contacto_cobro_id = p.contacto_id, atendido_en = p.fecha_contacto,
		     resultado_contacto = p.estado_contacto, realizado_por = p.realizado_por
		 FROM primeros p WHERE i.id = p.item_id`,
		[fecha],
	);
	await tx.unsafe(
		`UPDATE agenda_cobros_snapshots s
		 SET total_planificado = t.planificados, total_atendidos = t.atendidos,
		     total_pendientes = t.planificados - t.atendidos, estado = 'cerrado',
		     cerrado_en = COALESCE(s.cerrado_en, ($1::date + interval '1 day 4 hours'))
		 FROM (SELECT i.snapshot_id, count(*)::int planificados,
		              count(*) FILTER (WHERE i.atendido OR i.promesa_cumplida)::int atendidos
		       FROM agenda_cobros_snapshot_items i JOIN agenda_cobros_snapshots s2 ON s2.id = i.snapshot_id
		       WHERE s2.fecha_gt = $1::date GROUP BY 1) t
		 WHERE s.id = t.snapshot_id AND s.fecha_gt = $1::date`,
		[fecha],
	);
}

// ─── 4. Convenios por la API real ─────────────────────────────────────────

async function rpc(cookie: string, proc: string, input: unknown) {
	const r = await fetch(`${CRM_API}/rpc/${proc}`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Cookie: cookie },
		body: JSON.stringify({ json: input }),
	});
	const body = (await r.json().catch(() => ({}))) as {
		json?: Record<string, unknown>;
	};
	if (!r.ok)
		throw new Error(
			`${proc} ${r.status}: ${JSON.stringify(body.json ?? body).slice(0, 300)}`,
		);
	return body.json as Record<string, unknown>;
}
async function login(email: string): Promise<string> {
	const r = await fetch(`${CRM_API}/api/auth/sign-in/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, password: CLAVE_DEV }),
	});
	if (!r.ok) throw new Error(`login ${email}: ${r.status}`);
	const cookie = r.headers
		.getSetCookie()
		.find((c) => c.includes("better-auth.session_token"));
	if (!cookie) throw new Error(`login ${email}: sin cookie de sesión`);
	return cookie.split(";")[0];
}

async function convenios() {
	const PENDIENTES = Number(opt("pendientes") ?? 8);
	const APROBAR = Number(opt("aprobar") ?? 3);
	const RECHAZAR = Number(opt("rechazar") ?? 3);
	const candidatos = (await sql.unsafe(
		`WITH b AS (SELECT DISTINCT ON (credito_id) credito_id, bucket_nuevo
		            FROM ${CS}.buckets_historial ORDER BY credito_id, fecha DESC, historial_id DESC)
		 SELECT c.credito_id::int id, c.numero_credito_sifco sifco, b.bucket_nuevo::int b,
		        coalesce(c.cuota,0)::float8 cuota, coalesce(c.deudatotal,0)::float8 deuda,
		        coalesce((SELECT monto_mora FROM ${CS}.moras_credito m WHERE m.credito_id = c.credito_id AND m.activa ORDER BY mora_id DESC LIMIT 1), 0)::float8 mora,
		        a.email_cash_in email, k.id caso,
		        (SELECT array_agg(q.cuota_id ORDER BY q.numero_cuota) FROM ${CS}.cuotas_credito q
		          WHERE q.credito_id = c.credito_id AND NOT coalesce(q.pagado, false)
		            AND q.numero_cuota > 0 AND q.fecha_vencimiento < (now() AT TIME ZONE 'America/Guatemala')::date) cuotas
		 FROM ${CS}.creditos c JOIN b USING (credito_id)
		 JOIN ${CS}.asesores a ON a.asesor_id = c.asesor_id
		 JOIN LATERAL (SELECT id FROM public.casos_cobros k WHERE k.activo AND k.numero_credito_sifco = c.numero_credito_sifco ORDER BY created_at LIMIT 1) k ON true
		 WHERE c.numero_credito_sifco LIKE 'CRM-%' AND c."statusCredit" = 'MOROSO' AND b.bucket_nuevo IN (2, 3)
		 ORDER BY b.bucket_nuevo DESC, c.credito_id`,
	)) as {
		id: number;
		sifco: string;
		b: number;
		cuota: number;
		deuda: number;
		mora: number;
		email: string;
		caso: string;
		cuotas: number[] | null;
	}[];
	const total = PENDIENTES + APROBAR + RECHAZAR;
	const elegidos = candidatos.filter((c) => c.cuotas?.length).slice(0, total);
	console.log(
		`Convenios: ${elegidos.length} créditos de ${candidatos.length} candidatos en B2/B3.`,
	);
	const sesiones = new Map<string, string>();
	const sesion = async (email: string) => {
		if (!sesiones.has(email)) sesiones.set(email, await login(email));
		return sesiones.get(email)!;
	};
	const creados: { id: number; sifco: string }[] = [];
	const rng = rngDe(-2);
	for (const c of elegidos) {
		const cuotas = c.cuotas ?? [];
		const monto = Math.min(c.deuda, q2(c.cuota * cuotas.length + c.mora));
		try {
			const r = await rpc(await sesion(c.email), "crearConvenioDesdeFicha", {
				casoCobroId: c.caso,
				cuotaIds: cuotas,
				numeroMeses: rng.int(3, 6),
				motivo: rng.pick([
					"El cliente tuvo una baja de ingresos y propone ponerse al día en cuotas.",
					"Cliente con voluntad de pago; pide repartir el saldo vencido.",
					"Gasto médico imprevisto; solicita plan para regularizar el atraso.",
				]),
				observaciones: "Convenio registrado para la demo de COBROS-02.",
				montoTotal: monto,
			});
			creados.push({ id: Number(r.convenioId), sifco: c.sifco });
			console.log(
				`  + convenio ${r.convenioId} · ${c.sifco} · B${c.b} · Q${monto.toFixed(2)}`,
			);
		} catch (e) {
			console.warn(`  ! ${c.sifco}: ${(e as Error).message}`);
		}
	}
	const supervisor = (
		(await sql.unsafe(
			`SELECT email FROM public."user" WHERE role = 'cobros_supervisor' AND banned IS NOT TRUE ORDER BY name LIMIT 1`,
		)) as { email: string }[]
	)[0].email;
	const cookieSup = await sesion(supervisor);
	for (const [i, conv] of creados.entries()) {
		const decision =
			i < APROBAR ? "aprobado" : i < APROBAR + RECHAZAR ? "rechazado" : null;
		if (!decision) continue;
		try {
			await rpc(cookieSup, "decidirConvenio", {
				convenioId: conv.id,
				decision,
				motivo:
					decision === "rechazado"
						? "El monto propuesto no cubre la mora; negocie un abono inicial mayor."
						: "Aprobado: el cliente mostró capacidad de pago.",
				operacionId: uuid(),
			});
			console.log(`  ✓ convenio ${conv.id} ${decision}`);
		} catch (e) {
			console.warn(`  ! decidir ${conv.id}: ${(e as Error).message}`);
		}
	}
}

// ─── Arranque ─────────────────────────────────────────────────────────────

try {
	if (LIMPIAR) await limpiar();
	else if (CONVENIOS) await convenios();
	else await sembrar();
} finally {
	await sql.close();
}
