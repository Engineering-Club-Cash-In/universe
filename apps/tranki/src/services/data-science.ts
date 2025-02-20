// Define the TypeScript interface for the client data
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

export const predictMissingPayments = async (data: ClientData) => {
  const response = await fetch("http://localhost:8000/predict", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  return response.json();
};
