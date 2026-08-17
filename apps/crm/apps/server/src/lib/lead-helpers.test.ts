import { describe, expect, test } from "bun:test";
import {
	buildPublicLeadReentryNote,
	getPublicLeadExistingOpportunityUpdates,
} from "./lead-helpers";

describe("public lead opportunity helpers", () => {
	test("updates reused opportunities with the incoming credit type", () => {
		const updates = getPublicLeadExistingOpportunityUpdates(
			{
				creditType: "autocompra",
				campaign: null,
			},
			{
				creditType: "sobre_vehiculo",
				campaign: "landing-sell",
			},
		);

		expect(updates).toEqual({
			creditType: "sobre_vehiculo",
			campaign: "landing-sell",
		});
	});
});

describe("public lead reentry notes", () => {
	const reentry = {
		notes: "Suburban o tahoe 2015+",
		sourceLabel: "Redes Sociales",
		dateStr: "2026-08-13",
	};

	test("anexa lo que escribió el cliente debajo de las notas del asesor", () => {
		expect(buildPublicLeadReentryNote("JAC T8 FULL 2027", reentry)).toBe(
			"JAC T8 FULL 2027\n[2026-08-13 · Redes Sociales] Suburban o tahoe 2015+",
		);
	});

	test("estrena las notas cuando la oportunidad no tenía", () => {
		expect(buildPublicLeadReentryNote(null, reentry)).toBe(
			"[2026-08-13 · Redes Sociales] Suburban o tahoe 2015+",
		);
		expect(buildPublicLeadReentryNote("   ", reentry)).toBe(
			"[2026-08-13 · Redes Sociales] Suburban o tahoe 2015+",
		);
	});

	test("no anexa nada si el cliente no escribió", () => {
		expect(
			buildPublicLeadReentryNote("JAC T8 FULL 2027", {
				...reentry,
				notes: undefined,
			}),
		).toBeNull();
		expect(
			buildPublicLeadReentryNote("JAC T8 FULL 2027", {
				...reentry,
				notes: "   ",
			}),
		).toBeNull();
	});

	test("no duplica la línea si el formulario se reenvía el mismo día", () => {
		const conNota = buildPublicLeadReentryNote(
			"JAC T8 FULL 2027",
			reentry,
		) as string;

		expect(buildPublicLeadReentryNote(conNota, reentry)).toBeNull();
	});

	test("vuelve a anexar si el mismo texto entra otro día", () => {
		const conNota = buildPublicLeadReentryNote(
			"JAC T8 FULL 2027",
			reentry,
		) as string;

		expect(
			buildPublicLeadReentryNote(conNota, {
				...reentry,
				dateStr: "2026-08-20",
			}),
		).toBe(`${conNota}\n[2026-08-20 · Redes Sociales] Suburban o tahoe 2015+`);
	});
});
