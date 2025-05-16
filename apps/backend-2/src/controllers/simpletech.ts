import {
  findDuplicateLeads,
  insertLead,
  updateLeadByCrmId,
  getLeadByCrmId,
  insertCreditScore,
  insertCreditProfile,
  updateCreditProfile,
  getCreditProfileByLeadId,
  getLead,
} from "../database/queries/simpletech";
import { Lead } from "../database/schemas/simpletech";
import { predictMissingPayments } from "./credit-score";
import { uploadFile, getSignedUrl } from "../lib/supabase";
import { urlToFile } from "../utils/files";
import {
  checkCreditRecord,
  pollCreditRecords,
  queueCreditRecord,
} from "../lib/openai";
import { uploadFromSupabaseUrl } from "../lib/twenty-graphql";
interface CreateOnePersonaResponse {
  data: {
    createPersona: {
      id: string;
      name: string;
      createdAt: string;
      updatedAt: string;
      deletedAt: string;
      createdBy: {
        source: string;
      };
      position: number;
      edad: string;
      estadoCivil: string;
      dependientesEconomicos: number;
      ingresosNominales: number;
      montoAFinanciar: number;
      ocupacion: "PROPIETARIO" | "COLABORADOR";
      tiempoEnElTrabajo: "ONETOFIVE" | "FIVETOTEN" | "TENPLUS";
      utilizacionDelDinero: "PERSONAL" | "TRABAJO";
      viviendaPropia: boolean;
      vehiculoPropio: boolean;
      tarjetaDeCredito: boolean;
      timelineActivities: Array<object>;
      taskTargets: Array<object>;
      favorites: Array<object>;
      noteTargets: Array<object>;
      attachments: Array<object>;
    };
  };
}
interface DuplicatePersonaResponse {
  data: {
    totalCount: number;
    pageInfo: {
      hasNextPage: boolean;
      startCursor: string;
      endCursor: string;
    };
    companyDuplicates: {
      id: string;
      name: string;
      createdAt: string;
      updatedAt: string;
      deletedAt: string;
      createdBy: {
        source: string;
      };
      position: number;
      edad: string;
      estadoCivil: string;
      dependientesEconomicos: number;
      ingresosNominales: number;
      montoAFinanciar: number;
      ocupacion: "PROPIETARIO" | "COLABORADOR";
      tiempoEnElTrabajo: "ONETOFIVE" | "FIVETOTEN" | "TENPLUS";
      utilizacionDelDinero: "PERSONAL" | "TRABAJO";
      viviendaPropia: boolean;
      vehiculoPropio: boolean;
      tarjetaDeCredito: boolean;
      numeroDeTelefono: {
        dpi: string;
      };
    }[];
  };
}

const API_KEY = process.env.CRM_API_KEY;

export const createLead = async (phone: string): Promise<string | Error> => {
  try {
    // 1. Check for duplicates
    const duplicateDBLead = await findDuplicateLeads(phone);
    if (duplicateDBLead.length > 0) {
      return duplicateDBLead[0].crmId;
    }

    // 2. If no duplicate, create a new persona
    const response = await fetch(
      "https://crm.devteamatcci.site/rest/personas",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          numeroDeTelefono: {
            primaryPhoneNumber: phone,
          },
          createdBy: {
            source: "API",
          },
        }),
      }
    );
    const raw = await response.json();
    const responseData = raw.data;
    if (
      !responseData ||
      !responseData.createPersona ||
      !responseData.createPersona.id
    ) {
      console.error("Unexpected CRM response:", raw);
      throw new Error("Failed to create persona in CRM");
    }
    const dbLead = await insertLead({
      crmId: responseData.createPersona.id,
      phone,
    });
    return dbLead[0].crmId;
  } catch (error) {
    console.error(error);
    return error as Error;
  }
};

interface FillPersonaFields {
  leadId: string;
  name: string;
  age: number;
  civilStatus: string;
  economicDependents: number;
  monthlyIncome: number;
  amountToFinance: number;
  ocupation: "PROPIETARIO" | "COLABORADOR";
  timeEmployed: "ONETOFIVE" | "FIVETOTEN" | "TENPLUS";
  moneyPurpose: "PERSONAL" | "TRABAJO";
  documentNumber: string;
  ownsHouse: boolean;
  ownsVehicle: boolean;
  hasCreditCard: boolean;
}
interface FillPersonaFieldsResponse {
  data: {
    updatePersona: {
      id: string;
      name: string;
      createdAt: string;
      updatedAt: string;
      deletedAt: string | null;
      createdBy: {
        position: number;
      };
      edad: string;
      estadoCivil: string;
      dependientesEconomicos: number;
      ingresosNominales: number;
      montoAFinanciar: number;
      ocupacion: "PROPIETARIO" | "COLABORADOR";
      tiempoEnElTrabajo: "ONETOFIVE" | "FIVETOTEN" | "TENPLUS";
      utilizacionDelDinero: "PERSONAL" | "TRABAJO";
      viviendaPropia: boolean;
      vehiculoPropio: boolean;
      tarjetaDeCredito: boolean;
      numeroDeTelefono: {
        additionalPhones: string[];
        primaryPhoneCountryCode: string;
        primaryPhoneCallingCode: string;
        primaryPhoneNumber: string;
      };
    };
  };
}
export const fillPersonaFields = async ({
  leadId,
  name,
  age,
  civilStatus,
  economicDependents,
  documentNumber,
  monthlyIncome,
  amountToFinance,
  ocupation,
  timeEmployed,
  moneyPurpose,
  ownsHouse,
  ownsVehicle,
  hasCreditCard,
}: FillPersonaFields): Promise<String | Error> => {
  try {
    const response = await fetch(
      `https://crm.devteamatcci.site/rest/personas/${leadId}`,
      {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          edad: age,
          estadoCivil: civilStatus,
          dependientesEconomicos: economicDependents,
          dpi: documentNumber,
          ingresosNominales: monthlyIncome,
          montoAFinanciar: amountToFinance,
          name,
          ocupacion: ocupation,
          tiempoEnElTrabajo: timeEmployed,
          utilizacionDelDinero: moneyPurpose,
          viviendaPropia: ownsHouse,
          vehiculoPropio: ownsVehicle,
          tarjetaDeCredito: hasCreditCard,
        }),
      }
    );
    const uptdatedDbLead = await updateLeadByCrmId({
      crmId: leadId,
      name,
      age,
      civilStatus,
      economicDependents,
      monthlyIncome,
      financingAmount: amountToFinance,
      occupation: ocupation,
      workTime: timeEmployed,
      moneyUsage: moneyPurpose,
      hasOwnHouse: ownsHouse,
      hasOwnVehicle: ownsVehicle,
      hasCreditCard,
      documentNumber,
      updatedAt: new Date(),
    });
    return uptdatedDbLead[0].crmId;
  } catch (error) {
    console.error(error);
    return error as Error;
  }
};

export const createLeadCreditScore = async (crmId: string) => {
  const lead = await getLeadByCrmId(crmId);
  const clientData = mapLeadToClientData(lead[0]);
  if (!clientData) {
    throw new Error("Lead is missing required fields for credit scoring");
  }
  const creditScore = await predictMissingPayments(clientData);
  const creditScoreDB = await insertCreditScore({
    leadId: lead[0].id,
    fit: creditScore.fit,
    probability: creditScore.probability,
  });
  return creditScoreDB[0];
};

export const createCreditProfile = async (
  crmId: string,
  firstStatementUrl: string,
  secondStatementUrl: string,
  thirdStatementUrl: string
) => {
  try {
    const lead = await getLeadByCrmId(crmId);
    if (!lead) {
      throw new Error("Lead not found");
    }
    // Lets move them from their storage to our storage
    const firstStatementFile = await urlToFile(firstStatementUrl);
    const secondStatementFile = await urlToFile(secondStatementUrl);
    const thirdStatementFile = await urlToFile(thirdStatementUrl);
    const firstStatementPath = await uploadFile(firstStatementFile);
    const secondStatementPath = await uploadFile(secondStatementFile);
    const thirdStatementPath = await uploadFile(thirdStatementFile);
    if (!firstStatementPath || !secondStatementPath || !thirdStatementPath) {
      throw new Error("Failed to upload statements");
    }
    // Upload the files to the CRM
    const firstCRMUrl = uploadFromSupabaseUrl(firstStatementPath);
    const secondCRMUrl = uploadFromSupabaseUrl(secondStatementPath);
    const thirdCRMUrl = uploadFromSupabaseUrl(thirdStatementPath);
    const [firstCRMUrlResponse, secondCRMUrlResponse, thirdCRMUrlResponse] =
      await Promise.all([firstCRMUrl, secondCRMUrl, thirdCRMUrl]);
    // Upload the attachments in the CRM
    const promises = [];
    for (let i = 0; i < 3; i++) {
      promises.push(
        fetch(`https://crm.devteamatcci.site/rest/attachments`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: `estado_de_cuenta_${i + 1}_${lead[0].documentNumber}`,
            fullPath:
              i === 0
                ? firstCRMUrlResponse
                : i === 1
                  ? secondCRMUrlResponse
                  : thirdCRMUrlResponse,
            type: "TextDocument",
            authorId: "f81dd5cd-3335-4f95-bf51-c58069d55b16",
            personaId: lead[0].crmId,
          }),
        })
      );
    }
    const responses = await Promise.all(promises);
    // Check if all responses are successful
    if (responses.some((response) => response.status > 399)) {
      for (const response of responses) {
        if (response.status > 399) {
          const raw = await response.json();
          console.error(raw);
        }
      }
      throw new Error("Failed to upload statements");
    }
    await insertCreditProfile({
      leadId: lead[0].id,
      firstStatementUrl: firstStatementPath.split("?")[0],
      secondStatementUrl: secondStatementPath.split("?")[0],
      thirdStatementUrl: thirdStatementPath.split("?")[0],
    });
    // Queue the credit profile for analysis
    const queueResponse = await queueCreditRecord(
      [firstStatementFile, secondStatementFile, thirdStatementFile],
      lead[0].id
    );
    if (!queueResponse.success) {
      throw new Error("Failed to queue credit profile");
    }
    return queueResponse.success;
  } catch (error) {
    console.error(error);
    return error as Error;
  }
};

export const updateCompletedRuns = async () => {
  const results = await pollCreditRecords();
  if (!results) {
    return;
  }
  // For every key in results, update the credit profile
  for (const [leadId, result] of Object.entries(results)) {
    const paymentData = await checkCreditRecord(result);
    if (!paymentData) {
      continue;
    }
    await updateCreditProfile({
      leadId: parseInt(leadId),
      minPayment: paymentData.minPayment,
      maxPayment: paymentData.maxPayment,
      maxAdjustedPayment: paymentData.maxAdjustedPayment,
      maximumCredit: paymentData.maximumCredit,
      updatedAt: new Date(),
    });
    // Todo: send message to user
    // Create the oportunity
    const lead = await getLead(parseInt(leadId));
    const oportunity = await fetch(
      `https://crm.devteamatcci.site/rest/opportunities`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          leadId: lead[0].crmId,
          amount: lead[0].financingAmount,
          name: `Nueva Oportunidad: ${lead[0].name}`,
          stage: "NEW",
          createdBy: {
            source: "API",
          },
        }),
      }
    );
    if (oportunity.status > 399) {
      console.error(await oportunity.json());
      throw new Error("Failed to create oportunity");
    }
    // todo: create the task for the oportunity
  }
};
const mapLeadToClientData = (lead: Lead) => {
  if (
    lead.workTime === null ||
    lead.age === null ||
    lead.economicDependents === null ||
    lead.occupation === null ||
    lead.monthlyIncome === null ||
    lead.moneyUsage === null ||
    lead.hasOwnHouse === null ||
    lead.hasOwnVehicle === null ||
    lead.hasCreditCard === null ||
    lead.financingAmount === null ||
    lead.civilStatus === null
  ) {
    return null;
  }

  return {
    ANTIGUEDAD:
      lead.workTime === "ONETOFIVE" ? 0 : lead.workTime === "FIVETOTEN" ? 1 : 2,
    EDAD: lead.age >= 50 ? 3 : lead.age >= 40 ? 2 : lead.age >= 30 ? 1 : 0,
    DEPENDIENTES_ECONOMICOS: lead.economicDependents,
    OCUPACION: lead.occupation === "PROPIETARIO" ? 1 : 0,
    SUELDO: lead.monthlyIncome,
    UTILIZACION_DINERO: lead.moneyUsage === "PERSONAL" ? 0 : 1,
    VIVIENDA_PROPIA: lead.hasOwnHouse ? 1 : 0,
    VEHICULO_PROPIO: lead.hasOwnVehicle ? 1 : 0,
    TARJETA_DE_CREDITO: lead.hasCreditCard ? 1 : 0,
    TIPO_DE_COMPRAS: 0,
    INGRESOS_NOMINALES: lead.monthlyIncome,
    PRECIO_PRODUCTO: lead.financingAmount,
    ESTADO_CIVIL: lead.civilStatus === "SOLTERO" ? 0 : 1,
  };
};
