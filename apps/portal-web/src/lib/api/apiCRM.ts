import axios from "axios";

const API_URL_CRM = import.meta.env.VITE_CRM_API_URL;

export const apiCRM = axios.create({
  baseURL: API_URL_CRM,
  headers: {
    "Content-Type": "application/json",
  },
});
