export interface FormSubmitResponse {
  success: boolean;
  message: string;
  data: {
    name: string;
    email: string;
    message: string;
  } | null;
  error?: string;
}
