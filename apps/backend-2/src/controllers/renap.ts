import {
  RENAP_API_URL,
  CENTINELA_API_KEY,
  CLOUDFRONT_URL,
} from "../utils/constants";

export interface RenapResponse {
  success: boolean;
  data: {
    dpi: string;
    firstName: string;
    secondName: string;
    thirdName: string;
    firstLastName: string;
    secondLastName: string;
    marriedLastName: string;
    picture: string;
    birthDate: string;
    gender: "M" | "F";
    civil_status: "S" | "C"; // Add other possible values if needed
    nationality: string;
    borned_in: string;
    department_borned_in: string;
    municipality_borned_in: string;
    deathDate: string;
    ocupation: string;
    cedula_order: string;
    cedula_register: string;
    dpi_expiracy_date: string;
  };
  status: number;
  message: string;
  error: string | null;
}

export const getRenapData = async (dpi: string): Promise<RenapResponse> => {
  const response = await fetch(RENAP_API_URL + `?dpi=${dpi}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CENTINELA_API_KEY}`,
    },
  });
  const data = (await response.json()) as RenapResponse;
  return {
    ...data,
    error: null,
    data: {
      ...data.data,
      picture: data.data.picture.replace(
        "https://funtec-uploads.s3.amazonaws.com/",
        CLOUDFRONT_URL
      ),
    },
  };
};
