import axios from "axios";

const API_BASE = process.env.CLIENTES_API_URL;

if (!API_BASE) {
  throw new Error("[ERROR] CLIENTES_API_URL is not set in env");
}

export class ClientesApiService {
  // GET /api/clientes?limite=50&pagina=1
  static async listarClientes(limite = 50, pagina = 1) {
    const url = `${API_BASE}?limite=${limite}&pagina=${pagina}`;
    const res = await axios.get(url);
    return res.data;
  }

  // GET /api/clientes/:id
  static async obtenerCliente(clienteId: string) {
    const url = `${API_BASE}/${clienteId}`;
    const res = await axios.get(url);
    return res.data;
  }

  // GET /api/clientes/:id/cuentas
  static async obtenerCuentasCliente(clienteId: string) {
    const url = `${API_BASE}/${clienteId}/cuentas`;
    const res = await axios.get(url);
    return res.data;
  }

  // GET /api/clientes/:id/historial-crediticio
  static async obtenerHistorialCrediticio(clienteId: string) {
    const url = `${API_BASE}/${clienteId}/historial-crediticio`;
    const res = await axios.get(url);
    return res.data;
  }

  // GET /api/clientes/:id/documentos
  static async obtenerDocumentosCliente(clienteId: string) {
    const url = `${API_BASE}/${clienteId}/documentos`;
    const res = await axios.get(url);
    return res.data;
  }

  // POST /api/clientes/buscar
  static async buscarClientes(body: any) {
    const url = `${API_BASE}/buscar`;
    const res = await axios.post(url, body);
    return res.data;
  }

  // POST /api/clientes/validar
  static async validarCliente(tipoIdentificacion: string, numeroIdentificacion: string) {
    const url = `${API_BASE}/validar`;
    const res = await axios.post(url, { tipoIdentificacion, numeroIdentificacion });
    return res.data;
  }

  // POST /api/clientes
  static async crearCliente(body: any) {
    const url = `${API_BASE}`;
    const res = await axios.post(url, body);
    return res.data;
  }

  // POST /api/clientes/:id/documentos
  static async agregarDocumentoCliente(clienteId: string, body: any) {
    const url = `${API_BASE}/${clienteId}/documentos`;
    const res = await axios.post(url, body);
    return res.data;
  }

  // PUT /api/clientes/:id
  static async actualizarCliente(clienteId: string, body: any) {
    const url = `${API_BASE}/${clienteId}`;
    const res = await axios.put(url, body);
    return res.data;
  }
}
