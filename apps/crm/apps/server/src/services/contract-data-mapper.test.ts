import { describe, expect, test } from "bun:test";
import {
	type ContractData,
	transformToApiFormat,
} from "./contract-data-mapper";

describe("transformToApiFormat", () => {
	test("conserva los campos nuevos usados por el endpoint legacy", () => {
		const data = {
			cliente: {
				nombreCompletoMayusculas: "CLIENTE DE PRUEBA",
				dpi: "1234567890101",
				dpiFormateado: "1234 56789 0101",
				edadEnLetras: "TREINTA AÑOS",
				genero: "masculino",
				estadoCivil: "soltero",
				nacionalidad: "guatemalteca",
				direccionMayusculas: "GUATEMALA",
				email: "cliente@example.com",
				profesion: "INGENIERO",
				telefono: "55555555",
			},
			vehiculo: {
				tipoVehiculoMayusculas: "SUV",
				marcaMayusculas: "MARCA",
				lineaMayusculas: "LINEA",
				anio: 2026,
				colorMayusculas: "BLANCO",
				placasMayusculas: "P123ABC",
				vinMayusculas: "VIN",
				motorMayusculas: "MOTOR",
				combustibleMayusculas: "GASOLINA",
				cilindraje: "2000",
				cilindros: "4",
				asientos: 5,
				puertas: 4,
				ejes: 2,
				usoMayusculas: "PARTICULAR",
				serieMayusculas: "SERIE",
				codigoIscvMayusculas: "ISCV",
			},
			credito: {
				montoTotalEnLetras: "CIEN MIL QUETZALES",
				montoTotalConQ: "Q.100,000.00",
				numeroCuotasEnLetras: "SESENTA",
				cuotaMensualEnLetras: "DOS MIL",
				cuotaMensualConQ: "Q.2,000.00",
				tasaInteres: 12,
				tasaInteresEnLetras: "DOCE",
			},
			contrato: {
				fecha: {
					day: "uno",
					month: "agosto",
					year: "dos mil veintiséis",
					yearPartial: "veintiséis",
					yearTwoDigits: "26",
					dayNumber: 1,
					dayPadded: "01",
					monthNumber: 8,
					yearNumber: 2026,
				},
				lugarFirma: "Guatemala",
			},
			vendedor: {
				nombre: "Vendedor de Prueba",
				nombreMayusculas: "VENDEDOR DE PRUEBA",
				dpi: "9876543210101",
				dpiFormateado: "9876 54321 0101",
				dpiLetras: "NUEVE OCHO SIETE",
				tipo: "individual",
			},
			desembolso: {
				filas: [
					{ cuenta: "BENEFICIARIO UNO", valor: "10,000.00" },
					{ cuenta: "BENEFICIARIO DOS", valor: "5,000.00" },
				],
				sobrantes: 0,
				omitidosPorMoneda: 0,
			},
			entidad: {
				nombre: "CUBE INVESTMENTS S.A.",
				tipo: "la entidad",
			},
			agencia: "AGENCIA DE PRUEBA",
		} as unknown as ContractData;

		expect(transformToApiFormat(data, "autorizacion_desembolso")).toMatchObject(
			{
				nombreVendedor: "VENDEDOR DE PRUEBA",
				dpiVendedor: "9876543210101",
				dpiTextoVendedor: "NUEVE OCHO SIETE",
				cuenta: "BENEFICIARIO UNO",
				valor: "10,000.00",
				cuenta2: "BENEFICIARIO DOS",
				valor2: "5,000.00",
				entidad: "CUBE INVESTMENTS S.A.",
				tipoEntidad: "la entidad",
				agencia: "AGENCIA DE PRUEBA",
			},
		);
	});
});
