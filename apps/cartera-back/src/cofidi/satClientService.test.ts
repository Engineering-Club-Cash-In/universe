import { describe, expect, it } from "bun:test";
import { SATClientService } from "./satClientService";

const svc = new SATClientService(
  { requestor: "req", user: "user", userName: "userName", entity: "123456" },
  "https://example.invalid/ws"
);

// Acceso al parser privado: no queremos pegarle a COFIDI en un unit test
const parsear = (soap: string) =>
  (svc as any).parsearRespuestaCertificacion(soap);

const soapCertificacion = (batch: string, serial: string, guid: string) => `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <RequestTransactionResponse xmlns="http://www.fact.com.mx/schema/ws">
      <RequestTransactionResult>
        <Response>
          <Result>true</Result>
          <Code>1</Code>
          <Description>OK</Description>
          <Hint></Hint>
          <Identifier>
            <Batch>${batch}</Batch>
            <Serial>${serial}</Serial>
            <DocumentGUID>${guid}</DocumentGUID>
          </Identifier>
        </Response>
        <ResponseData>
          <ResponseData1>UEsDBA==</ResponseData1>
        </ResponseData>
      </RequestTransactionResult>
    </RequestTransactionResponse>
  </soap:Body>
</soap:Envelope>`;

describe("parsearRespuestaCertificacion — serie/numero como strings", () => {
  it("no convierte a Infinity una serie hex con forma de notación científica (3E722147)", () => {
    // Caso real: serie 3E722147 → Number('3E722147') = 3×10^722147 = Infinity
    const r = parsear(
      soapCertificacion("3E722147", "1103581021", "3E722147-41C7-4F5D-81B9-7C8C222257EC")
    );
    expect(r.batch).toBe("3E722147");
    expect(r.serial).toBe("1103581021");
    expect(r.documentGUID).toBe("3E722147-41C7-4F5D-81B9-7C8C222257EC");
  });

  it("no expande una serie tipo 476589E6 a 476589000000", () => {
    const r = parsear(
      soapCertificacion("476589E6", "999", "476589E6-0000-4000-8000-000000000000")
    );
    expect(r.batch).toBe("476589E6");
  });

  it("no pierde el cero inicial de una serie numérica (09302093)", () => {
    const r = parsear(
      soapCertificacion("09302093", "888", "09302093-0000-4000-8000-000000000000")
    );
    expect(r.batch).toBe("09302093");
  });

  it("sigue reportando el error cuando la certificación falla", () => {
    const soapError = soapCertificacion("X", "Y", "Z").replace(
      "<Result>true</Result>",
      "<Result>false</Result>"
    );
    expect(() => parsear(soapError)).toThrow(/Certificación falló/);
  });
});
