import OpenAI from "openai";
import {
  createOpenaiRun,
  getAllPendingOpenaiRuns,
  setOpenaiRunCompleted,
} from "../database/queries/openai";
import { PV } from "../utils/math";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const creditRecordSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    datos_generales: {
      type: "object",
      additionalProperties: false,
      properties: {
        nombre_cuentahabiente: { type: "string" },
        numero_cuenta: { type: "string" },
        tipo_cuenta: { type: "string" },
      },
      required: ["nombre_cuentahabiente", "numero_cuenta", "tipo_cuenta"],
    },
    resumen_mensual: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          mes: { type: "string" },
          saldo_inicial: { type: "number" },
          total_debitos: { type: "number" },
          total_creditos: { type: "number" },
          saldo_final: { type: "number" },
          ingresos: {
            type: "object",
            additionalProperties: false,
            properties: {
              fijos: { type: "number" },
              variables: { type: "number" },
            },
            required: ["fijos", "variables"],
          },
          gastos: {
            type: "object",
            additionalProperties: false,
            properties: {
              fijos: { type: "number" },
              variables: { type: "number" },
            },
            required: ["fijos", "variables"],
          },
        },
        required: [
          "mes",
          "saldo_inicial",
          "total_debitos",
          "total_creditos",
          "saldo_final",
          "ingresos",
          "gastos",
        ],
      },
    },
    promedio_mensual: {
      type: "object",
      additionalProperties: false,
      properties: {
        promedio_ingresos_fijos: { type: "number" },
        promedio_ingresos_variables: { type: "number" },
        promedio_gastos_fijos: { type: "number" },
        promedio_gastos_variables: { type: "number" },
        disponibilidad_economica: { type: "number" },
      },
      required: [
        "promedio_ingresos_fijos",
        "promedio_ingresos_variables",
        "promedio_gastos_fijos",
        "promedio_gastos_variables",
        "disponibilidad_economica",
      ],
    },
  },
  required: ["datos_generales", "resumen_mensual", "promedio_mensual"],
};
const prompt = `
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
     **Nota**: El promedio de créditos es la suma de 'total_creditos' a lo largo de los 3 meses dividido por 3. El promedio de débitos es la suma de 'total_debitos' a lo largo de los 3 meses dividido por 3.
  
  Analiza los siguientes estados de cuenta bancarios y responde en formato JSON. Asegúrate de que los datos cuadren correctamente:
  `;
const assistant = await openai.beta.assistants.create({
  model: "gpt-4o",
  name: "Analista de capacidad de pago y evaluador de crédito",
  description:
    "Analiza los estados de cuenta bancarios y responde en formato JSON",
  tools: [{ type: "file_search" }],
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "credit_record",
      strict: true,
      schema: creditRecordSchema,
    },
  },
  instructions: prompt,
});
export const queueCreditRecord = async (files: File[], leadId: number) => {
  try {
    const uploadedFiles: OpenAI.Files.FileObject[] = [];
    for (const [_index, file] of files.entries()) {
      const filename = `statement_${_index + 1}.pdf`;
      const newFile = new File([file], filename);
      const uploadedFile = await openai.files.create({
        file: newFile,
        purpose: "assistants",
      });
      uploadedFiles.push(uploadedFile);
    }
    const fileIds = uploadedFiles.map((file) => file.id);

    const thread = await openai.beta.threads.create();

    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: prompt,
      attachments: [
        {
          file_id: fileIds[0],
          tools: [{ type: "file_search" }],
        },
        {
          file_id: fileIds[1],
          tools: [{ type: "file_search" }],
        },
        {
          file_id: fileIds[2],
          tools: [{ type: "file_search" }],
        },
      ],
    });

    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistant.id,
    });
    await createOpenaiRun({
      leadId: leadId,
      threadId: thread.id,
      runId: run.id,
    });
    return {
      success: true,
      message: "Archivos subidos correctamente",
      data: null,
      error: null,
    };
  } catch (error) {
    console.error("Error al subir los archivos:", error);
    return {
      success: false,
      message: "Error al subir los archivos",
      data: null,
      error: error,
    };
  }
};
interface CreditRecord {
  datos_generales: {
    tipo_cuenta: string;
    numero_cuenta: string;
    nombre_cuentahabiente: string;
  };
  resumen_mensual: {
    mes: string;
    saldo_inicial: number;
    total_debitos: number;
    total_creditos: number;
    saldo_final: number;
  }[];
  promedio_mensual: {
    promedio_ingresos_fijos: number;
    promedio_ingresos_variables: number;
    promedio_gastos_fijos: number;
    promedio_gastos_variables: number;
    disponibilidad_economica: number;
  };
}
export const pollCreditRecords = async () => {
  const pendingRuns = await getAllPendingOpenaiRuns();
  if (pendingRuns.length < 1) {
    return;
  }
  const results: { [key: string]: CreditRecord } = {};
  for (const pendingRun of pendingRuns) {
    if (!pendingRun.leadId) {
      continue;
    }
    if (pendingRun.threadId && pendingRun.runId) {
      const run = await openai.beta.threads.runs.retrieve(
        pendingRun.threadId,
        pendingRun.runId
      );
      if (run.status === "completed") {
        const messages = await openai.beta.threads.messages.list(
          pendingRun.threadId
        );
        const message = messages.getPaginatedItems()[0];
        if (message.content[0].type === "text") {
          try {
            const result = JSON.parse(message.content[0].text.value);
            if (
              result.datos_generales &&
              result.resumen_mensual &&
              result.promedio_mensual
            ) {
              results[pendingRun.leadId] = {
                datos_generales: {
                  tipo_cuenta: result.datos_generales.tipo_cuenta as string,
                  numero_cuenta: result.datos_generales.numero_cuenta as string,
                  nombre_cuentahabiente: result.datos_generales
                    .nombre_cuentahabiente as string,
                },
                resumen_mensual: result.resumen_mensual.map((mes: any) => ({
                  mes: mes.mes as string,
                  gastos: {
                    fijos: mes.gastos.fijos as number,
                    variables: mes.gastos.variables as number,
                  },
                  ingresos: {
                    fijos: mes.ingresos.fijos as number,
                    variables: mes.ingresos.variables as number,
                  },
                  saldo_final: mes.saldo_final as number,
                  saldo_inicial: mes.saldo_inicial as number,
                  total_debitos: mes.total_debitos as number,
                  total_creditos: mes.total_creditos as number,
                })),
                promedio_mensual: {
                  promedio_gastos_fijos: result.promedio_mensual
                    .promedio_gastos_fijos as number,
                  promedio_ingresos_fijos: result.promedio_mensual
                    .promedio_ingresos_fijos as number,
                  disponibilidad_economica: result.promedio_mensual
                    .disponibilidad_economica as number,
                  promedio_gastos_variables: result.promedio_mensual
                    .promedio_gastos_variables as number,
                  promedio_ingresos_variables: result.promedio_mensual
                    .promedio_ingresos_variables as number,
                },
              };
            } else {
              console.error("Invalid result format:", result);
            }
            await setOpenaiRunCompleted(pendingRun.id);
          } catch (error) {
            console.error("Error parsing result:", error);
          }
        }
      } else {
        console.log("Run status:", run.status);
      }
    }
  }
  return results;
};
const supportData = {
  debtRatio: {
    low: 0.3,
    medium: 0.4,
    high: 0.6,
  },
};
export const checkCreditRecord = async (creditRecord: CreditRecord) => {
  const result = creditRecord;
  if (!result) {
    return;
  }
  let guaranteedIncome = 0;
  //const variableIncome = 0;
  let fixedExpenses = 0;
  //const variableExpenses = 0.3;
  for (const month of result.resumen_mensual) {
    guaranteedIncome += month.total_creditos;
    fixedExpenses += month.total_debitos;
  }
  guaranteedIncome = guaranteedIncome / 3;
  fixedExpenses = fixedExpenses / 3;
  // const availability = result.promedio_mensual.disponibilidad_economica;
  // Method 1: Free flux
  const freeFlux = guaranteedIncome - fixedExpenses;
  const percentageOfFreeFlux = freeFlux / guaranteedIncome;
  let method1Availability = "low";
  if (percentageOfFreeFlux < supportData.debtRatio.low) {
    method1Availability = "high";
  } else if (percentageOfFreeFlux < supportData.debtRatio.medium) {
    method1Availability = "medium";
  } else {
    method1Availability = "low";
  }
  console.log("Method 1 availability:", method1Availability);
  // Method 2: Based on income
  const maxDebtRatio = 0.2;
  const maxAmountOfDebt = maxDebtRatio * (guaranteedIncome * 0.5);
  const currentAmountOfDebt = 0;
  const method2MaxAmount = maxAmountOfDebt - currentAmountOfDebt;
  // Method 3: Based on a variable expense
  const maxVariableDebtAsExpenseRatio = 0.3;
  const maxVariableDebtAsExpense =
    maxVariableDebtAsExpenseRatio * fixedExpenses;
  const method3MaxAmount = maxVariableDebtAsExpense - currentAmountOfDebt;
  // Estimation total credit
  const minPayment = Math.min(method2MaxAmount, method3MaxAmount);
  const maxPayment = Math.max(method2MaxAmount, method3MaxAmount);
  const maxAdjustedPayment =
    (freeFlux + method2MaxAmount + method3MaxAmount) / 3;
  const anualTaxRatio = 0.18;
  const totalMonths = 60;
  const maximumCredit = PV(
    anualTaxRatio / 12,
    totalMonths,
    method2MaxAmount,
    undefined,
    0
  );
  return {
    minPayment,
    maxPayment,
    maxAdjustedPayment,
    maximumCredit,
  };
};
