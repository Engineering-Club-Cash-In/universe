/**
 * Lo que la WEB importa del servidor tiene que existir en su imagen.
 *
 * `apps/crm/Dockerfile` (la web, dev y prod) no copia todo el servidor: solo
 * las carpetas que lista en sus `COPY apps/crm/apps/server/src/...`. La web
 * importa módulos del servidor con el alias `server/` (reglas compartidas:
 * visitas, recuperación, referencias…), y cada uno arrastra lo que importa.
 * Si esa cadena sale de las carpetas copiadas, en local compila —ahí está
 * todo— y el build de la imagen revienta con "Could not resolve".
 *
 * Pasó con `lib/referencias-cobros` → `bot-cobros/identificadores` →
 * `utils/cui-validation`: el deploy de la web de COBROS-02 falló en cada
 * merge del 2026-09-25 al 2026-09-30 sin que nadie lo viera. Esta prueba
 * recorre la misma cadena que recorre el bundler y falla antes.
 *
 * Los `import type` no cuentan: se borran al compilar. Los `import { type X }`
 * sí, porque con `verbatimModuleSyntax` queda el import del módulo.
 */
import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";

const SERVER = resolve(import.meta.dir, "..", "..");
const CRM = resolve(SERVER, "..", "..");
const WEB_SRC = join(CRM, "apps", "web", "src");
const DOCKERFILE = join(CRM, "Dockerfile");

const IMPORT =
	/(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'"`;]*?\sfrom\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function importsDe(archivo: string): string[] {
	const texto = readFileSync(archivo, "utf8");
	const specs: string[] = [];
	for (const m of texto.matchAll(IMPORT)) {
		const [, soloTipo, estatico, dinamico] = m;
		if (soloTipo) continue;
		const spec = estatico ?? dinamico;
		if (spec) specs.push(spec);
	}
	return specs;
}

function resolver(base: string): string | null {
	for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
		if (existsSync(c) && statSync(c).isFile()) return c;
	}
	return null;
}

function archivosTs(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const ruta = join(dir, e.name);
		if (e.isDirectory()) return archivosTs(ruta);
		// Las pruebas no entran al bundle (Vite sale de main.tsx y el Dockerfile
		// solo corre `build`): una prueba de la web puede importar del servidor
		// lo que no se copia sin romper la imagen.
		return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)
			? [ruta]
			: [];
	});
}

/** Las carpetas de `server/src` que el Dockerfile de la web copia. */
function carpetasCopiadas(): string[] {
	const dockerfile = readFileSync(DOCKERFILE, "utf8");
	return [
		...dockerfile.matchAll(/^COPY\s+apps\/crm\/apps\/server\/(src\/\S+)\s/gm),
	].map((m) => normalize(join(SERVER, m[1])));
}

const hayWeb = existsSync(WEB_SRC) && existsSync(DOCKERFILE);

describe.skipIf(!hayWeb)("imports de la web hacia el servidor", () => {
	it("todo lo que entra al bundle está en lo que copia el Dockerfile", () => {
		const copiadas = carpetasCopiadas();
		expect(copiadas.length).toBeGreaterThan(0);

		// De dónde sale cada archivo, para que el error diga la cadena.
		const origen = new Map<string, string>();
		const pendientes: string[] = [];
		const problemas: string[] = [];

		for (const archivo of archivosTs(WEB_SRC)) {
			for (const spec of importsDe(archivo)) {
				if (!spec.startsWith("server/")) continue;
				const destino = resolver(join(SERVER, spec.slice("server/".length)));
				if (!destino) {
					problemas.push(
						`${relative(CRM, archivo)} importa ${spec}, que no existe`,
					);
				} else if (!origen.has(destino)) {
					origen.set(destino, relative(CRM, archivo));
					pendientes.push(destino);
				}
			}
		}

		while (pendientes.length > 0) {
			const archivo = pendientes.pop() as string;
			if (!copiadas.some((c) => archivo.startsWith(c + sep))) {
				problemas.push(
					`${relative(CRM, archivo)} entra al bundle de la web (lo importa ${origen.get(archivo)}) y el Dockerfile de la web no lo copia`,
				);
				continue;
			}
			for (const spec of importsDe(archivo)) {
				if (!spec.startsWith(".")) continue;
				const destino = resolver(join(dirname(archivo), spec));
				if (!destino) {
					problemas.push(
						`${relative(CRM, archivo)} importa ${spec}, que no existe`,
					);
				} else if (!origen.has(destino)) {
					origen.set(destino, relative(CRM, archivo));
					pendientes.push(destino);
				}
			}
		}

		expect(problemas).toEqual([]);
	});
});
