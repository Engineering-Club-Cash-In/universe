import { Elysia, t } from "elysia";
import { generateSolicitudVehiculoSubmission } from "../services/integrationsDocuments";
import { generateCartaGpsSubmission } from "../services/template5AceptaciónGPS(hombre)";
import { generateSolicitudTraspasoVehiculoSubmission } from "../services/template6TraspasoVehículo(hombre)";
import { generateDescargoResponsabilidadesSubmission } from "../services/template7DescargoResponsabilidades(hombre)";
import { generateCoberturaInrexsaSubmission } from "../services/template8CoberturaIXREXSA";
import { generateReconocimientoDeudaSubmission } from "../services/template9ReconocimientoDeuda(hombre)";
import { generateCartaCarroNuevoSubmission } from "../services/template10CartaCarroNuevo";
import { generateDescargoMujerSubmission } from "../services/template12DescargoResponsabilidad(mujer)";
import { generateCartaAceptacionGpsMujerSubmission } from "../services/template14CartaAceptacacionGPS(mujer)";
import { generateVehicleTransferLetterWomanTemplate15Submission } from "../services/template15CartaSolicitudTraspaso(mujer)";
import { generateReconocimientoDeudaMujerTemplate16Submission } from "../services/template16ReconocimientoDeuda(mujer)";
import { generateDebtAcknowledgementManTemplate17Submission } from "../services/template17ContratoPrivadoUSOCARRO(hombre)";
import { generateDebtAcknowledgementWomanTemplate18Submission } from "../services/template18ContratoPrivadoUSOCARRO(mujer)";
import { generateDebtAcknowledgementWomanTemplate19Submission } from "../services/template19CartaCarroNuevo(mujer)";
import { generatePromissoryNoteManTemplate20Submission } from "../services/template20PagareUnicoLibre(hombre)";
import { generatePromissoryNoteWomanTemplate21Submission } from "../services/template21PagareUnicoLibre(mujeres)";
import { generateCheckIssuanceLetterManTemplate22Submission } from "../services/template22CartaEmisionCheques(hombre)";
import { generateCheckIssuanceLetterWomanTemplate23Submission } from "../services/template23CartaEmisionCheques(mujer)";
import { generateMovableGuaranteeManTemplate24Submission } from "../services/template24GarantiaInmobilaria(homre)";
import { generateVehiclePurchaseThirdPartyWomanTemplate13Submission } from "../services/template13solicitudCompraVechiculo(mujer)";
import { generateMovableGuaranteeWomanTemplate25Submission } from "../services/template25GarantiaInmobilaria(mujer)";
import { getDocumentsByDpiController, getDocusealDocumentsController } from "../controllers/docuseal";
const docuSealRouter = new Elysia({
  prefix: "/docuSeal",
})
  .post(
    "/vehiclePurchaseRequestManTemplate4",
    async ({ body }) => {
      const { email, ...params } = body;
      return await generateSolicitudVehiculoSubmission(params, email);
    },
    {
      body: t.Object({
        email: t.String(),
        fecha: t.String(),
        nombrePersona: t.String(),
        dpiPersona: t.String(),
        tipoVehiculo: t.String(),
        marcaVehiculo: t.String(),
        colorVehiculo: t.String(),
        usoVehiculo: t.String(),
        chasisVehiculo: t.String(),
        combustibleVehiculo: t.String(),
        motorVehiculo: t.String(),
        serieVehiculo: t.String(),
        lineaVehiculo: t.String(),
        modeloVehiculo: t.String(),
        cm3Vehiculo: t.String(),
        asientosVehiculo: t.String(),
        cilindrosVehiculo: t.String(),
        iscvVehiculo: t.String(),
        empresa: t.String(),
        nombreFirmaPersona: t.String(),
        dpiFirmaPersona: t.String(),
        firma: t.String(), // se puede mandar "" si la firma la hace DocuSeal
      }),
    }
  )
  .post(
    "/generateGPSInstallationLetterTemplate5",
    async ({ body }) => {
      const { email, ...params } = body;
      const response = await generateCartaGpsSubmission(params, email);
      return response;
    },
    {
      body: t.Object({
        email: t.String(),
        fecha: t.String(),
        nombreDeudor: t.String(),
        tipo: t.String(),
        marca: t.String(),
        color: t.String(),
        uso: t.String(),
        chasis: t.String(),
        combustible: t.String(),
        motor: t.String(),
        serie: t.String(),
        linea: t.String(),
        modelo: t.String(),
        cm3: t.String(),
        asientos: t.String(),
        cilindros: t.String(),
        iscv: t.String(),
        nombreFirmaPersona: t.String(),
        dpiDeudor: t.String(),
      }),
    }
  )
  .post(
    "/vehicleTransferRequestTemplate6",
    async ({ body }) => {
      const { email, ...params } = body;
      const response = await generateSolicitudTraspasoVehiculoSubmission(
        {
          ...params,
          firma: "", // vacío, DocuSeal mostrará la firma al usuario
        },
        email
      );
      return response;
    },
    {
      body: t.Object({
        email: t.String(),
        fecha: t.String(),
        nombrePersona: t.String(),
        dpiPersona: t.String(),
        empresa: t.String(),
        tipoVehiculo: t.String(),
        marcaVehiculo: t.String(),
        colorVehiculo: t.String(),
        usoVehiculo: t.String(),
        chasisVehiculo: t.String(),
        combustibleVehiculo: t.String(),
        motorVehiculo: t.String(),
        serieVehiculo: t.String(),
        lineaVehiculo: t.String(),
        modeloVehiculo: t.String(),
        cm3Vehiculo: t.String(),
        asientosVehiculo: t.String(),
        cilindrosVehiculo: t.String(),
        iscvVehiculo: t.String(),
        nombreDeLaPersona: t.String(),
        dpi: t.String(),
      }),
    }
  )
  .post(
    "/vehiclePurchaseRequestManTemplate7", // DESCARGO RESPONSABILIDADES HOMBRE
    async ({ body }) => {
      const { email, ...params } = body;
      const response = await generateDescargoResponsabilidadesSubmission(
        { ...params, firma: "" }, // firma en blanco, DocuSeal pedirá al usuario
        email
      );
      return response;
    },
    {
      body: t.Object({
        email: t.String(),
        vehiculoTipo: t.String(),
        vehiculoMarca: t.String(),
        vehiculoColor: t.String(),
        vehiculoUso: t.String(),
        vehiculoChasis: t.String(),
        vehiculoCombustible: t.String(),
        vehiculoMotor: t.String(),
        vehiculoSerie: t.String(),
        vehiculoLinea: t.String(),
        vehiculoModelo: t.String(),
        vehiculoCm3: t.String(),
        vehiculoAsientos: t.String(),
        vehiculoCilindros: t.String(),
        vehiculoIscv: t.String(),
        nombreDeudor: t.String(),
        dpiDeudorTexto: t.String(),
        dia: t.String(),
        mes: t.String(),
        año: t.String(),
        nombreDeudorFirma: t.String(),
        dpiDeudor: t.String(),
      }),
    }
  )
  .post(
    "/coberturaInrexsaTemplate8", // 📌 endpoint Cobertura INREXSA
    async ({ body }) => {
      const { email, ...params } = body;
      const response = await generateCoberturaInrexsaSubmission(
        { ...params, firma: "" }, // firma la pide DocuSeal
        email
      );
      return response;
    },
    {
      body: t.Object({
        email: t.String(),

        nombreDeudor: t.String(), 
        dia: t.String(),
        mes: t.String(),
        año: t.String(), 
      }),
    }
  )
  .post(
    "/debtAcknowledgementTemplate9",
    async ({ body }) => {
      const { email, ...params } = body;
      const response = await generateReconocimientoDeudaSubmission(
        { ...params, firma: "" }, // DocuSeal pedirá la firma
        email
      );
      return response;
    },
    {
      body: t.Object({
        email: t.String(),
        dia: t.String(),
        mes: t.String(),
        año: t.String(),
        edadAndresAsencio: t.String(),
        dpiAndresAsencio: t.String(),
        nombreDeudor: t.String(),
        edadDeudor: t.String(),
        estadoCivilDeudor: t.String(),
        profesionDeudor: t.String(),
        nacionalidadDeudor: t.String(),
        dpiDeudor: t.String(),
        capitalAdeudado: t.String(),
        mesesPrestamo: t.String(),
        cuotasMensuales: t.String(),
        porcentajeDeudaTexto: t.String(),
        porcentajeDeudaNumero: t.String(),
        porcentajeMoraTexto: t.String(),
        porcentajeMoraNumero: t.String(),
        direccionDeudor: t.String(),
        vehiculoTipo: t.String(),
        vehiculoMarca: t.String(),
        vehiculoColor: t.String(),
        vehiculoUso: t.String(),
        vehiculoChasis: t.String(),
        vehiculoCombustible: t.String(),
        vehiculoMotor: t.String(),
        vehiculoSerie: t.String(),
        vehiculoLinea: t.String(),
        vehiculoModelo: t.String(),
        vehiculoCm3: t.String(),
        vehiculoAsientos: t.String(),
        vehiculoCilindros: t.String(),
        vehiculoIscv: t.String(),
        nombreDeudorFirma: t.String(), 
        firmaCashIn: t.String(), // Nueva firma de CashIn
      }),
    }
  )
  .post(
    "/generateNewCarLetterTemplate10", // 📌 endpoint Carta para Carro Nuevo
    async ({ body }) => {
      const { email, ...params } = body;
      return await generateCartaCarroNuevoSubmission(
        { ...params, firma: "" }, // 👈 firma vacía
        email
      );
    },
    {
      body: t.Object({
        email: t.String(),
        fecha: t.String(),
        nombreDeudor: t.String(),
        dpiDeudor: t.String(),
        vehiculoTipo: t.String(),
        vehiculoMarca: t.String(),
        vehiculoColor: t.String(),
        vehiculoUso: t.String(),
        vehiculoChasis: t.String(),
        vehiculoCombustible: t.String(),
        vehiculoMotor: t.String(),
        vehiculoSerie: t.String(),
        vehiculoLinea: t.String(),
        vehiculoModelo: t.String(),
        vehiculoCm3: t.String(),
        vehiculoAsientos: t.String(),
        vehiculoCilindros: t.String(),
        vehiculoIscv: t.String(),
        empresa: t.String(),
        nombreDeudorFirma: t.String(),
        dpiFirmaPersona: t.String(),
      }),
    }
  )
  .post(
    "/responsibilityDisclaimerWomanTemplate12",
    async ({ body }) => {
      const { email, ...params } = body;
      return await generateDescargoMujerSubmission(params, email);
    },
    {
      body: t.Object({
        email: t.String(),
        vehiculoTipo: t.String(),
        vehiculoMarca: t.String(),
        vehiculoColor: t.String(),
        vehiculoUso: t.String(),
        vehiculoChasis: t.String(),
        vehiculoCombustible: t.String(),
        vehiculoMotor: t.String(),
        vehiculoSerie: t.String(),
        vehiculoLinea: t.String(),
        vehiculoModelo: t.String(),
        vehiculoCm3: t.String(),
        vehiculoAsientos: t.String(),
        vehiculoCilindros: t.String(),
        vehiculoIscv: t.String(),
        nombreDeudora: t.String(),
        dpiDeudora: t.String(),
        dia: t.String(),
        mes: t.String(),
        año: t.String(),
        nombreDeudoraConfirm: t.String(),
        dpiDeudor: t.String(),
      }),
    }
  )
  .post(
    "/vehiclePurchaseThirdPartyWomanTemplate13",
    async ({ body }) => {
      const { email, ...params } = body;
      return await generateVehiclePurchaseThirdPartyWomanTemplate13Submission(
        params,
        email
      );
    },
    {
      body: t.Object({
        email: t.String(),
        año: t.Number(),
        mes: t.String(),
        dia: t.Number(),
        nombrePersona: t.String(),
        dpiPersona: t.String(),
        tipoVehiculo: t.String(),
        marcaVehiculo: t.String(),
        colorVehiculo: t.String(),
        usoVehiculo: t.String(),
        chasisVehiculo: t.String(),
        combustibleVehiculo: t.String(),
        motorVehiculo: t.String(),
        serieVehiculo: t.String(),
        lineaVehiculo: t.String(),
        modeloVehiculo: t.String(),
        cm3Vehiculo: t.String(),
        asientosVehiculo: t.String(),
        cilindrosVehiculo: t.String(),
        iscvVehiculo: t.String(),
        empresa: t.String(),
        nombreFirmaPersona: t.String(),
        dpiFirmaPersona: t.String(),
      }),
    }
  )
  .post(
    "/gpsAcceptanceLetterWomanTemplate14",
    async ({ body }) => {
      const { email, ...params } = body;
      const response = await generateCartaAceptacionGpsMujerSubmission(
        params,
        email
      );
      return response;
    },
    {
      body: t.Object({
        email: t.String(),
        fecha: t.String(),
        nombreDeudora: t.String(),
        tipo: t.String(),
        marca: t.String(),
        color: t.String(),
        uso: t.String(),
        chasis: t.String(),
        combustible: t.String(),
        motor: t.String(),
        serie: t.String(),
        linea: t.String(),
        modelo: t.String(),
        cm3: t.String(),
        asientos: t.String(),
        cilindros: t.String(),
        iscv: t.String(),
        dpiDeudora: t.String(),
      }),
    }
  )
  .post(
    "/vehicleTransferLetterWomanTemplate15",
    async ({ body }) => {
      const { email, ...params } = body;
      const response =
        await generateVehicleTransferLetterWomanTemplate15Submission(
          params,
          email
        );
      return response;
    },
    {
      body: t.Object({
        email: t.String(),
        fecha: t.String(),
        nombrePersona: t.String(),
        dpiPersona: t.String(),
        tipoVehiculo: t.String(),
        marcaVehiculo: t.String(),
        colorVehiculo: t.String(),
        usoVehiculo: t.String(),
        chasisVehiculo: t.String(),
        combustibleVehiculo: t.String(),
        motorVehiculo: t.String(),
        serieVehiculo: t.String(),
        lineaVehiculo: t.String(),
        modeloVehiculo: t.String(),
        cm3Vehiculo: t.String(),
        asientosVehiculo: t.String(),
        cilindrosVehiculo: t.String(),
        iscvVehiculo: t.String(),
        nombreFirmaPersona: t.String(),
        dpiFirmaPersona: t.String(),
      }),
    }
  )

  .post(
    "/debtAcknowledgementWomanTemplate16",
    async ({ body }) => {
      const { email, ...params } = body;
      const response =
        await generateReconocimientoDeudaMujerTemplate16Submission(
          params,
          email
        );
      return response;
    },
    {
      body: t.Object({
        email: t.String(),
        dia: t.String(),
        mes: t.String(),
        año: t.String(),
        edadAndresAsencio: t.String(),
        dpiAndresAsencio: t.String(),
        nombreDeudora: t.String(),
        edadDeudora: t.String(),
        estadoCivilDeudora: t.String(),
        profesionDeudora: t.String(),
        nacionalidadDeudora: t.String(),
        dpiDeudora: t.String(),
        capitalAdeudado: t.String(),
        mesesPrestamo: t.String(),
        cuotasMensuales: t.String(),
        porcentajeDeudaTexto: t.String(),
        porcentajeDeudaNumero: t.String(),
        porcentajeMoraTexto: t.String(),
        porcentajeMoraNumero: t.String(),
        direccionDeudora: t.String(),
        vehiculoTipo: t.String(),
        vehiculoMarca: t.String(),
        vehiculoColor: t.String(),
        vehiculoUso: t.String(),
        vehiculoChasis: t.String(),
        vehiculoCombustible: t.String(),
        vehiculoMotor: t.String(),
        vehiculoSerie: t.String(),
        vehiculoLinea: t.String(),
        vehiculoModelo: t.String(),
        vehiculoCm3: t.String(),
        vehiculoAsientos: t.String(),
        vehiculoCilindros: t.String(),
        vehiculoIscv: t.String(),
        nombreDeudoraFirma: t.String(), 
      }),
    }
  )
  .post(
    "/debtAcknowledgementManTemplate17",
    async ({ body }) => {
      const { email, ...params } = body;
      return await generateDebtAcknowledgementManTemplate17Submission(
        params,
        email
      );
    },
    {
      body: t.Object({
        email: t.String(),
        dia: t.String(),
        mes: t.String(),
        año: t.String(),
        edadRichard: t.String(),
        nombre: t.String(),
        edad: t.String(),
        dpiDeudor: t.String(),
        vehiculoTipo: t.String(),
        vehiculoMarca: t.String(),
        vehiculoColor: t.String(),
        vehiculoUso: t.String(),
        vehiculoChasis: t.String(),
        vehiculoCombustible: t.String(),
        vehiculoMotor: t.String(),
        vehiculoSerie: t.String(),
        vehiculoLinea: t.String(),
        vehiculoModelo: t.String(),
        vehiculoCm3: t.String(),
        vehiculoAsientos: t.String(),
        vehiculoCilindros: t.String(),
        vehiculoIscv: t.String(),
        duracion: t.String(),
        fechaInicioContrato: t.String(),
        direccionDeudor: t.String(),
      }),
    }
  )
  .post(
    "/debtAcknowledgementWomanTemplate18",
    async ({ body }) => {
      const { email, ...params } = body;
      return await generateDebtAcknowledgementWomanTemplate18Submission(
        params,
        email
      );
    },
    {
      body: t.Object({
        email: t.String(),
        dia: t.String(),
        mes: t.String(),
        año: t.String(),
        edadRichard: t.String(),
        nombre: t.String(),
        edad: t.String(),
        dpiDeudora: t.String(),
        vehiculoTipo: t.String(),
        vehiculoMarca: t.String(),
        vehiculoColor: t.String(),
        vehiculoUso: t.String(),
        vehiculoChasis: t.String(),
        vehiculoCombustible: t.String(),
        vehiculoMotor: t.String(),
        vehiculoSerie: t.String(),
        vehiculoLinea: t.String(),
        vehiculoModelo: t.String(),
        vehiculoCm3: t.String(),
        vehiculoAsientos: t.String(),
        vehiculoCilindros: t.String(),
        vehiculoIscv: t.String(),
        duracion: t.String(),
        fechaInicioContrato: t.String(),
        direccionDeudor: t.String(),
      }),
    }
  )
  .post(
    "/debtAcknowledgementWomanTemplate19",
    async ({ body }) => {
      const { email, ...params } = body;
      return await generateDebtAcknowledgementWomanTemplate19Submission(
        params,
        email
      );
    },
    {
      body: t.Object({
        email: t.String(),
        fecha: t.String(),
        nombreDeudora: t.String(),
        dpiDeudor: t.String(),
        vehiculoTipo: t.String(),
        vehiculoMarca: t.String(),
        vehiculoColor: t.String(),
        vehiculoUso: t.String(),
        vehiculoChasis: t.String(),
        vehiculoCombustible: t.String(),
        vehiculoMotor: t.String(),
        vehiculoSerie: t.String(),
        vehiculoLinea: t.String(),
        vehiculoModelo: t.String(),
        vehiculoCm3: t.String(),
        vehiculoAsientos: t.String(),
        vehiculoCilindros: t.String(),
        vehiculoIscv: t.String(),
        empresa: t.String(),
        nombreDeudoraFirma: t.String(),
        dpiFirmaPersona: t.String(),
      }),
    }
  )
.post(
  "/promissoryNoteManTemplate20",
  async ({ body }) => {
    const { email, ...params } = body;
    return await generatePromissoryNoteManTemplate20Submission(params, email);
  },
  {
    body: t.Object({
      email: t.String(),
      cantidad: t.String(),
      dia: t.Optional(t.String()),
      mes: t.Optional(t.String()),
      año: t.Optional(t.String()),
      estadoCivil: t.String(),
      nombreCompleto: t.String(),
      edad: t.String(),
      dpi: t.String(),
      direccion: t.String(),
      cantidadEnLetras: t.String(),
      diaLetras: t.Optional(t.String()),
      mesLetras: t.Optional(t.String()),
      añoLetras: t.Optional(t.String()),
    }),
  }
)
.post(
  "/promissoryNoteWomanTemplate21",
  async ({ body }) => {
    const { email, ...params } = body;
    return await generatePromissoryNoteWomanTemplate21Submission(params, email);
  },
  {
    body: t.Object({
      email: t.String(),
      cantidad: t.String(),
      dia: t.Optional(t.String()),
      mes: t.Optional(t.String()),
      año: t.Optional(t.String()),
      estadoCivil: t.String(),
      nombreCompleto: t.String(),
      edad: t.String(),
      dpi: t.String(),
      direccion: t.String(),
      cantidadEnLetras: t.String(),
      diaLetras: t.Optional(t.String()),
      mesLetras: t.Optional(t.String()),
      añoLetras: t.Optional(t.String()),
    }),
  }
)
.post(
  "/checkIssuanceLetterManTemplate22",
  async ({ body }) => {
    const { email, ...params } = body;
    return await generateCheckIssuanceLetterManTemplate22Submission(
      params,
      email
    );
  },
  {
    body: t.Object({
      email: t.String(),
      dia: t.String(),
      mes: t.String(),
      año: t.String(),
      entidad: t.String(),
      cantidad: t.String(),
      cuenta: t.String(),
      valor: t.String(),
      nombreCompleto: t.String(),
      dpi: t.String(),
    }),
  }
)
.post(
  "/checkIssuanceLetterWomanTemplate23",
  async ({ body }) => {
    const { email, ...params } = body;
    return await generateCheckIssuanceLetterWomanTemplate23Submission(
      params,
      email
    );
  },
  {
    body: t.Object({
      email: t.String(),
      dia: t.String(),
      mes: t.String(),
      año: t.String(),
      entidad: t.String(),
      cantidad: t.String(),
      cuenta: t.String(),
      valor: t.String(),
      nombreCompleto: t.String(),
      dpi: t.String(),
    }),
  }
)
.post(
  "/movableGuaranteeManTemplate24",
  async ({ body }) => {
    const { email, ...params } = body;
    return await generateMovableGuaranteeManTemplate24Submission(params, email);
  },
  {
    body: t.Object({
      email: t.String(),

      // 📅 Fechas principales
      dia: t.String(),
      mes: t.String(),
      año: t.String(),

      // 👤 Datos personales
      edadAndres: t.String(),
      nombreCompleto: t.String(),
      edad: t.String(),
      estadoCivil: t.String(),
      dpiLetras: t.String(),

      // 💰 Monto principal
      montoLetras: t.String(),

      // 🚗 Datos del vehículo
      vehiculoTipo: t.String(),
      vehiculoMarca: t.String(),
      vehiculoColor: t.String(),
      vehiculoUso: t.String(),
      vehiculoChasis: t.String(),
      vehiculoCombustible: t.String(),
      vehiculoMotor: t.String(),
      vehiculoSerie: t.String(),
      vehiculoLinea: t.String(),
      vehiculoModelo: t.String(),
      vehiculoCm3: t.String(),
      vehiculoAsientos: t.String(),
      vehiculoCilindros: t.String(),
      vehiculoIscv: t.String(),

      // 📆 Plazos
      plazoTexto: t.String(),
      plazo: t.String(),
      añoLetras: t.String(),

      // 📍 Contacto
      direccion: t.String(),
      correo: t.String(),
    }),
  }
)
.post(
  "/movableGuaranteeWomanTemplate25",
  async ({ body }) => {
    const { email, ...params } = body;
    return await generateMovableGuaranteeWomanTemplate25Submission(
      params,
      email
    );
  },
  {
    body: t.Object({
      email: t.String(),

      // 📅 Fechas principales
      dia: t.String(),
      mes: t.String(),
      año: t.String(),

      // 👤 Datos personales
      edadAndres: t.String(),
      nombreCompleto: t.String(),
      edad: t.String(),
      estadoCivil: t.String(),
      dpiLetras: t.String(),

      // 💰 Monto principal
      montoLetras: t.String(),

      // 🚗 Datos del vehículo
      vehiculoTipo: t.String(),
      vehiculoMarca: t.String(),
      vehiculoColor: t.String(),
      vehiculoUso: t.String(),
      vehiculoChasis: t.String(),
      vehiculoCombustible: t.String(),
      vehiculoMotor: t.String(),
      vehiculoSerie: t.String(),
      vehiculoLinea: t.String(),
      vehiculoModelo: t.String(),
      vehiculoCm3: t.String(),
      vehiculoAsientos: t.String(),
      vehiculoCilindros: t.String(),
      vehiculoIscv: t.String(),

      // 📆 Plazos
      plazoTexto: t.String(),
      plazo: t.String(),
      añoLetras: t.String(),

      // 📍 Contacto
      direccion: t.String(),
      correo: t.String(),
    }),
  }
)
 .get("/documents", async () => {
    try {
      // 🎯 Call the controller that retrieves all documents
      const response = await getDocusealDocumentsController();
      return response;
    } catch (error: any) {
      console.error("[ERROR] /docuseal/documents route:", error);
      return {
        success: false,
        message: "Internal server error while fetching DocuSeal documents",
        error: error.message,
      };
    }
  })
  .post(
    "/document-by-dpi",
    async ({ body }) => {
      const { dpi, documentName } = body;

      // 🧠 Llamamos al controller que maneja RENAP + query en DB
      const result = await getDocumentsByDpiController(dpi, documentName);
      return result;
    },
    {
      body: t.Object({
        dpi: t.String(),
        documentName: t.String(),
      }),
    }
  );

export default docuSealRouter;
 