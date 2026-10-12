import { ORPCError } from "@orpc/server";
import { and, desc, eq, ilike, isNotNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { carteraBackReferences } from "../db/schema/cartera-back";
import { leads, opportunities } from "../db/schema/crm";
import { vehicles } from "../db/schema/vehicles";
import {
	type CamposCartaPoder,
	camposVacios,
	datosDeLaCartaPoder,
	ESTADOS_CIVILES,
	TIPOS_CARTA_PODER,
} from "../lib/carta-poder";
import { calculateAge } from "../lib/contract-utils";
import { juridicoProcedure } from "../lib/orpc";
import { getFileUrlWithBucketInKey } from "../lib/storage";
import { generateContractsBatch } from "../services/legal-docs-api";

/**
 * La carta poder sale del CRM: jurídico busca el crédito, el formulario se
 * llena con lo que el CRM ya tiene del cliente y del vehículo, y lo que falte
 * lo escribe a mano. Si el crédito no aparece, llena todo a mano.
 *
 * No consulta cartera: el número de crédito se toma de la referencia que el CRM
 * ya guarda, o del que trae la oportunidad en los clientes migrados.
 */

const numeroDeCredito = sql<
	string | null
>`coalesce(${carteraBackReferences.numeroCreditoSifco}, ${opportunities.numeroSifco})`;

/**
 * Los clientes migrados traen el vehículo con relleno ("N/A", "No
 * especificado", año 2000). Eso no es un dato: se deja vacío para que no
 * termine impreso en la carta.
 */
const RELLENO = new Set(["", "N/A", "NA", "NO ESPECIFICADO", "-", "S/N"]);

function dato(valor: string | number | null | undefined): string {
	if (valor === null || valor === undefined) return "";
	const texto = String(valor).trim();
	return RELLENO.has(texto.toUpperCase()) ? "" : texto;
}

const camposSchema = z.object({
	genero: z.enum(["male", "female"]),
	nombreCompleto: z.string(),
	edad: z.string(),
	estadoCivil: z.enum([...ESTADOS_CIVILES, ""]),
	profesion: z.string(),
	nacionalidad: z.string(),
	dpi: z.string(),
	tipoVehiculo: z.string(),
	marcaVehiculo: z.string(),
	colorVehiculo: z.string(),
	usoVehiculo: z.string(),
	chasisVehiculo: z.string(),
	motorVehiculo: z.string(),
	serieVehiculo: z.string(),
	lineaVehiculo: z.string(),
	modeloVehiculo: z.string(),
	cm3Vehiculo: z.string(),
	asientosVehiculo: z.string(),
	cilindrosVehiculo: z.string(),
	iscvVehiculo: z.string(),
	paisDestino: z.string(),
	fechaFirma: z.string(),
	fechaVencimiento: z.string(),
	edadRepresentante: z.string(),
}) satisfies z.ZodType<CamposCartaPoder>;

export const cartaPoderRouter = {
	/**
	 * Créditos por nombre del cliente, DPI o número de crédito. Sólo
	 * oportunidades que ya son crédito: la carta es sobre un vehículo que está a
	 * nombre de la empresa.
	 */
	buscarCreditosCartaPoder: juridicoProcedure
		.input(z.object({ texto: z.string().trim().min(2).max(100) }))
		.handler(async ({ input }) => {
			const terminos = input.texto.split(/\s+/).filter(Boolean);
			const porTermino = terminos.map((termino) => {
				const patron = `%${termino}%`;
				return or(
					ilike(leads.firstName, patron),
					ilike(leads.middleName, patron),
					ilike(leads.lastName, patron),
					ilike(leads.secondLastName, patron),
					ilike(leads.dpi, patron),
					sql`${numeroDeCredito} ilike ${patron}`,
				);
			});

			const filas = await db
				.select({
					opportunityId: opportunities.id,
					firstName: leads.firstName,
					middleName: leads.middleName,
					lastName: leads.lastName,
					secondLastName: leads.secondLastName,
					dpi: leads.dpi,
					credito: numeroDeCredito,
					marca: vehicles.make,
					linea: vehicles.model,
					anio: vehicles.year,
					placa: vehicles.licensePlate,
				})
				.from(opportunities)
				.innerJoin(leads, eq(leads.id, opportunities.leadId))
				.leftJoin(
					carteraBackReferences,
					eq(carteraBackReferences.opportunityId, opportunities.id),
				)
				.leftJoin(vehicles, eq(vehicles.id, opportunities.vehicleId))
				.where(
					and(
						or(
							isNotNull(carteraBackReferences.id),
							isNotNull(opportunities.numeroSifco),
						),
						...porTermino,
					),
				)
				.orderBy(desc(opportunities.createdAt))
				.limit(20);

			return filas.map((f) => {
				// Sin marca, el año del migrado es relleno (2000): no se muestra.
				const vehiculo = dato(f.marca)
					? [dato(f.marca), dato(f.linea), dato(f.anio)]
							.filter(Boolean)
							.join(" ")
					: "";
				return {
					opportunityId: f.opportunityId,
					nombre: [f.firstName, f.middleName, f.lastName, f.secondLastName]
						.filter(Boolean)
						.join(" "),
					dpi: f.dpi,
					credito: f.credito,
					vehiculo: [vehiculo, dato(f.placa)].filter(Boolean).join(" · "),
				};
			});
		}),

	/**
	 * Lo que el CRM sabe del cliente y del vehículo, en la forma del formulario.
	 * Lo que no tiene sale vacío; las fechas y el país los pone jurídico.
	 */
	datosCartaPoder: juridicoProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				hoy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
			}),
		)
		.handler(async ({ input }) => {
			const [fila] = await db
				.select({ lead: leads, vehicle: vehicles })
				.from(opportunities)
				.innerJoin(leads, eq(leads.id, opportunities.leadId))
				.leftJoin(vehicles, eq(vehicles.id, opportunities.vehicleId))
				.where(eq(opportunities.id, input.opportunityId))
				.limit(1);

			if (!fila) {
				throw new ORPCError("NOT_FOUND", {
					message: "No se encontró el crédito",
				});
			}

			const { lead, vehicle: v } = fila;
			const edad = lead.birthDate
				? calculateAge(lead.birthDate)
				: (lead.age ?? null);
			// Sin marca, el año del migrado es relleno (2000), no el modelo.
			const tieneVehiculo = Boolean(v && dato(v.make));

			return {
				...camposVacios(input.hoy),
				genero: lead.gender === "female" ? "female" : "male",
				nombreCompleto: [
					lead.firstName,
					lead.middleName,
					lead.lastName,
					lead.secondLastName,
				]
					.filter(Boolean)
					.join(" "),
				edad: edad && edad > 0 ? String(edad) : "",
				estadoCivil: lead.maritalStatus ?? "",
				profesion: dato(lead.jobTitle),
				nacionalidad: dato(lead.nationality),
				dpi: dato(lead.dpi),
				tipoVehiculo: dato(v?.vehicleType),
				marcaVehiculo: dato(v?.make),
				colorVehiculo: dato(v?.color),
				usoVehiculo: dato(v?.vehicleUse) || "Particular",
				chasisVehiculo: dato(v?.vinNumber),
				motorVehiculo: dato(v?.motorNumber),
				serieVehiculo: dato(v?.series),
				// La línea del vehículo se guarda en `model` y el modelo es el año,
				// como en los contratos de venta.
				lineaVehiculo: dato(v?.model),
				modeloVehiculo: tieneVehiculo ? dato(v?.year) : "",
				cm3Vehiculo: dato(v?.engineCC),
				asientosVehiculo: dato(v?.seats),
				cilindrosVehiculo: dato(v?.cylinders),
				iscvVehiculo: dato(v?.iscvCode),
			} satisfies CamposCartaPoder;
		}),

	/**
	 * Arma la carta y devuelve el PDF. Se firma en papel ante notario: no va a
	 * WeeTrust ni se enlaza a la oportunidad.
	 */
	generarCartaPoder: juridicoProcedure
		.input(
			z.object({
				tipo: z.enum(TIPOS_CARTA_PODER),
				campos: camposSchema,
			}),
		)
		.handler(async ({ input }) => {
			const { tipo, campos } = input;
			const nombre = campos.nombreCompleto.trim() || "Carta poder";

			const respuesta = await generateContractsBatch({
				contracts: [
					{
						contractType: tipo,
						data: datosDeLaCartaPoder(tipo, campos),
						options: {
							gender: campos.genero,
							generatePdf: true,
							filenamePrefix: nombre
								.normalize("NFD")
								.replace(/[̀-ͯ]/g, "")
								.replace(/[^A-Za-z0-9]+/g, "_"),
						},
					},
				],
			});

			const resultado = respuesta.results?.[0];
			// Sólo se mira que exista el PDF. No se pasa por `motivoDeFalla`: si el
			// generador todavía no la tiene marcada como firma en papel, la devuelve
			// como electrónica sin links y eso la daría por fallida.
			if (
				!resultado?.success ||
				(!resultado.r2Key && !resultado.linkDocument)
			) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message:
						resultado?.error ||
						respuesta.message ||
						"No se pudo generar la carta poder",
				});
			}

			return {
				documentLink: resultado.r2Key
					? await getFileUrlWithBucketInKey(resultado.r2Key)
					: resultado.linkDocument,
			};
		}),
};
