import { ClientesService } from "../services/clientes.service";
import { AppError } from "../middleware/error.middleware";

const clientesService = new ClientesService();

export async function handleClientesRoute(
  request: Request,
  path: string[]
): Promise<Response> {
  const method = request.method;

  // GET /api/clientes
  if (method === "GET" && path.length === 2) {
    const url = new URL(request.url);
    const limite = parseInt(url.searchParams.get("limite") || "50");
    const pagina = parseInt(url.searchParams.get("pagina") || "1");

    const result = await clientesService.listarClientes(limite, pagina);

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // GET /api/clientes/:id
  if (method === "GET" && path.length === 3) {
    const clienteId = path[2];
    const result = await clientesService.obtenerCliente(clienteId);

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // GET /api/clientes/:id/cuentas
  if (method === "GET" && path.length === 4 && path[3] === "cuentas") {
    const clienteId = path[2];
    const result = await clientesService.obtenerCuentasCliente(clienteId);

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // GET /api/clientes/:id/historial-crediticio
  if (
    method === "GET" &&
    path.length === 4 &&
    path[3] === "historial-crediticio"
  ) {
    const clienteId = path[2];
    const result = await clientesService.obtenerHistorialCrediticio(clienteId);

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // GET /api/clientes/:id/documentos
  if (method === "GET" && path.length === 4 && path[3] === "documentos") {
    const clienteId = path[2];
    const result = await clientesService.obtenerDocumentosCliente(clienteId);

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // POST /api/clientes/buscar
  if (method === "POST" && path.length === 3 && path[2] === "buscar") {
    const body = await request.json();
    const { numeroIdentificacion } = body;

    if (!numeroIdentificacion) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "numeroIdentificacion es requerido",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const result = await clientesService.buscarClientes(numeroIdentificacion);

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // POST /api/clientes/validar
  if (method === "POST" && path.length === 3 && path[2] === "validar") {
    const body = await request.json();
    const { tipoIdentificacion, numeroIdentificacion } = body;

    if (tipoIdentificacion === undefined || !numeroIdentificacion) {
      throw new AppError(
        "tipoIdentificacion and numeroIdentificacion are required",
        400
      );
    }

    const result = await clientesService.validarCliente(
      typeof tipoIdentificacion === "string"
        ? parseInt(tipoIdentificacion)
        : tipoIdentificacion,
      numeroIdentificacion
    );

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // POST /api/clientes
  if (method === "POST" && path.length === 2) {
    const body = await request.json();
    const result = await clientesService.crearCliente(body);

    return new Response(JSON.stringify(result), {
      status: result.success ? 201 : 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // POST /api/clientes/:id/documentos
  if (method === "POST" && path.length === 4 && path[3] === "documentos") {
    const clienteId = path[2];
    const body = await request.json();
    const result = await clientesService.agregarDocumentoCliente(
      clienteId,
      body
    );

    return new Response(JSON.stringify(result), {
      status: result.success ? 201 : 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // PUT /api/clientes/:id
  if (method === "PUT" && path.length === 3) {
    const clienteId = path[2];
    const body = await request.json();
    const result = await clientesService.actualizarCliente(clienteId, body);

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (method === "POST" && path.length === 3 && path[2] === "consultar-email") {
    try {
      const result = await clientesService.consultarClientesPorEmail();

      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 400,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      console.error("❌ Error en ruta consultar-email:", err);
      return new Response(
        JSON.stringify({
          success: false,
          error: `[ERROR] Falló la ruta consultar-email: ${err.message || err}`,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }
  // POST /api/clientes/prestamos
if (method === 'POST' && path.length === 3 && path[2] === 'prestamos') {
  try {
    const body = await request.json();
    const { clienteCodigo } = body;

    if (!clienteCodigo) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'clienteCodigo es requerido',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const result = await clientesService.consultarPrestamosPorCliente(
      parseInt(clienteCodigo, 10)
    );

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('❌ Error en ruta prestamos:', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: `[ERROR] Falló la ruta prestamos: ${err.message || err}`,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}


  throw new AppError(`Route not found: ${method} ${path.join("/")}`, 404);
}
