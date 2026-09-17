import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PaymentStatusBadges } from "./PaymentStatusBadges";

const render = (payment) => renderToStaticMarkup(<PaymentStatusBadges payment={payment} />);

it("renderiza por separado registro, validación pendiente y cuota pendiente", () => {
  const html = render({
    pagado: true,
    paymentFalse: false,
    validationStatus: "pending",
    cuota_pagada: false,
  });
  expect(html).toContain("Registrado completo");
  expect(html).toContain("Validación pendiente");
  expect(html).toContain("Cuota pendiente");
  expect(html).not.toContain(">Sí<");
});

it("renderiza pago validado y cuota pagada", () => {
  const html = render({
    pagado: true,
    paymentFalse: false,
    validationStatus: "validated",
    cuota_pagada: true,
  });
  expect(html).toContain("Registrado completo");
  expect(html).toContain("Validado");
  expect(html).toContain("Cuota pagada");
});

it("renderiza un pago anulado como no válido", () => {
  const html = render({
    pagado: false,
    paymentFalse: true,
    validationStatus: "pending",
    cuota_pagada: false,
  });
  expect(html).toContain("Pago anulado");
  expect(html).toContain("No válido");
  expect(html).toContain("Cuota pendiente");
});
