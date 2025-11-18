import { CreditosService } from '../services/creditos.service';
import { AppError } from '../middleware/error.middleware';

const creditosService = new CreditosService();

export async function handleCreditosRoute(request: Request, path: string[]): Promise<Response> {
  const method = request.method;

  // GET /api/creditos
  if (method === 'GET' && path.length === 2) {
    const url = new URL(request.url);
    const filtros = {
      estado: url.searchParams.get('estado') || undefined,
      sucursal: url.searchParams.get('sucursal') || undefined,
      oficial: url.searchParams.get('oficial') || undefined,
      fechaDesde: url.searchParams.get('fechaDesde') || undefined,
      fechaHasta: url.searchParams.get('fechaHasta') || undefined,
      limite: parseInt(url.searchParams.get('limite') || '50'),
      pagina: parseInt(url.searchParams.get('pagina') || '1'),
    };
    
    const result = await creditosService.listarCreditos(filtros);
    
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/creditos/:id
  if (method === 'GET' && path.length === 3) {
    const creditoId = path[2];
    const result = await creditosService.obtenerCredito(creditoId);
    
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/creditos/cliente/:clienteId
  if (method === 'GET' && path.length === 4 && path[2] === 'cliente') {
    const clienteId = path[3];
    const result = await creditosService.obtenerCreditosCliente(clienteId);
    
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/creditos/:id/estado-cuenta
  if (method === 'GET' && path.length === 4 && path[3] === 'estado-cuenta') {
    const creditoId = path[2];
    const result = await creditosService.obtenerEstadoCuenta(creditoId);
    
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/creditos/:id/amortizacion
  if (method === 'GET' && path.length === 4 && path[3] === 'amortizacion') {
    const creditoId = path[2];
    const result = await creditosService.obtenerTablaAmortizacion(creditoId);
    
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/creditos/:id/pagos
  if (method === 'GET' && path.length === 4 && path[3] === 'pagos') {
    const creditoId = path[2];
    const result = await creditosService.obtenerHistorialPagos(creditoId);
    
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/creditos/:id/cuotas
  if (method === 'GET' && path.length === 4 && path[3] === 'cuotas') {
    const creditoId = path[2];
    const result = await creditosService.verCuotasPorPrestamo(creditoId);
    
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/creditos/:id/mora
  if (method === 'GET' && path.length === 4 && path[3] === 'mora') {
    const creditoId = path[2];
    const url = new URL(request.url);
    const fechaCorte = url.searchParams.get('fechaCorte') || undefined;
    
    const result = await creditosService.calcularMora(creditoId, fechaCorte);
    
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // GET /api/creditos/:id/garantias
  if (method === 'GET' && path.length === 4 && path[3] === 'garantias') {
    const creditoId = path[2];
    const result = await creditosService.obtenerGarantias(creditoId);
    
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // POST /api/creditos/simular
  if (method === 'POST' && path.length === 3 && path[2] === 'simular') {
    const body = await request.json();
    const result = await creditosService.simularCredito(body);
    
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // POST /api/creditos/solicitud
  if (method === 'POST' && path.length === 3 && path[2] === 'solicitud') {
    const body = await request.json();
    const result = await creditosService.crearSolicitud(body);
    
    return new Response(JSON.stringify(result), {
      status: result.success ? 201 : 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // POST /api/creditos/pago
  if (method === 'POST' && path.length === 3 && path[2] === 'pago') {
    const body = await request.json();
    
    // Validar campos requeridos
    if (!body.PreNumero || !body.Fecha || !body.NumeroCuotas || !body.Monto) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Campos requeridos: PreNumero, Fecha, NumeroCuotas, Monto'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    const result = await creditosService.registrarPago(body);
    
    return new Response(JSON.stringify(result), {
      status: result.success ? 201 : 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // POST /api/creditos/:id/aprobar
  if (method === 'POST' && path.length === 4 && path[3] === 'aprobar') {
    const creditoId = path[2];
    const body = await request.json();
    const result = await creditosService.aprobarCredito(creditoId, body);
    
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // POST /api/creditos/:id/rechazar
  if (method === 'POST' && path.length === 4 && path[3] === 'rechazar') {
    const creditoId = path[2];
    const body = await request.json();
    const { motivo } = body;
    
    if (!motivo) {
      throw new AppError('Motivo is required', 400);
    }
    
    const result = await creditosService.rechazarCredito(creditoId, motivo);
    
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // POST /api/creditos/:id/desembolsar
  if (method === 'POST' && path.length === 4 && path[3] === 'desembolsar') {
    const creditoId = path[2];
    const body = await request.json();
    const result = await creditosService.desembolsarCredito(creditoId, body);
    
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // POST /api/creditos/:id/reestructurar
  if (method === 'POST' && path.length === 4 && path[3] === 'reestructurar') {
    const creditoId = path[2];
    const body = await request.json();
    const result = await creditosService.reestructurarCredito(creditoId, body);
    
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // POST /api/creditos/:id/garantias
  if (method === 'POST' && path.length === 4 && path[3] === 'garantias') {
    const creditoId = path[2];
    const body = await request.json();
    const result = await creditosService.agregarGarantia(creditoId, body);
    
    return new Response(JSON.stringify(result), {
      status: result.success ? 201 : 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // PUT /api/creditos/:id
  if (method === 'PUT' && path.length === 3) {
    const creditoId = path[2];
    const body = await request.json();
    const result = await creditosService.actualizarCredito(creditoId, body);
    
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  
// GET /api/clientes/prestamos/:preNumero
if (method === 'GET' && path.length === 4 && path[2] === 'uniqueCreditByNumber') {
  try {
    const preNumero = path[3];

    if (!preNumero) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'preNumero es requerido',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const result = await creditosService.consultarPrestamoDetalle(preNumero);

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 404,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('❌ Error en ruta prestamos/:preNumero:', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: `[ERROR] Falló la ruta prestamos/:preNumero: ${err.message || err}`,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
if (method === 'POST' && path.length === 3 && path[2] === 'cuotas') {
  try {
    const body = await request.json();
    const { numeroPrestamo } = body;

    if (!numeroPrestamo) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'numeroPrestamo es requerido',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const result = await creditosService.consultarCuotasPorPrestamo(numeroPrestamo);

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('❌ Error en ruta creditos/cuotas:', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: `[ERROR] Falló la ruta creditos/cuotas: ${err.message || err}`,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
// POST /api/creditos/recargos
if (method === 'POST' && path.length === 3 && path[2] === 'recargos') {
  try {
    const body = await request.json();
    const { numeroPrestamo } = body;

    if (!numeroPrestamo) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'numeroPrestamo es requerido',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const result = await creditosService.consultarRecargosLibres(numeroPrestamo);

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('❌ Error en ruta creditos/recargos:', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: `[ERROR] Falló la ruta creditos/recargos: ${err.message || err}`,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
// POST /api/creditos/estado-cuenta
if (method === 'POST' && path.length === 3 && path[2] === 'estado-cuenta') {
  try {
    console.log('Received request for estado-cuenta');
    const body = await request.json();
    const { numeroPrestamo } = body;

    if (!numeroPrestamo) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'numeroPrestamo es requerido',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
    console.log('Request body for estado-cuenta:', body);

    const result = await creditosService.consultarEstadoCuentaPrestamo(numeroPrestamo);
    console.log('Result from consultarEstadoCuentaPrestamo:', result);
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('❌ Error en ruta creditos/estado-cuenta:', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: `[ERROR] Falló la ruta creditos/estado-cuenta: ${err.message || err}`,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

// POST /api/creditos/informacion
if (method === 'POST' && path.length === 3 && path[2] === 'informacion') {
  try {
    const body = await request.json();
    // Permite body.identificador o body.ConsultaValorIdentificador
    const identificador =
      body?.identificador || body?.ConsultaValorIdentificador;

    if (!identificador) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'identificador (o ConsultaValorIdentificador) es requerido',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const result = await creditosService.consultarInformacionPrestamo(
      identificador
    );

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('❌ Error en ruta creditos/informacion:', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: `[ERROR] Falló la ruta creditos/informacion: ${err.message || err}`,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

  throw new AppError(`Route not found: ${method} ${path.join('/')}`, 404);


}