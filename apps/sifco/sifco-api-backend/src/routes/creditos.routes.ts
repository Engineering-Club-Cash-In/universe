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

  // GET /api/creditos/verificar-cuotas-diciembre
  // Endpoint para verificar cuotas de diciembre 2025 contra el archivo credits.txt
  // NOTA: Este endpoint debe estar ANTES de GET /api/creditos/:id para evitar que sea interceptado
  if (method === 'GET' && path.length === 3 && path[2] === 'verificar-cuotas-diciembre') {
    try {
      console.log('📋 Iniciando verificación de cuotas de diciembre 2025...');
      
      // Leer el archivo credits.txt y convertirlo en array
      const fs = await import('node:fs');
      const pathModule = await import('node:path');
      const creditsFilePath = pathModule.join(import.meta.dir, '..', 'utils', 'credits.txt');
      const creditsContent = fs.readFileSync(creditsFilePath, 'utf-8');
      
      // Parsear el archivo: cada línea tiene "numeroPrestamo\tcuotaEsperada\tplazo"
      const creditosEsperados = creditsContent
        .split('\n')
        .filter(line => line.trim() !== '')
        .map(line => {
          const [numeroPrestamo, cuotaEsperada, plazo] = line.split('\t');
          return {
            numeroPrestamo: numeroPrestamo.trim(),
            cuotaEsperadaDic2025: Number.parseInt(cuotaEsperada.trim(), 10),
            plazoCompleto: Number.parseInt(plazo.trim(), 10)
          };
        });

      console.log(`📊 Total de créditos a verificar: ${creditosEsperados.length}`);

      const discrepancias: {
        numeroPrestamo: string;
        cuotaEsperada: number;
        cuotaEncontrada: number | null;
        fechaCuota: string | null;
        plazoCompleto: number;
        plazoEncontrado: number;
        cuotasPorCrear: number;
        error?: string;
      }[] = [];

      const resultadosExitosos: {
        numeroPrestamo: string;
        cuotaEsperada: number;
        cuotaEncontrada: number;
        plazoCompleto: number;
        plazoEncontrado: number;
        cuotasPorCrear: number;
      }[] = [];

      // Procesar cada crédito
      for (const credito of creditosEsperados) {
        try {
          console.log(`🔍 Consultando crédito: ${credito.numeroPrestamo}`);
          
          const estadoCuenta = await creditosService.consultarEstadoCuentaPrestamo(credito.numeroPrestamo);
          
          if (!estadoCuenta.success || !estadoCuenta.data) {
            discrepancias.push({
              numeroPrestamo: credito.numeroPrestamo,
              cuotaEsperada: credito.cuotaEsperadaDic2025,
              cuotaEncontrada: null,
              fechaCuota: null,
              plazoCompleto: credito.plazoCompleto,
              plazoEncontrado: 0,
              cuotasPorCrear: credito.plazoCompleto,
              error: estadoCuenta.error || 'No se pudo obtener estado de cuenta'
            });
            continue;
          }

          const planPagosCuotas = estadoCuenta.data.ConsultaResultado?.PlanPagos_Cuotas || [];
          
          // Calcular el plazo encontrado (cantidad de cuotas en el estado de cuenta)
          const plazoEncontrado = planPagosCuotas.length;
          const cuotasPorCrear = credito.plazoCompleto - plazoEncontrado;
          
          // Si la cuota esperada es 0, buscar enero 2026 en lugar de diciembre 2025
          if (credito.cuotaEsperadaDic2025 === 0) {
            // Buscar cuota de enero 2026
            const cuotaEne2026 = planPagosCuotas.find(cuota => {
              const fecha = cuota.Fecha;
              if (fecha) {
                const [year, month] = fecha.split('-');
                return year === '2026' && month === '01';
              }
              return false;
            });

            if (!cuotaEne2026) {
              discrepancias.push({
                numeroPrestamo: credito.numeroPrestamo,
                cuotaEsperada: 1,
                cuotaEncontrada: null,
                fechaCuota: null,
                plazoCompleto: credito.plazoCompleto,
                plazoEncontrado: plazoEncontrado,
                cuotasPorCrear: cuotasPorCrear,
                error: 'No se encontró cuota para enero 2026'
              });
              continue;
            }

            // La cuota de enero 2026 debe ser la cuota número 1
            const numeroCuota = cuotaEne2026.CapitalNumeroCuota;
            if (numeroCuota === 1) {
              resultadosExitosos.push({
                numeroPrestamo: credito.numeroPrestamo,
                cuotaEsperada: 1,
                cuotaEncontrada: numeroCuota,
                plazoCompleto: credito.plazoCompleto,
                plazoEncontrado: plazoEncontrado,
                cuotasPorCrear: cuotasPorCrear
              });
            } else {
              discrepancias.push({
                numeroPrestamo: credito.numeroPrestamo,
                cuotaEsperada: 1,
                cuotaEncontrada: numeroCuota,
                fechaCuota: cuotaEne2026.Fecha,
                plazoCompleto: credito.plazoCompleto,
                plazoEncontrado: plazoEncontrado,
                cuotasPorCrear: cuotasPorCrear,
                error: `Se esperaba cuota 1 en enero 2026, se encontró cuota ${numeroCuota}`
              });
            }
          } else {
            // Lógica original para diciembre 2025
            const cuotaDic2025 = planPagosCuotas.find(cuota => {
              const fecha = cuota.Fecha;
              if (fecha) {
                const [year, month] = fecha.split('-');
                return year === '2025' && month === '12';
              }
              return false;
            });

            if (!cuotaDic2025) {
              discrepancias.push({
                numeroPrestamo: credito.numeroPrestamo,
                cuotaEsperada: credito.cuotaEsperadaDic2025,
                cuotaEncontrada: null,
                fechaCuota: null,
                plazoCompleto: credito.plazoCompleto,
                plazoEncontrado: plazoEncontrado,
                cuotasPorCrear: cuotasPorCrear,
                error: 'No se encontró cuota para diciembre 2025'
              });
              continue;
            }

            const cuotaEncontrada = cuotaDic2025.CapitalNumeroCuota;

            // Comparar con la cuota esperada
            if (cuotaEncontrada === credito.cuotaEsperadaDic2025) {
              resultadosExitosos.push({
                numeroPrestamo: credito.numeroPrestamo,
                cuotaEsperada: credito.cuotaEsperadaDic2025,
                cuotaEncontrada: cuotaEncontrada,
                plazoCompleto: credito.plazoCompleto,
                plazoEncontrado: plazoEncontrado,
                cuotasPorCrear: cuotasPorCrear
              });
            } else {
              discrepancias.push({
                numeroPrestamo: credito.numeroPrestamo,
                cuotaEsperada: credito.cuotaEsperadaDic2025,
                cuotaEncontrada: cuotaEncontrada,
                fechaCuota: cuotaDic2025.Fecha,
                plazoCompleto: credito.plazoCompleto,
                plazoEncontrado: plazoEncontrado,
                cuotasPorCrear: cuotasPorCrear
              });
            }
          }

        } catch (err: any) {
          discrepancias.push({
            numeroPrestamo: credito.numeroPrestamo,
            cuotaEsperada: credito.cuotaEsperadaDic2025,
            cuotaEncontrada: null,
            fechaCuota: null,
            plazoCompleto: credito.plazoCompleto,
            plazoEncontrado: 0,
            cuotasPorCrear: credito.plazoCompleto,
            error: err.message || 'Error desconocido'
          });
        }
      }

      console.log(`✅ Verificación completada. Discrepancias encontradas: ${discrepancias.length}`);

      // Guardar resultados en archivo txt
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputFilePath = pathModule.join(import.meta.dir, '..', 'utils', `verificacion-cuotas-${timestamp}.txt`);
      
      let outputContent = `=== VERIFICACIÓN DE CUOTAS DICIEMBRE 2025 ===\n`;
      outputContent += `Fecha de ejecución: ${new Date().toLocaleString()}\n`;
      outputContent += `Total de créditos verificados: ${creditosEsperados.length}\n`;
      outputContent += `Coincidencias: ${resultadosExitosos.length}\n`;
      outputContent += `Discrepancias: ${discrepancias.length}\n\n`;
      
      outputContent += `=== DISCREPANCIAS ===\n`;
      if (discrepancias.length === 0) {
        outputContent += `No se encontraron discrepancias.\n`;
      } else {
        for (const d of discrepancias) {
          outputContent += `\nPréstamo: ${d.numeroPrestamo}\n`;
          outputContent += `  Cuota esperada (txt): ${d.cuotaEsperada}\n`;
          outputContent += `  Cuota encontrada (SIFCO): ${d.cuotaEncontrada ?? 'N/A'}\n`;
          outputContent += `  Fecha cuota: ${d.fechaCuota ?? 'N/A'}\n`;
          outputContent += `  Plazo completo: ${d.plazoCompleto}\n`;
          outputContent += `  Plazo encontrado: ${d.plazoEncontrado}\n`;
          outputContent += `  Cuotas por crear: ${d.cuotasPorCrear}\n`;
          if (d.error) {
            outputContent += `  Error: ${d.error}\n`;
          }
        }
      }
      
      outputContent += `\n=== COINCIDENCIAS ===\n`;
      for (const r of resultadosExitosos) {
        outputContent += `Préstamo: ${r.numeroPrestamo} - Cuota: ${r.cuotaEncontrada} ✓ (Plazo completo: ${r.plazoCompleto}, Plazo encontrado: ${r.plazoEncontrado}, Por crear: ${r.cuotasPorCrear})\n`;
      }
      
      // Escribir archivo
      fs.writeFileSync(outputFilePath, outputContent, 'utf-8');
      console.log(`📄 Resultados guardados en: ${outputFilePath}`);
      
      // Preparar respuesta JSON
      const responseData = {
        success: true,
        data: {
          totalCreditos: creditosEsperados.length,
          coincidencias: resultadosExitosos.length,
          discrepancias: discrepancias.length,
          detalleDiscrepancias: discrepancias,
          detalleCoincidencias: resultadosExitosos
        }
      };
      
      // Guardar respuesta JSON en response.json
      const responseJsonPath = pathModule.join(import.meta.dir, '..', 'utils', 'response.json');
      fs.writeFileSync(responseJsonPath, JSON.stringify(responseData, null, 2), 'utf-8');
      console.log(`📄 Respuesta JSON guardada en: ${responseJsonPath}`);
      
      // También imprimir resumen en consola
      console.log('\n========== RESUMEN ==========');
      console.log(`Total créditos: ${creditosEsperados.length}`);
      console.log(`Coincidencias: ${resultadosExitosos.length}`);
      console.log(`Discrepancias: ${discrepancias.length}`);
      if (discrepancias.length > 0) {
        console.log('\n--- DISCREPANCIAS ---');
        for (const d of discrepancias) {
          console.log(`${d.numeroPrestamo}: esperado=${d.cuotaEsperada}, encontrado=${d.cuotaEncontrada ?? 'N/A'}, plazo completo=${d.plazoCompleto}, plazo encontrado=${d.plazoEncontrado}, por crear=${d.cuotasPorCrear} ${d.error ? `(${d.error})` : ''}`);
        }
      }
      console.log('=============================\n');

      return new Response(
        JSON.stringify(responseData),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );

    } catch (err: any) {
      console.error('❌ Error en verificar-cuotas-diciembre:', err);
      return new Response(
        JSON.stringify({
          success: false,
          error: `[ERROR] Falló la verificación de cuotas: ${err.message || err}`,
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
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