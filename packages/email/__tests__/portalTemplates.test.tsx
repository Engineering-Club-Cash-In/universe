import { describe, expect, test } from "bun:test";
import * as React from "react";
import { render } from "@react-email/components";
import PortalWelcomeEmail from "../src/templates/PortalWelcomeTemplate";
import PortalCompanyAddedEmail from "../src/templates/PortalCompanyAddedTemplate";

// Estas pruebas NO envían correo: solo renderizan las plantillas para
// comprobar que el HTML sale con los datos que recibe y sin placeholders.
// Importan las plantillas directamente (no src/index.ts) porque ese módulo
// instancia Resend y exige RESEND_API_KEY / EMAIL_DOMAIN al importarse.

const assets = {
  headerBanner: "https://assets.example/header-mail-V2.png",
  footerBanner: "https://assets.example/footer-mail.png",
};

describe("PortalWelcomeEmail", () => {
  test("renderiza nombre, correo, contraseña y enlace al portal", async () => {
    const html = await render(
      React.createElement(PortalWelcomeEmail, {
        investorName: "María José Ordóñez",
        loginEmail: "maria.ordonez@ejemplo.com",
        password: "Xq7-tR2m",
        portalUrl: "https://portal.clubcashin.com",
        assets,
      }),
    );

    expect(html).toContain("María José Ordóñez");
    expect(html).toContain("maria.ordonez@ejemplo.com");
    expect(html).toContain("Xq7-tR2m");
    expect(html).toContain("https://portal.clubcashin.com");
    expect(html).toContain(assets.headerBanner);
    expect(html).toContain("cambiar la contraseña");
  });

  test("lista las empresas solo cuando se pasan", async () => {
    const base = {
      investorName: "Carlos Similox",
      loginEmail: "carlos@ejemplo.com",
      password: "abc12345",
      portalUrl: "https://portal.clubcashin.com",
      assets,
    };

    const conEmpresas = await render(
      React.createElement(PortalWelcomeEmail, {
        ...base,
        companyNames: ["Inversiones Similox, S.A.", "Agro Petén, S.A."],
      }),
    );
    expect(conEmpresas).toContain("Inversiones Similox, S.A.");
    expect(conEmpresas).toContain("Agro Petén, S.A.");

    const sinEmpresas = await render(React.createElement(PortalWelcomeEmail, base));
    expect(sinEmpresas).not.toContain("representante legal");
  });

  test("renderiza aunque falten los banners", async () => {
    const html = await render(
      React.createElement(PortalWelcomeEmail, {
        investorName: "Ana López",
        loginEmail: "ana@ejemplo.com",
        password: "clave-1234",
        portalUrl: "https://portal.clubcashin.com",
      }),
    );

    expect(html).toContain("Ana López");
    expect(html).toContain("clave-1234");
  });
});

describe("PortalCompanyAddedEmail", () => {
  test("renderiza la empresa agregada y el enlace, sin credenciales", async () => {
    const html = await render(
      React.createElement(PortalCompanyAddedEmail, {
        investorName: "Luis Guzmán",
        companyName: "Transportes Guzmán, S.A.",
        portalUrl: "https://portal.clubcashin.com",
        assets,
      }),
    );

    expect(html).toContain("Luis Guzmán");
    expect(html).toContain("Transportes Guzmán, S.A.");
    expect(html).toContain("https://portal.clubcashin.com");
    // No debe hablar de contraseña nueva: la persona ya tiene la suya.
    expect(html).toContain("misma contraseña de siempre");
    expect(html).not.toContain("Contraseña:");
  });
});
