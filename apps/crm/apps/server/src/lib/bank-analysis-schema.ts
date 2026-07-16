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
	// Nullable e informativo: no debe tumbar el análisis core; días acotados a 1-31 enteros
	analisis_fecha_pago: z
		.object({
			dias_ingreso_detectados: z.array(z.number().int().min(1).max(31)),
			dia_pago_sugerido: z.number().int().min(1).max(31),
			justificacion: z.string(),
		})
		.nullable(),
});

export type BankStatementAnalysis = z.infer<typeof bankStatementAnalysisSchema>;

export const BANK_ANALYSIS_PROMPT = `
Eres un analista de capacidad de pago para una financiera que otorga créditos para la compra de vehículos. Tu tarea es analizar los estados de cuenta bancarios de un solicitante y extraer la información relevante para evaluar su capacidad de pago. Debes responder en formato JSON con los siguientes campos:

1. **datos_generales**: Un objeto que contenga:
   - nombre_cuentahabiente: Nombre completo del cuentahabiente.
   - numero_cuenta: Número de cuenta bancaria (si hay múltiples cuentas, sepáralas con " / ").
   - tipo_cuenta: Tipo de cuenta (monetaria, ahorros, etc.). Si hay múltiples, sepáralas con " / ".

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

4. **analisis_fecha_pago**: Determina la fecha ideal de pago según CUÁNDO recibe ingresos el solicitante, analizando las FECHAS de las transacciones de crédito (no solo los totales). Devuelve:
   - dias_ingreso_detectados: Días del mes (1-31) en que se repiten sus ingresos recurrentes. Si es quincena, incluye ambos (ej. [15, 30]).
   - dia_pago_sugerido: Día del mes (1-31) para la cuota, entre 1 y 5 días después de su ingreso recurrente de mayor monto, para no caer donde el dinero ya se gastó. En quincena, elige la que deje más liquidez. Devuelve el día real, no un valor fijo.
   - justificacion: 1-2 frases justificando el día según el patrón detectado. Si el ingreso es irregular, elige el día más conservador y acláralo; no inventes precisión.

## IMPORTANTE: Múltiples cuentas bancarias del mismo titular

Si los estados de cuenta provienen de MÚLTIPLES bancos o cuentas del mismo titular, debes:

1. **Detectar transferencias entre cuentas propias**: Las transferencias entre cuentas del mismo titular (ej. ACH entre BAC y G&T del mismo nombre) NO son ingresos ni gastos reales. Son simplemente movimiento de dinero entre cuentas propias.
   - Ejemplos comunes: "DEBITO ACH IFT" en una cuenta que corresponde a "CREDITO ACH [NOMBRE_TITULAR]" en otra cuenta.
   - Transferencias electrónicas entre cuentas propias (TEF, ACH) donde el remitente y destinatario son el mismo titular.

2. **Excluir transferencias inter-cuenta**: NO incluyas estas transferencias en total_creditos ni total_debitos. Solo cuenta el dinero que ENTRA o SALE del sistema de cuentas del titular (depósitos de terceros, sueldos, pagos a comercios, retiros, etc.).

3. **Consolidar por mes**: Si hay estados de cuenta de múltiples bancos para el mismo mes, genera UN SOLO objeto por mes con los totales consolidados (ya sin transferencias inter-cuenta). Los saldos iniciales y finales deben ser la suma de ambas cuentas.

4. **Siempre generar un máximo de 3 meses** en el resumen_mensual, correspondientes a los 3 meses calendario que aparecen en los estados de cuenta.

Analiza los siguientes estados de cuenta bancarios y responde en formato JSON. Asegúrate de que los datos cuadren correctamente.
`.trim();
