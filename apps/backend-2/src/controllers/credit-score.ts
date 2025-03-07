import { getCreditScoreAndRecordByLeadEmail as getCreditScoreAndRecordByLeadEmailQuery } from "../database/queries/landing";
import { DATA_SCIENCE_ENVIRONMENTS } from "../utils/constants";

const environment = process.env.NODE_ENV || "DEV";
interface ClientData {
  PRECIO_PRODUCTO: number;
  SUELDO: number;
  EDAD: number;
  DEPENDIENTES_ECONOMICOS: number;
  OCUPACION: number;
  ANTIGUEDAD: number;
  ESTADO_CIVIL: number;
  UTILIZACION_DINERO: number;
  VIVIENDA_PROPIA: number;
  VEHICULO_PROPIO: number;
  TARJETA_DE_CREDITO: number;
  TIPO_DE_COMPRAS: number;
}
interface CreditScoreResponse {
  fit: boolean;
  probability: number;
}

export const predictMissingPayments = async (data: ClientData) => {
  try {
    const response = await fetch(
      environment === "PROD"
        ? DATA_SCIENCE_ENVIRONMENTS.PROD + "/predict"
        : DATA_SCIENCE_ENVIRONMENTS.DEV + "/predict",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      }
    );

    if (!response.ok) {
      console.error(
        "Error response from data science API:",
        response.status,
        response.statusText
      );
      throw new Error(
        `Data science API error: ${response.status} ${response.statusText}`
      );
    }

    const result = (await response.json()) as CreditScoreResponse;
    console.log("Result:", result);
    return result;
  } catch (error: any) {
    console.error("Error calling data science API:", error);
    throw new Error(`Failed to predict missing payments: ${error.message}`);
  }
};

export const getCreditScoreAndRecordByLeadEmail = async (email: string) => {
  const result = await getCreditScoreAndRecordByLeadEmailQuery(email);
  return result;
};
