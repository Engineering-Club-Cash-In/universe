// ============================================================
// SOLO CONSULTA: trae un DTE de SAT vía COFIDI (GET_DOCUMENT) por UUID,
// lo parsea y lo imprime. NO toca la base de datos ni R2.
//
// USO:
//   bun run src/scripts/consultar-uuid-sat.ts <UUID> [--xml]
// ============================================================
import { XMLParser } from "fast-xml-parser";
import { SATClientService } from "../cofidi/satClientService";
import {
  SAT_CONFIG,
  SE_PRESTA_SAT_CONFIG,
  AMJK_SAT_CONFIG,
  CREACION_IMAGEN_SAT_CONFIG,
  GRUPO_BATRO_SAT_CONFIG,
  AUTOCASH_SAT_CONFIG,
} from "../utils/functions/const";

const uuid = process.argv[2];
const MOSTRAR_XML = process.argv.includes("--xml");

// Formato validado antes de interpolarlo en el SOAP.
const UUID_RE = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
if (!uuid || !UUID_RE.test(uuid)) {
  console.error("Uso: bun run src/scripts/consultar-uuid-sat.ts <UUID> [--xml]");
  if (uuid) console.error(`UUID con formato inválido: ${uuid}`);
  process.exit(1);
}

const nitDeConfig = (cfg: any): string => cfg.entity ?? cfg.nit;

const SAT_CONFIGS = [
  ["CUBE", SAT_CONFIG],
  ["SE_PRESTA", SE_PRESTA_SAT_CONFIG],
  ["AMJK", AMJK_SAT_CONFIG],
  ["CREACION_IMAGEN", CREACION_IMAGEN_SAT_CONFIG],
  ["GRUPO_BATRO", GRUPO_BATRO_SAT_CONFIG],
  ["AUTOCASH", AUTOCASH_SAT_CONFIG],
].filter(([, cfg]: any) => cfg.requestor && cfg.endpointUrl) as [string, any][];

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

async function main() {
  console.log(`\n🔎 Consultando UUID ${uuid}`);
  console.log(`   Emisores a probar: ${SAT_CONFIGS.map(([n]) => n).join(", ")}\n`);

  for (const [nombre, cfg] of SAT_CONFIGS) {
    const client = new SATClientService(
      {
        requestor: cfg.requestor,
        user: cfg.requestor,
        userName: cfg.userName,
        entity: nitDeConfig(cfg),
      },
      cfg.endpointUrl
    );
    let xml: string;
    try {
      const r = await client.obtenerPorUUID(uuid);
      if (!r.encontrado || !r.xmlCertificado) {
        console.log(`   · ${nombre}: no encontrada (${r.mensaje ?? "sin mensaje"})`);
        continue;
      }
      xml = Buffer.from(r.xmlCertificado, "base64").toString("utf-8");
    } catch (e) {
      console.log(`   · ${nombre}: error consulta (${(e as Error).message})`);
      continue;
    }

    // A partir de acá la factura EXISTE en SAT. El parseo va en su propio try:
    // si reventara (p.ej. un exento sin dte:TotalImpuestos), decir "no existe"
    // empujaría al operador a re-certificar un duplicado.
    console.log(`\n✅ ENCONTRADA con credenciales de ${nombre}\n`);
    try {
      const parsed = parser.parse(xml);
      const dte = parsed["dte:GTDocumento"]["dte:SAT"]["dte:DTE"];
      const de = dte["dte:DatosEmision"];
      const cert = dte["dte:Certificacion"];
      const numAut = cert["dte:NumeroAutorizacion"];
      const totales = de["dte:Totales"];
      const items = Array.isArray(de["dte:Items"]["dte:Item"])
        ? de["dte:Items"]["dte:Item"]
        : [de["dte:Items"]["dte:Item"]];

      console.log(`   Tipo:        ${de["dte:DatosGenerales"]["@_Tipo"]}`);
      console.log(`   Serie-Num:   ${numAut["@_Serie"]}-${numAut["@_Numero"]}`);
      console.log(`   UUID:        ${numAut["#text"]}`);
      console.log(`   Emisor:      ${de["dte:Emisor"]["@_NITEmisor"]} ${de["dte:Emisor"]["@_NombreEmisor"]}`);
      console.log(`   Receptor:    ${de["dte:Receptor"]["@_IDReceptor"]} ${de["dte:Receptor"]["@_NombreReceptor"]}`);
      console.log(`   Emisión:     ${de["dte:DatosGenerales"]["@_FechaHoraEmision"]}`);
      console.log(`   Certificado: ${cert["dte:FechaHoraCertificacion"]}`);
      console.log(`   Certificador:${cert["dte:NITCertificador"]} ${cert["dte:NombreCertificador"]}`);
      console.log(`   GranTotal:   Q${totales["dte:GranTotal"]} (IVA Q${totales["dte:TotalImpuestos"]["dte:TotalImpuesto"]["@_TotalMontoImpuesto"]})`);
      for (const it of items) {
        console.log(`   Ítem ${it["@_NumeroLinea"]}: ${it["dte:Descripcion"]} | Q${it["dte:Total"]}`);
      }

      const comp = de["dte:Complementos"]?.["dte:Complemento"];
      const abonosData = comp?.["cfc:AbonosFacturaCambiaria"]?.["cfc:Abono"];
      const abonos = abonosData ? (Array.isArray(abonosData) ? abonosData : [abonosData]) : [];
      for (const a of abonos) {
        console.log(
          `   Abono ${a["cfc:NumeroAbono"]}: venc ${a["cfc:FechaVencimiento"]} Q${a["cfc:MontoAbono"]}`
        );
      }

      if (MOSTRAR_XML) console.log(`\n--- XML ---\n${xml}\n`);
    } catch (e) {
      console.error(`   ⚠️ Encontrada pero no se pudo parsear: ${(e as Error).message}`);
      console.error(`   Volver a correr con --xml para ver el documento crudo.`);
    }
    process.exit(0);
  }

  console.log(`\n❌ No se encontró con ningún emisor.`);
  process.exit(1);
}

main().catch((e) => {
  console.error("💥 Error:", e);
  process.exit(1);
});
