import type { FormLeadsValues } from "../hooks/useForm";

export const sendLead = async (data: FormLeadsValues): Promise<{ ok: boolean }> => {
  // Simulamos un delay de red
  await new Promise((resolve) => setTimeout(resolve, 1000));
  
  // Simulamos el envío - siempre devuelve ok aunque no haya API
  console.log("Lead enviado:", data);
  
  // Simulamos una respuesta exitosa
  return { ok: true };
};
