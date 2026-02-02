import { z } from "zod";

export const bankStatementAnalysisSchema = z.object({
	datos_generales: z.object({
		nombre_cuentahabiente: z.string(),
		numero_cuenta: z.string(),
		tipo_cuenta: z.string(),
	}),
	resumen_mensual: z.array(
		z.object({
			mes: z.string(),
			saldo_inicial: z.number(),
			total_debitos: z.number(),
			total_creditos: z.number(),
			saldo_final: z.number(),
			ingresos: z.object({
				fijos: z.number(),
				variables: z.number(),
			}),
			gastos: z.object({
				fijos: z.number(),
				variables: z.number(),
			}),
		}),
	),
	promedio_mensual: z.object({
		promedio_ingresos_fijos: z.number(),
		promedio_ingresos_variables: z.number(),
		promedio_gastos_fijos: z.number(),
		promedio_gastos_variables: z.number(),
		disponibilidad_economica: z.number(),
	}),
});

export type BankStatementAnalysis = z.infer<typeof bankStatementAnalysisSchema>;

export const BANK_ANALYSIS_PROMPT = `
Eres un analista de capacidad de pago para una financiera que otorga créditos para la compra de vehículos. Tu tarea es analizar los estados de cuenta bancarios de un solicitante y extraer la información relevante para evaluar su capacidad de pago. Debes responder en formato JSON con los siguientes campos:

1. **datos_generales**: Un objeto que contenga:
   - nombre_cuentahabiente: Nombre completo del cuentahabiente.
   - numero_cuenta: Número de cuenta bancaria.
   - tipo_cuenta: Tipo de cuenta (monetaria, ahorros, etc.).

2. **resumen_mensual**: Un arreglo de objetos, donde cada objeto representa un mes y contiene:
   - mes: Nombre del mes (ej. "Febrero 2024").
   - saldo_inicial: Saldo al inicio del mes.
   - total_debitos: Total de débitos durante el mes.
   - total_creditos: Total de créditos durante el mes.
   - saldo_final: Saldo al final del mes.
   - ingresos: Un objeto que contenga:
     - fijos: Total de ingresos fijos durante el mes (ej. sueldos, rentas).
     - variables: Total de ingresos variables durante el mes (ej. bonos, comisiones).
     **Nota**: La suma de 'ingresos.fijos' y 'ingresos.variables' debe ser igual a 'total_creditos'.
   - gastos: Un objeto que contenga:
     - fijos: Total de gastos fijos durante el mes (ej. renta, membresías).
     - variables: Total de gastos variables durante el mes (ej. compras, pagos móviles).
     **Nota**: La suma de 'gastos.fijos' y 'gastos.variables' debe ser igual a 'total_debitos'.

3. **promedio_mensual**: Un objeto que contenga:
   - promedio_ingresos_fijos: Promedio mensual de ingresos fijos.
   - promedio_ingresos_variables: Promedio mensual de ingresos variables.
   - promedio_gastos_fijos: Promedio mensual de gastos fijos.
   - promedio_gastos_variables: Promedio mensual de gastos variables.
   - disponibilidad_economica: Promedio de la diferencia entre créditos y débitos totales. Se calcula como: (promedio_creditos - promedio_debitos).
   **Nota**: El promedio de créditos es la suma de 'total_creditos' a lo largo de los meses analizados dividido por la cantidad de meses. El promedio de débitos es la suma de 'total_debitos' a lo largo de los meses analizados dividido por la cantidad de meses.

Analiza los siguientes estados de cuenta bancarios y responde en formato JSON. Asegúrate de que los datos cuadren correctamente.
`.trim();
