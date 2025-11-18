import { treaty } from "@elysiajs/eden";
import type { App } from "@repo/backend-2";
import { Buffer } from "buffer";

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
import { BACKEND_ENVIRONMENTS } from "../utils/constants";
const environment = import.meta.env.APP_ENV || "DEV";
const client = treaty<App>(
  environment === "production"
    ? BACKEND_ENVIRONMENTS.PROD
    : BACKEND_ENVIRONMENTS.DEV
);

export const healthCheck = async () => {
  const response = await client.landing.get();
  return response.data;
};

// Auth
export const register = async (email: string, password: string) => {
  const response = await client.auth.register.post({ email, password });
  return response.data;
};

// Add this after the register function
export const login = async (email: string, password: string) => {
  const response = await client.auth.login.post({ email, password });
  return response.data;
};

export const verifyToken = async (token: string) => {
  const response = await client.auth["verify-token"].post({ token });
  return response.data;
};

// Landing
export const getLanding = async () => {
  const response = await client.landing.get();
  return response.data;
};

export const submitLead = async ({
  email,
  phone,
  name,
  desiredAmount,
}: {
  email: string;
  phone: string;
  name: string;
  desiredAmount: number;
}) => {
  const response = await client.landing["submit-lead"].post({
    email,
    phone,
    name,
    desiredAmount,
  });
  return response.data;
};

export const getRenapData = async (dpi: string) => {
  const response = await client.landing["renap-data"]({ id: dpi }).get();
  return response.data;
};

export const checkCreditRecord = async (files: File[], leadId: number) => {
  const convertFileToBase64 = async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    return Buffer.from(buffer).toString("base64");
  };

  const file1Base64 = await convertFileToBase64(files[0]);
  const file2Base64 = await convertFileToBase64(files[1]);
  const file3Base64 = await convertFileToBase64(files[2]);

  const response = await client.landing["check-credit-record"].post({
    file1: file1Base64,
    file2: file2Base64,
    file3: file3Base64,
    leadId,
  });
  return response.data;
};

export const predictMissingPayments = async (data: ClientData) => {
  const response = await client.landing["predict-missing-payments"].post(data);
  return response.data;
};

export const createCreditScore = async (
  creditRecordId: number,
  fit: boolean,
  probability: number
) => {
  const response = await client.landing["create-credit-score"].post({
    creditRecordId,
    fit,
    probability,
  });
  return response.data;
};
export const pollCreditRecords = async () => {
  const response = await client.landing["poll-credit-records"].get();
  return response.data;
};

export const getCreditScoreAndRecordByLeadEmail = async (email: string) => {
  const response = await client.landing[
    "get-credit-score-and-record-by-lead-email"
  ]({ email }).get();
  return response.data;
};

export const createCrmPerson = async (
  email: string,
  firstName: string,
  lastName: string,
  city: string,
  avatarUrl: string
) => {
  const response = await client.crm["create-person"].post({
    email,
    firstName,
    lastName,
    city,
    avatarUrl,
  });
  if (response.status === 200) {
    return response.data;
  } else {
    throw new Error(response.data?.message || "Error creating person");
  }
};

export const sendDocumentsForSignature = async (emails: string[]) => {
  const response = await client.signatures.requestSignature.post({
    emails,
  });
  return response.data;
};

interface Vehicle {
  name: string;
  marca: string;
  modelo: string;
  ano: number;
  revisor: { firstName: string; lastName: string };
  detalles: Record<string, any>;
}

export const createVehicle = async (vehicle: Vehicle) => {
  const response = await client.crm["create-vehicle"].post(vehicle);
  return response.data;
};
