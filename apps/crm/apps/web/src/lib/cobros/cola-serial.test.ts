import { describe, expect, it } from "bun:test";
import { crearColaSerial } from "./cola-serial";

/** Una promesa que se resuelve (o rechaza) cuando el test lo decide. */
function diferida<T = void>() {
	let resolver!: (valor: T) => void;
	let rechazar!: (error: unknown) => void;
	const promesa = new Promise<T>((res, rej) => {
		resolver = res;
		rechazar = rej;
	});
	return { promesa, resolver, rechazar };
}

describe("crearColaSerial", () => {
	it("no arranca una tarea hasta que termina la anterior, aunque la segunda sea más rápida", async () => {
		const cola = crearColaSerial();
		const orden: string[] = [];
		const lenta = diferida();

		const primera = cola.encolar(async () => {
			orden.push("empieza 1");
			await lenta.promesa;
			orden.push("termina 1");
		});
		const segunda = cola.encolar(async () => {
			orden.push("empieza 2");
			orden.push("termina 2");
		});

		await Promise.resolve();
		expect(orden).toEqual(["empieza 1"]);

		lenta.resolver();
		await Promise.all([primera, segunda]);
		expect(orden).toEqual(["empieza 1", "termina 1", "empieza 2", "termina 2"]);
	});

	it("una tarea que falla no frena a las siguientes, y el error le llega a quien la encoló", async () => {
		const cola = crearColaSerial();
		const falla = cola.encolar(async () => {
			throw new Error("se cayó la red");
		});
		const despues = cola.encolar(async () => "siguió");

		await expect(falla).rejects.toThrow("se cayó la red");
		await expect(despues).resolves.toBe("siguió");
	});

	it("esperar() resuelve cuando termina lo encolado, incluso si falló, y nunca rechaza", async () => {
		const cola = crearColaSerial();
		const lenta = diferida();
		let terminada = false;
		cola
			.encolar(async () => {
				await lenta.promesa;
				terminada = true;
				throw new Error("falló");
			})
			.catch(() => undefined);

		const espera = cola.esperar();
		expect(terminada).toBe(false);
		lenta.resolver();
		await expect(espera).resolves.toBeUndefined();
		expect(terminada).toBe(true);
	});

	it("cada tarea ve el estado del momento en que SALE, no el de cuando entró", async () => {
		const cola = crearColaSerial();
		let formulario = ["5555-0001"];
		const enviados: string[][] = [];
		const lenta = diferida();

		cola.encolar(async () => {
			await lenta.promesa;
		});
		cola.encolar(async () => {
			enviados.push([...formulario]);
		});
		// Mientras la primera sigue en vuelo, el asesor agrega otro número.
		formulario = [...formulario, "5555-0002"];

		lenta.resolver();
		await cola.esperar();
		expect(enviados).toEqual([["5555-0001", "5555-0002"]]);
	});
});
