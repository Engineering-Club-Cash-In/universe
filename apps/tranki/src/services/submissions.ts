import type { Lead } from "@repo/backend/landingSchemas";
import trpc from "./trpc";
import { convertFileToBase64 } from "@/utils/functions";

export const createLead = async (lead: Lead) => {
  const { name, desiredAmount, email, phone } = lead;
  const response = await trpc.submitLead.mutate({
    name: name ?? "",
    desiredAmount: desiredAmount ?? 0,
    email: email ?? "",
    phone: phone ?? "",
  });
  return response;
};

export const getRenapData = async (dpi: string) => {
  const response = await trpc.getRenapData.query(dpi);
  return response;
};

export const checkCreditRecord = async (leadId: number, files: File[]) => {
  // Convert files to base64
  console.log(files);
  const file1 = (await convertFileToBase64(files[0])) as string;
  const file2 = (await convertFileToBase64(files[1])) as string;
  const file3 = (await convertFileToBase64(files[2])) as string;
  const response = await trpc.getCreditRecord.mutate({
    leadId,
    file1,
    file2,
    file3,
  });
  return response;
};

export const pollCreditRecord = async () => {
  const response = await trpc.pollCreditRecord.query();
  return response;
};
