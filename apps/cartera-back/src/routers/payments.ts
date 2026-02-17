import { Elysia, t } from "elysia";
import { 
  getAllPagosWithCreditAndInversionistas,
  getPayments, 
  liquidatePagosCreditoInversionistas,
  falsePayment,
  getPagosConInversionistas,
} from "../controllers/payments"; 
import { z } from "zod";
import { promises as fs } from "fs";
import { mapPagosPorCreditos, mapPagosDesdeJson } from "../migration/migration";
import { authMiddleware } from "./midleware";
import { exportPagosConInversionistasExcel, exportPagosAdvisorExcel, exportPagosToExcel } from "../controllers/reports";
import { actualizarCuentaPago, aplicarPagoAlCredito, insertPayment } from "../controllers/registerPayment";
import { eq } from "drizzle-orm";
import { db } from "../database";
import { creditos, pagos_credito } from "../database/db";
import { reversePayment } from "../controllers/reversePayment";
import { ajustarCuotasConSIFCO, marcarCuotasPagadasHastaNumero, procesarPagosSIFCODesdeJSON } from "../controllers/migratePayments";
import { updateInstallments, updateAllInstallments } from "../controllers/updateCredit";

export const liquidatePaymentsSchema = z.object({
  pago_id: z.number().int().positive(),
  credito_id: z.number().int().positive(),
  cuota: z.union([z.string(), z.number()]).optional(),
});

const falsePaymentSchema = z.object({
  pago_id: z.number(),
  credito_id: z.number(),
});



export const paymentRouter = new Elysia() 
  // Endpoint para registrar pago (ya lo tienes)
  .post("/newPayment", insertPayment)
  .post("/reversePayment", reversePayment)

  // Nuevo endpoint para buscar pagos por SIFCO y/o fecha
  .get("/paymentByCredit", async ({ query, set }) => {
  const { numero_credito_sifco, excel } = query as {
    numero_credito_sifco?: string;
    excel?: string;
  };

  if (!numero_credito_sifco) {
    set.status = 400;
    return { message: "Falta el parámetro 'numero_credito_sifco'" };
  }

  try {
    if (excel === "true") {
      // 🚀 Generar Excel y devolver URL
      const result = await exportPagosToExcel(numero_credito_sifco);
      set.status = 200;
      return result; // { excelUrl: "https://..." }
    } else {
      // 🔎 Consulta normal JSON
      const pagos = await getAllPagosWithCreditAndInversionistas(
        numero_credito_sifco
      );

      if (!pagos || pagos.length === 0) {
        set.status = 404;
        return { message: "No se encontraron pagos para el crédito" };
      }

      set.status = 200;
      return pagos;
    }
  } catch (error) {
    console.error("❌ Error en /paymentByCredit:", error);
    set.status = 500;
    return { message: "Error consultando pagos", error: String(error) };
  }
})
 

  .get("/payments", async ({ query, set }) => {
    const { mes, anio, page, perPage, numero_credito_sifco } = query;

    if (!mes || !anio) {
      set.status = 400;
      return { message: "Faltan parámetros obligatorios 'mes' y 'anio'" };
    }

    try {
      const result = await getPayments(
        Number(mes),
        Number(anio),
        page ? Number(page) : 1,
        perPage ? Number(perPage) : 10,
        numero_credito_sifco
      );
      return result;
    } catch (error) {
      set.status = 500;
      return {
        message: "Error consultando pagos por mes/año",
        error: String(error),
      };
    }
  })

  .post(
    "/liquidate-pagos-inversionistas",
    async ({ body, set }) => {
      try {
        console.log("[liquidate-pagos-inversionistas] Request body:", body);
        // Validate with Zod
        const parseResult = liquidatePaymentsSchema.safeParse(body);
        if (!parseResult.success) {
          set.status = 400;
          return {
            message: "Validation failed",
            errors: parseResult.error.flatten().fieldErrors,
          };
        }

        const { pago_id, credito_id, cuota } = parseResult.data;
        if (cuota === undefined) {
          set.status = 400;
          return {
            message: "Validation failed",
            errors: { cuota: ["'cuota' is required"] },
          };
        }
        const result = await liquidatePagosCreditoInversionistas(
          pago_id,
          credito_id,
          cuota
        );

        set.status = 200;
        return {
          ...result,
          message: "Payments liquidated successfully",
        };
      } catch (error) {
        console.error("[liquidate-pagos-inversionistas] Error:", error);
        set.status = 500;
        return {
          message: "Internal server error",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    {
      detail: {
        summary: "Liquidate pagos_credito_inversionistas",
        tags: ["Pagos/Inversionistas"],
      },
    }
  )

  .post("/false-payment", async ({ body, set }) => {
    try {
      // Validate request body
      const { pago_id, credito_id } = falsePaymentSchema.parse(body);

      // Call the controller
      const result = await falsePayment(pago_id, credito_id);

      return result;
    } catch (error: any) {
      set.status = 400;
      return {
        message: "Failed to mark payment as false",
        error: error?.message ?? String(error),
      };
    }
  })
  .get(
    "/reportes/pagos-inversionistas",
    async ({ query, set }) => {
      try {
        // 🧠 Extraer parámetros validados
        const {
          page,
          pageSize,
          numeroCredito,
          dia,
          mes,
          anio,
          inversionistaId,
          excel,
          usuarioNombre,
          validationStatus
        } = query;

        // ✅ Si viene reportAdvisor=true, generamos el reporte Excel de asesores (sin inversionistas)
        if (query.reportAdvisor === true) {
          const result = await exportPagosAdvisorExcel({
            page,
            pageSize,
            numeroCredito,
            dia,
            mes,
            anio,
            inversionistaId,
            usuarioNombre,
            validationStatus,
          });
          set.status = 200;
          return {
            message: "📊 Reporte Excel de asesores generado correctamente",
            ...result,
          };
        }

        // ✅ Si viene excel=true, generamos el reporte Excel
        if (excel === true) {
          const result = await exportPagosConInversionistasExcel({
            page,
            pageSize,
            numeroCredito,
            dia,
            mes,
            anio,
            inversionistaId,
            usuarioNombre,validationStatus
          });
          set.status = 200;
          return {
            message: "📊 Reporte Excel generado correctamente",
            ...result,
          };
        }

        // ✅ Si no, devolvemos la data JSON normal
        const data = await getPagosConInversionistas({
          page,
          pageSize,
          numeroCredito,
          dia,
          mes,
          anio,
          inversionistaId,
          usuarioNombre
        });

        set.status = 200;
        console.log(data)
        return  data
      } catch (error: any) {
        console.error("❌ Error en /reportes/pagos-inversionistas:", error);
        set.status = 500;
        return {
          success: false,
          error: error.message || "Error generando reporte de pagos",
        };
      }
    },
    {
      detail: {
        summary: "Obtiene pagos con inversionistas o genera Excel",
        description:
          "Si `excel=true`, genera y sube un reporte Excel completo a R2. Si no, devuelve JSON con los datos de pagos e inversionistas.",
        tags: ["Pagos", "Reportes", "Excel"],
      },
      query: t.Object({
        page: t.Optional(t.Integer({ minimum: 1, default: 1 })),
        pageSize: t.Optional(t.Integer({ minimum: 1, maximum: 1000, default: 20 })),
        numeroCredito: t.Optional(t.String()),
        dia: t.Optional(t.Integer({ minimum: 1, maximum: 31 })),
        mes: t.Optional(t.Integer({ minimum: 1, maximum: 12 })),
        anio: t.Optional(t.Integer({ minimum: 2000, maximum: 2100 })),
        inversionistaId: t.Optional(t.Integer({ minimum: 1 })),
        excel: t.Optional(t.Boolean({ default: false })),
        reportAdvisor: t.Optional(t.Boolean({ default: false })),
        usuarioNombre: t.Optional(t.String()),
        validationStatus: t.Optional(t.String()),
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          message: t.String(),
          total: t.Optional(t.Number()),
          excelUrl: t.Optional(t.String()),
          data: t.Optional(t.Array(t.Any())),
          totalPages: t.Optional(t.Number()),
          totales: t.Optional(t.Any()),
        }),
        500: t.Object({
          success: t.Literal(false),
          error: t.String(),
        }),
      },
    }
  )
.post(
  "/aplicar-pago",
  async ({ query, set }) => {
    try {
      // Validar que pago_id esté presente
      if (!query.pago_id) {
        set.status = 400;
        return {
          success: false,
          message: "El parámetro pago_id es requerido",
        };
      }

      // Validar que pago_id sea un número válido
      const pagoId = parseInt(query.pago_id);
      
      if (isNaN(pagoId) || pagoId <= 0) {
        set.status = 400;
        return {
          success: false,
          message: "El ID del pago debe ser un número válido mayor a 0",
        };
      }

      // Verificar que el pago existe antes de aplicarlo
      const [pagoExiste] = await db
        .select()
        .from(pagos_credito)
        .where(eq(pagos_credito.pago_id, pagoId))
        .limit(1);

      if (!pagoExiste) {
        set.status = 404;
        return {
          success: false,
          message: `No se encontró el pago con ID ${pagoId}`,
        };
      }

      // Verificar que el pago no esté ya validado
      if (pagoExiste.validationStatus === 'validated') {
        set.status = 400;
        return {
          success: false,
          message: "Este pago ya ha sido validado previamente",
        };
      }

      // Aplicar el pago
      const resultado = await aplicarPagoAlCredito(pagoId);

      set.status = 200;
      return resultado;

    } catch (error) {
      console.error("Error en el endpoint aplicar-pago:", error);
      set.status = 500;
      return {
        success: false,
        message: error instanceof Error ? error.message : "Error al aplicar el pago al crédito",
      };
    }
  },
  {
    query: t.Object({
      pago_id: t.String(),
    }),
  }
)
.post(
  "/actualizar-cuenta",
  async ({ query }) => {
    try {
      const { pagoId, cuentaEmpresaId } = query;

      // Validaciones
      if (!pagoId || !cuentaEmpresaId) {
        return {
          status: 400,
          body: {
            success: false,
            message: "❌ pagoId y cuentaEmpresaId son requeridos",
          },
        };
      }

      const pagoIdNum = parseInt(pagoId);
      const cuentaIdNum = parseInt(cuentaEmpresaId);

      if (isNaN(pagoIdNum) || isNaN(cuentaIdNum)) {
        return {
          status: 400,
          body: {
            success: false,
            message: "❌ pagoId y cuentaEmpresaId deben ser números válidos",
          },
        };
      }

      const result = await actualizarCuentaPago(pagoIdNum, cuentaIdNum);

      if (!result.success) {
        return {
          status: result.message.includes("no encontrado") ? 404 : 400,
          body: result,
        };
      }

      return {
        status: 200,
        body: result,
      };
    } catch (error: any) {
      console.error("❌ Error en POST /pagos/actualizar-cuenta:", error);
      return {
        status: 500,
        body: {
          success: false,
          message: "❌ Error interno del servidor",
          error: error.message,
        },
      };
    }
  },
  {
    query: t.Object({
      pagoId: t.String(),
      cuentaEmpresaId: t.String(),
    }),
  }
)  .post("/procesar-discrepancias", async () => {
  const rutasArchivos = [
    "C:\\Users\\Kelvin Palacios\\Documents\\analis de datos\\creditos.json",
    "C:\\Users\\Kelvin Palacios\\Documents\\analis de datos\\creditosMenor20.json",
    // podés agregar más
  ];

  const resultados: any[] = [];
  const errores: any[] = [];

  for (const ruta of rutasArchivos) {
    console.log(`\n📂 Leyendo archivo: ${ruta}`);

    const contenido = await fs.readFile(ruta, "utf-8");
    const jsonData = JSON.parse(contenido);

    if (!jsonData.data) {
      throw new Error(`JSON inválido en ${ruta}`);
    }

    const {
      detalleDiscrepancias = [],
      detalleCoincidencias = [],
    } = jsonData.data;

    /* =====================================================
       1️⃣ PROCESAR DISCREPANCIAS
       ===================================================== */
    console.log(
      `\n🚨 Procesando DISCREPANCIAS (${detalleDiscrepancias.length})...`
    );

    for (const discrepancia of detalleDiscrepancias) {
      const {
        numeroPrestamo,
        cuotaEsperada,
        cuotaEncontrada,
        fechaCuota,
        plazoCompleto,
        plazoEncontrado,
        cuotasPorCrear,
      } = discrepancia;

      try {
        console.log(`\n📌 [DISCREPANCIA] Crédito: ${numeroPrestamo}`);

        await ajustarCuotasConSIFCO({
          numero_credito_sifco: numeroPrestamo,
          cuota_esperada: cuotaEsperada,
          cuota_encontrada: cuotaEncontrada,
          fecha_cuota: fechaCuota,
          plazo_completo: plazoCompleto,
          plazo_encontrado: plazoEncontrado,
          cuotas_por_crear: cuotasPorCrear,
        });

        resultados.push({
          numeroPrestamo,
          tipo: "discrepancia",
          status: "success",
        });
      } catch (error: any) {
        errores.push({
          numeroPrestamo,
          tipo: "discrepancia",
          status: "error",
          mensaje: error.message,
        });
      }
    }

    /* =====================================================
       2️⃣ PROCESAR COINCIDENCIAS
       ===================================================== */
    console.log(
      `\n✅ Procesando COINCIDENCIAS (${detalleCoincidencias.length})...`
    );

  
  }

  console.log(`\n🎉 PROCESO COMPLETO`);
  console.log(`   ✅ Exitosos: ${resultados.length}`);
  console.log(`   ❌ Errores: ${errores.length}`);

  return {
    success: true,
    exitosos: resultados.length,
    errores: errores.length,
    resultados,
    detalleErrores: errores,
  };
})


  .post(
    "/ajustar-credito",
    async ({ body }) => {
      const {
        numero_credito_sifco,
        cuota_esperada,
        cuota_encontrada,
        fecha_cuota,
        plazo_completo,
        plazo_encontrado,
        cuotas_por_crear,
      } = body;

      await ajustarCuotasConSIFCO({
        numero_credito_sifco,
        cuota_esperada,
        cuota_encontrada,
        fecha_cuota,
        plazo_completo,
        plazo_encontrado,
        cuotas_por_crear,
      });

      return {
        success: true,
        mensaje: `Crédito ${numero_credito_sifco} ajustado correctamente`,
      };
    },
    {
      body: t.Object({
        numero_credito_sifco: t.String(),
        cuota_esperada: t.Number(),
        cuota_encontrada: t.Number(),
        fecha_cuota: t.String(),
        plazo_completo: t.Number(),
        plazo_encontrado: t.Number(),
        cuotas_por_crear: t.Number(),
      }),
    }
  )  .post("/procesar-desde-archivo", async () => {
    // 👇 Ruta quemada al archivo JSON
    const rutaArchivo = "C:\\Users\\Kelvin Palacios\\Documents\\analis de datos\\pagosSIFCO.json";

    console.log(`\n📂 Leyendo archivo: ${rutaArchivo}`);

    try {
      // Leer el archivo
      const contenido = await fs.readFile(rutaArchivo, "utf-8");
      const jsonData = JSON.parse(contenido);

      console.log(`📦 JSON leído exitosamente`);
      console.log(`📊 Total de elementos en el JSON: ${jsonData.length}`);

      // Procesar los pagos
      await procesarPagosSIFCODesdeJSON(jsonData);

      return {
        success: true,
        message: "Pagos procesados exitosamente desde archivo",
        archivo: rutaArchivo,
        total_creditos: jsonData.length,
      };
    } catch (error: any) {
      console.error("❌ Error leyendo o procesando archivo:", error);
      
      return {
        success: false,
        message: `Error: ${error.message}`,
        archivo: rutaArchivo,
      };
    }
  }, {
    detail: {
      tags: ["SIFCO Pagos"],
      summary: "Procesar pagos desde archivo JSON",
      description: "Lee un archivo JSON desde el sistema y procesa los pagos automáticamente",
    },
  })

  // 📤 POST - Procesar pagos desde JSON en el body (alternativa)
.post(
    "/procesar-pagos",
    async ({ set }) => {
      // 👇 Ruta quemada directamente aquí
      const rutaArchivo = "C:\\Users\\Kelvin Palacios\\Documents\\analis de datos\\resultado_ultimos_pagos.json";

      console.log(`\n📂 Leyendo archivo: ${rutaArchivo}`);

      try {
        // Leer el archivo
        const contenido = await fs.readFile(rutaArchivo, "utf-8");
        const jsonData = JSON.parse(contenido);

        console.log(`📦 JSON leído exitosamente`);
        console.log(`📊 Total de elementos en el JSON: ${jsonData.length}`);

        // Procesar los pagos
        await procesarPagosSIFCODesdeJSON(jsonData);

        return {
          success: true,
          message: "Pagos procesados exitosamente desde archivo",
          archivo: rutaArchivo,
          total_creditos: jsonData.length,
        };
      } catch (error: any) {
        console.error("❌ Error leyendo o procesando archivo:", error);
        set.status = 500;
        
        return {
          success: false,
          message: `Error: ${error.message}`,
          archivo: rutaArchivo,
        };
      }
    },
    {
      detail: {
        tags: ["SIFCO Pagos"],
        summary: "Procesar pagos desde archivo JSON",
        description: "Lee un archivo JSON desde la ruta quemada y procesa los pagos automáticamente",
      },
    }
  )

  // 🔍 POST - Procesar UN SOLO crédito (para testing)
  .post(
    "/procesar-uno",
    async ({ body, set }) => {
      try {
        console.log(`\n🎯 Procesando UN crédito: ${body.numeroCredito}`);
        
        await procesarPagosSIFCODesdeJSON([body]);

        return {
          success: true,
          message: `Crédito ${body.numeroCredito} procesado exitosamente`,
        };
      } catch (error) {
        console.error("❌ Error procesando crédito:", error);
        set.status = 500;
        return {
          success: false,
          message: error instanceof Error ? error.message : "Error desconocido",
        };
      }
    },
    {
      body: t.Object({
        numeroCredito: t.String(),
        creditos: t.Array(
          t.Object({
            numeroCredito: t.String(),
            fechaUltimoPago: t.String(),
            numeroCuota: t.String(),
            cuota: t.String(),
            montoBoleta: t.String(),
            pagado: t.String(),
          })
        ),
      }),
      detail: {
        tags: ["SIFCO Pagos"],
        summary: "Procesar un solo crédito",
        description: "Para testing - procesa un solo crédito",
      },
    }
  )
 
.post(
    "/mapear-pagos-coincidencias",
    async ({ set }) => {
      // 👇 Rutas quemadas
      const rutaArchivoCoincidencias = "C:\\Users\\Kelvin Palacios\\Documents\\analis de datos\\creditosMenor20.json";
      const rutaArchivoPagos = "C:\\Users\\Kelvin Palacios\\Documents\\analis de datos\\resultado_ultimos_pagos.json";

      console.log(`\n📂 Leyendo archivo de coincidencias: ${rutaArchivoCoincidencias}`);

      try {
        // 1️⃣ Leer el archivo de COINCIDENCIAS primero
        const contenidoCoincidencias = await fs.readFile(rutaArchivoCoincidencias, "utf-8");
        const jsonCoincidencias = JSON.parse(contenidoCoincidencias);
        const detalleCoincidencias = jsonCoincidencias.data?.detalleCoincidencias || [];
        
        console.log(`📦 JSON de coincidencias leído exitosamente`);
        console.log(`📊 Total de coincidencias: ${detalleCoincidencias.length}`);

        if (detalleCoincidencias.length === 0) {
          return {
            success: false,
            message: "No hay coincidencias para procesar",
            archivoCoincidencias: rutaArchivoCoincidencias,
          };
        }

        // 2️⃣ Leer el archivo de PAGOS
        console.log(`\n📂 Leyendo archivo de últimos pagos: ${rutaArchivoPagos}`);
        const contenidoPagos = await fs.readFile(rutaArchivoPagos, "utf-8");
        const jsonPagos = JSON.parse(contenidoPagos);
        console.log(`📦 JSON de pagos leído exitosamente`);
        console.log(`📊 Total de registros en pagos: ${jsonPagos.length}`);

        // 3️⃣ Recorrer las COINCIDENCIAS
        let ok = 0;
        let fail = 0;
        let notFound = 0;

        for (const coincidencia of detalleCoincidencias) {
          const numeroSifco = coincidencia.numeroPrestamo;
          
          console.log(`\n🔄 Procesando crédito con coincidencia: ${numeroSifco}`);
          
          try {
            // 4️⃣ Buscar el crédito en el JSON de PAGOS
            const registroPago = jsonPagos.find((p: any) => p.numeroCredito === numeroSifco);
            
            if (!registroPago || !registroPago.creditos || registroPago.creditos.length === 0) {
              console.log(`⚠️ Crédito ${numeroSifco} no encontrado en archivo de pagos`);
              notFound++;
              continue;
            }

            // El primer elemento del array "creditos" tiene la info del último pago
            const ultimoPago = registroPago.creditos[0];
            const hastaCuota = ultimoPago.numeroCuota;
            
            console.log(`🔍 Crédito ${numeroSifco} encontrado - Último pago: ${ultimoPago.fechaUltimoPago}, Hasta cuota: ${hastaCuota}`);
            
            // 5️⃣ PRIMERO: Mapear pagos desde SIFCO
            console.log(`📥 Mapeando pagos desde SIFCO para ${numeroSifco}...`);
            await mapPagosPorCreditos(numeroSifco);
            console.log(`✅ Pagos mapeados para ${numeroSifco}`);
            
            // 6️⃣ SEGUNDO: Marcar cuotas como pagadas
            console.log(`✏️ Marcando cuotas como pagadas hasta ${hastaCuota} para ${numeroSifco}...`);
            await marcarCuotasPagadasHastaNumero({
              numero_credito_sifco: numeroSifco,
              hasta_cuota: parseInt(hastaCuota),
            });
            console.log(`✅ Cuotas marcadas para ${numeroSifco}`);
            
            ok++;
            console.log(`✅ Crédito ${numeroSifco} procesado exitosamente`);
          } catch (error: any) {
            fail++;
            console.error(`❌ Error procesando crédito ${numeroSifco}:`, error.message);
          }
        }

        console.log(`\n🎉 Resumen final: OK=${ok} | FAIL=${fail} | NO EN PAGOS=${notFound} | TOTAL=${detalleCoincidencias.length}`);

        return {
          success: true,
          message: "Cuotas mapeadas y marcadas como pagadas desde coincidencias",
          archivoCoincidencias: rutaArchivoCoincidencias,
          archivoPagos: rutaArchivoPagos,
          total_coincidencias: detalleCoincidencias.length,
          exitosos: ok,
          fallidos: fail,
          no_encontrados_en_pagos: notFound,
        };
      } catch (error: any) {
        console.error("❌ Error leyendo o procesando archivos:", error);
        set.status = 500;
        
        return {
          success: false,
          message: `Error: ${error.message}`,
          archivoCoincidencias: rutaArchivoCoincidencias,
          archivoPagos: rutaArchivoPagos,
        };
      }
    },
    {
      detail: {
        tags: ["SIFCO Pagos"],
        summary: "Mapear y marcar cuotas pagadas desde coincidencias",
        description: "Lee coincidencias, busca en pagos, mapea desde SIFCO y marca cuotas como pagadas",
      },
    }
  ).post(
  "/recalcular-cuotas-sin-pagos",
  async ({ set }) => {
    const rutaArchivoCreditos = "C:\\Users\\Kelvin Palacios\\Documents\\analis de datos\\creditosSinPAGOS.json";
    const rutaArchivoPagos = "C:\\Users\\Kelvin Palacios\\Documents\\analis de datos\\resultado_ultimos_pagos.json";

    console.log(`\n📂 Leyendo archivo de créditos sin pagos: ${rutaArchivoCreditos}`);

    try {
      // 1️⃣ Leer el archivo de CRÉDITOS (igual que el otro endpoint)
      const contenidoCreditos = await fs.readFile(rutaArchivoCreditos, "utf-8");
      const jsonCreditos = JSON.parse(contenidoCreditos);
      const creditosSinPagos = jsonCreditos.creditos || [];
      
      console.log(`📦 JSON de créditos leído exitosamente`);
      console.log(`📊 Total de créditos sin pagos: ${creditosSinPagos.length}`);

      if (creditosSinPagos.length === 0) {
        return {
          success: false,
          message: "No hay créditos para procesar",
          rutaArchivoCreditos,
        };
      }

      // 2️⃣ Leer el archivo de PAGOS (EXACTAMENTE igual que el endpoint que funciona)
      console.log(`\n📂 Leyendo archivo de últimos pagos: ${rutaArchivoPagos}`);
      const contenidoPagos = await fs.readFile(rutaArchivoPagos, "utf-8");
      const jsonPagos = JSON.parse(contenidoPagos);
      console.log(`📦 JSON de pagos leído exitosamente`);
      console.log(`📊 Total de registros en pagos: ${jsonPagos.length}`);

      // 3️⃣ Contadores
      let ok = 0;
      let fail = 0;
      let notFound = 0;
      let notFoundInPagos = 0;

      // 4️⃣ Procesar cada crédito
      for (const credito of creditosSinPagos) {
        const numeroSifco = credito.numero_credito_sifco;

        if (!numeroSifco) {
          console.log(`⚠️ Crédito sin numero_credito_sifco, saltando...`);
          fail++;
          continue;
        }

        console.log(`\n🔄 Procesando crédito: ${numeroSifco}`);

        try {
          // 5️⃣ Buscar el crédito en DB para obtener la CUOTA
          const creditoDB = await db
            .select({
              credito_id: creditos.credito_id,
              cuota: creditos.cuota,
              plazo: creditos.plazo,
            })
            .from(creditos)
            .where(eq(creditos.numero_credito_sifco, numeroSifco))
            .limit(1);

          if (!creditoDB || creditoDB.length === 0) {
            console.log(`⚠️ Crédito ${numeroSifco} NO encontrado en la base de datos`);
            notFound++;
            continue;
          }

          const { cuota, plazo } = creditoDB[0];
          console.log(`🔍 Cuota: Q${cuota} | Plazo: ${plazo} meses`);

          // 6️⃣ Validar que tenga cuota válida
          if (!cuota || parseFloat(cuota) <= 0) {
            console.log(`⚠️ Crédito ${numeroSifco} tiene cuota inválida: Q${cuota}`);
            fail++;
            continue;
          }

          // 7️⃣ Buscar el crédito en el JSON de PAGOS (igual que el otro endpoint)
          const registroPago = jsonPagos.find((p: any) => p.numeroCredito === numeroSifco);
          
          let hastaCuota = 0;
          let fechaPagoJson: string | undefined;

          if (!registroPago || !registroPago.creditos || registroPago.creditos.length === 0) {
            console.log(`⚠️ Crédito ${numeroSifco} no encontrado en archivo de pagos`);
            notFoundInPagos++;
          } else {
            // El primer elemento del array "creditos" tiene la info del último pago
            const ultimoPago = registroPago.creditos[0];
            hastaCuota = parseInt(ultimoPago.numeroCuota, 10);
            fechaPagoJson = ultimoPago.pago; // ej: "2026-01-30 00:00:00"

            console.log(`🔍 Crédito ${numeroSifco} encontrado - Último pago: ${ultimoPago.fechaUltimoPago}, Hasta cuota: ${hastaCuota}, Fecha pago: ${fechaPagoJson}`);
          }

          // 8️⃣ PASO 1: Crear cuotas y pagos desde JSON (sin SIFCO)
          console.log(`📥 Creando cuotas y pagos desde JSON para ${numeroSifco} (hasta cuota ${hastaCuota})...`);
          await mapPagosDesdeJson(numeroSifco, hastaCuota, fechaPagoJson);
          console.log(`✅ Cuotas y pagos creados para ${numeroSifco}`);

          // 9️⃣ PASO 2: Recalcular todas las cuotas con LA CUOTA DEL CRÉDITO
          console.log(`🔧 Recalculando todas las cuotas con Q${cuota}...`);
          await updateInstallments({
            numero_credito_sifco: numeroSifco,
            nueva_cuota: parseFloat(cuota),
            all: true,
          });

          ok++;
          console.log(`✅ Crédito ${numeroSifco} procesado exitosamente`);

        } catch (error: any) {
          fail++;
          console.error(`❌ Error procesando crédito ${numeroSifco}:`, error.message);
        }
      }

      // 1️⃣1️⃣ Resumen final
      console.log(`\n🎉 Resumen final: OK=${ok} | FAIL=${fail} | NO EN DB=${notFound} | NO EN PAGOS=${notFoundInPagos} | TOTAL=${creditosSinPagos.length}`);

      return {
        success: true,
        message: "Pagos mapeados, marcados y cuotas recalculadas para créditos sin pagos",
        rutaArchivoCreditos,
        rutaArchivoPagos,
        total_creditos: creditosSinPagos.length,
        exitosos: ok,
        fallidos: fail,
        no_encontrados_db: notFound,
        no_encontrados_pagos: notFoundInPagos,
      };

    } catch (error: any) {
      console.error("❌ Error leyendo o procesando archivos:", error);
      set.status = 500;

      return {
        success: false,
        message: `Error: ${error.message}`,
        rutaArchivoCreditos,
        rutaArchivoPagos,
      };
    }
  },
  {
    detail: {
      tags: ["Créditos"],
      summary: "Recalcular cuotas para créditos sin pagos",
      description: "Lee créditos y pagos, mapea desde SIFCO, marca cuotas pagadas y recalcula todas las cuotas",
    },
  }
)


.post("/reparar-json-creditos", async ({ set }) => {
  const rutaOrigen = "C:\\Users\\Kelvin Palacios\\Documents\\analis de datos\\creditosSinPAGOS.json";
  const rutaReparado = "C:\\Users\\Kelvin Palacios\\Documents\\analis de datos\\creditosSinPAGOS_reparado.json";
  
  try {
    console.log(`📂 Leyendo archivo original: ${rutaOrigen}`);
    
    // Leer el contenido
    const contenido = await fs.readFile(rutaOrigen, "utf-8");
    
    console.log(`📊 Tamaño: ${contenido.length} caracteres`);
    
    // 🔧 Reparar el JSON
    let reparado = contenido.trim();
    
    // 1. Asegurar que empiece correctamente
    if (!reparado.startsWith('{')) {
      reparado = '{' + reparado;
    }
    
    // 2. Arreglar el espacio después de "creditos":
    reparado = reparado.replace('"creditos":[', '"creditos": [');
    
    // 3. Asegurar que termine correctamente
    if (!reparado.endsWith(']}')) {
      // Verificar si termina con ]
      if (reparado.endsWith(']')) {
        reparado = reparado + '}';
      } else if (reparado.endsWith('}')) {
        reparado = reparado.slice(0, -1) + ']}';
      } else {
        reparado = reparado + ']}';
      }
    }
    
    // 4. Intentar parsear para validar
    let parsed;
    try {
      parsed = JSON.parse(reparado);
      console.log(`✅ JSON reparado y validado`);
      console.log(`📊 Total de créditos: ${parsed.creditos.length}`);
    } catch (parseError: any) {
      console.error(`❌ Aún hay errores después de reparar:`, parseError.message);
      
      // Guardar el contenido reparado para inspección
      await fs.writeFile(rutaReparado + '.debug', reparado, "utf-8");
      
      return {
        success: false,
        message: `Error al parsear JSON reparado: ${parseError.message}`,
        archivo_debug: rutaReparado + '.debug',
      };
    }
    
    // 5. Guardar el JSON reparado con formato bonito
    const jsonBonito = JSON.stringify(parsed, null, 2);
    await fs.writeFile(rutaReparado, jsonBonito, "utf-8");
    
    console.log(`💾 JSON reparado guardado en: ${rutaReparado}`);
    
    return {
      success: true,
      message: "JSON reparado exitosamente",
      rutaOriginal: rutaOrigen,
      rutaReparado: rutaReparado,
      total_creditos: parsed.creditos.length,
      primer_credito: parsed.creditos[0]?.numero_credito_sifco,
      ultimo_credito: parsed.creditos[parsed.creditos.length - 1]?.numero_credito_sifco,
    };
    
  } catch (error: any) {
    console.error(`❌ Error reparando JSON:`, error);
    set.status = 500;
    
    return {
      success: false,
      message: `Error: ${error.message}`,
    };
  }
},
{
  detail: {
    tags: ["Utilidades"],
    summary: "Reparar JSON de créditos corrupto",
    description: "Lee, valida y repara el JSON de créditos sin pagos",
  },
})

// ========================================
// MARCAR CUOTAS PAGADAS DESDE JSON
// ========================================
.post("/marcar-cuotas-desde-json", async ({ set }) => {
  const rutaArchivoPagos =
    "C:\\Users\\Kelvin Palacios\\Documents\\analis de datos\\resultado_ultimos_pagos.json";

  try {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`MARCANDO CUOTAS PAGADAS DESDE JSON`);
    console.log(`${"=".repeat(60)}`);

    // 1. Leer JSON
    const contenido = await fs.readFile(rutaArchivoPagos, "utf-8");
    const jsonPagos = JSON.parse(contenido);
    console.log(`Total registros en JSON: ${jsonPagos.length}\n`);

    let ok = 0;
    let fail = 0;
    let sinPago = 0;

    // 2. Para cada crédito, extraer numeroCuota y llamar marcarCuotasPagadasHastaNumero
    for (const registro of jsonPagos) {
      const numeroCredito = registro.numeroCredito;
      const creditoInfo = registro.creditos?.[0];

      if (!creditoInfo?.numeroCuota) {
        sinPago++;
        continue;
      }

      const hastaCuota = parseInt(creditoInfo.numeroCuota, 10);

      try {
        const fechaPago = creditoInfo.pago ?? null;
        console.log(`  ${numeroCredito}: marcando hasta cuota ${hastaCuota} (día pago: ${fechaPago})...`);
        await marcarCuotasPagadasHastaNumero({
          numero_credito_sifco: numeroCredito,
          hasta_cuota: hastaCuota,
          fecha_primer_pago: fechaPago,
        });
        ok++;
      } catch (error: any) {
        fail++;
        console.error(`  ERROR ${numeroCredito}: ${error.message}`);
      }
    }

    // 3. Al final, recalcular todas las cuotas
    console.log(`\nRecalculando todas las cuotas...`);
   await updateAllInstallments();
    console.log(`Cuotas recalculadas.`);

    console.log(`\n${"=".repeat(60)}`);
    console.log(`RESUMEN`);
    console.log(`${"=".repeat(60)}`);
    console.log(`Exitosos: ${ok}`);
    console.log(`Fallidos: ${fail}`);
    console.log(`Sin numeroCuota: ${sinPago}`);
    console.log(`Total JSON: ${jsonPagos.length}`);

    set.status = 200;
    return {
      success: true,
      total_json: jsonPagos.length,
      exitosos: ok,
      fallidos: fail,
      sin_cuota: sinPago,
    };
  } catch (error: any) {
    console.error("Error en marcar-cuotas-desde-json:", error);
    set.status = 500;
    return { success: false, message: error.message };
  }
},
{
  detail: {
    tags: ["Créditos"],
    summary: "Marcar cuotas pagadas desde JSON",
    description: "Lee resultado_ultimos_pagos.json, marca cuotas pagadas con marcarCuotasPagadasHastaNumero y recalcula con updateAllInstallments",
  },
})
.post(
  "/marcar-cuotas",
  async ({ body, set }) => {
    try {
      const { numero_credito_sifco, hasta_cuota, fecha_primer_pago } = body;

      await marcarCuotasPagadasHastaNumero({
        numero_credito_sifco,
        hasta_cuota,
        fecha_primer_pago,
      });

      set.status = 200;
      return {
        success: true,
        message: `Cuotas marcadas hasta la cuota ${hasta_cuota} para crédito ${numero_credito_sifco}`,
      };
    } catch (error: any) {
      console.error("Error en marcar-cuotas:", error);
      set.status = 500;
      return { success: false, message: error.message };
    }
  },
  {
    body: t.Object({
      numero_credito_sifco: t.String(),
      hasta_cuota: t.Number(),
      fecha_primer_pago: t.String(),
    }),
    detail: {
      tags: ["Créditos"],
      summary: "Marcar cuotas pagadas hasta un número de cuota",
    },
  }
)