# Contacto asesor WhatsApp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar nombre y teléfono del asesor en mensajes con documento de Estado de Cuenta y Recibo de Pago, con fallback resiliente a cartera-back.

**Architecture:** Helper puro/inyectable centraliza prioridad de contacto: payload completo de recibo, luego `getResumenCredito(numeroSifco).asesor`, luego `null`. Ambos servicios construyen mismo cierre mediante helper; fallo enriquecimiento nunca bloquea envío.

**Tech Stack:** TypeScript, Bun test, cartera-back client, SimpleTech.

---

### Task 1: Crear resolver compartido con pruebas TDD

**Files:**
- Create: `apps/server/src/services/asesor-whatsapp.ts`
- Create: `apps/server/src/services/asesor-whatsapp.test.ts`

- [ ] **Step 1: Escribir pruebas fallidas**

```ts
test("prioriza contacto completo recibido sin consultar cartera", async () => {
  const obtener = mock(async () => ({ nombre: "Ignorado", telefono: "000" }));
  await expect(resolverContactoAsesor("SIFCO", { nombre: "Carlos Ruiz", telefono: "41234567" }, obtener)).resolves.toEqual({ nombre: "Carlos Ruiz", telefono: "41234567" });
  expect(obtener).not.toHaveBeenCalled();
});

test("contacto recibido incompleto usa asesor del resumen", async () => {
  await expect(resolverContactoAsesor("SIFCO", { nombre: "Carlos", telefono: null }, async () => ({ nombre: "Ana Pérez", telefono: "49998888" }))).resolves.toEqual({ nombre: "Ana Pérez", telefono: "49998888" });
});

test("falla o asesor incompleto devuelve null", async () => {
  await expect(resolverContactoAsesor("SIFCO", null, async () => { throw new Error("caído"); })).resolves.toBeNull();
  await expect(resolverContactoAsesor("SIFCO", null, async () => ({ nombre: "Ana", telefono: null }))).resolves.toBeNull();
});
```

- [ ] **Step 2: Ejecutar RED**

Run: `bun test apps/server/src/services/asesor-whatsapp.test.ts`

Expected: FAIL; módulo no existe.

- [ ] **Step 3: Implementar mínimo helper**

```ts
export type ContactoAsesor = { nombre: string; telefono: string };
export type ObtenerAsesor = (numeroSifco: string) => Promise<{ nombre: string | null; telefono: string | null } | null>;

const completo = (valor: { nombre: string | null | undefined; telefono: string | null | undefined } | null | undefined): ContactoAsesor | null => {
  const nombre = valor?.nombre?.trim() ?? "";
  const telefono = valor?.telefono?.trim() ?? "";
  return nombre && telefono ? { nombre, telefono } : null;
};

export async function resolverContactoAsesor(numeroSifco: string, preferido: { nombre?: string | null; telefono?: string | null } | null, obtener: ObtenerAsesor): Promise<ContactoAsesor | null> {
  const directo = completo(preferido);
  if (directo) return directo;
  try { return completo(await obtener(numeroSifco)); } catch { return null; }
}
```

- [ ] **Step 4: Ejecutar GREEN**

Run: `bun test apps/server/src/services/asesor-whatsapp.test.ts`

Expected: PASS.

### Task 2: Aplicar helper a Estado de Cuenta con TDD

**Files:**
- Modify: `apps/server/src/services/send-estado-cuenta-whatsapp.ts`
- Modify: `apps/server/src/services/send-estado-cuenta-whatsapp.test.ts`

- [ ] **Step 1: Escribir prueba fallida de asesor desde resumen**

```ts
test("envía estado de cuenta con asesor obtenido desde resumen", async () => {
  let enviado: any;
  const { deps } = buildDeps({
    obtenerAsesor: mock(async () => ({ nombre: "Carlos Ruiz", telefono: "41234567" })),
    enviar: mock(async (p: any) => { enviado = p; return { success: true }; }),
  });
  await sendEstadoCuentaWhatsapp({ casoCobroId: CASO_ID, userId: "u1" }, deps);
  expect(enviado.message).toContain("Carlos Ruiz al 41234567");
});
```

- [ ] **Step 2: Ejecutar RED**

Run: `bun test apps/server/src/services/send-estado-cuenta-whatsapp.test.ts`

Expected: FAIL; `obtenerAsesor` no existe.

- [ ] **Step 3: Implementar integración mínima**

Agregar dependencia `obtenerAsesor?: ObtenerAsesor`, default `async sifco => (await carteraBackClient.getResumenCredito(sifco))?.asesor ?? null`, resolver después de teléfono válido. Pasar contacto a constructor. Constructor recibe `ContactoAsesor | null` y termina en:

```ts
const cierre = asesor
  ? `Cualquier duda, llama a tu asesor ${asesor.nombre} al ${asesor.telefono}.`
  : "Cualquier duda, comunícate con tu asesor.";
```

- [ ] **Step 4: Ejecutar GREEN**

Run: `bun test apps/server/src/services/send-estado-cuenta-whatsapp.test.ts`

Expected: PASS.

### Task 3: Aplicar helper a Recibo de Pago con TDD

**Files:**
- Modify: `apps/server/src/services/send-recibo-pago-whatsapp.ts`
- Modify: `apps/server/src/services/send-recibo-pago-whatsapp.test.ts`

- [ ] **Step 1: Escribir pruebas fallidas**

```ts
test("recibo usa asesor recibido sin consultar fallback", async () => {
  let mensaje = "";
  const obtenerAsesor = mock(async () => ({ nombre: "Ignorado", telefono: "00000000" }));
  const { deps } = buildDeps({ obtenerAsesor, enviar: mock(async (p: any) => { mensaje = p.message; return { success: true }; }) });
  await sendReciboPagoWhatsapp(baseParams({ asesorNombre: "Carlos Ruiz", asesorTelefono: "41234567" }), deps);
  expect(mensaje).toContain("Carlos Ruiz al 41234567");
  expect(obtenerAsesor).not.toHaveBeenCalled();
});

test("recibo completa asesor desde resumen cuando payload es incompleto", async () => {
  let mensaje = "";
  const { deps } = buildDeps({
    obtenerAsesor: mock(async () => ({ nombre: "Ana Pérez", telefono: "49998888" })),
    enviar: mock(async (p: any) => { mensaje = p.message; return { success: true }; }),
  });
  await sendReciboPagoWhatsapp(baseParams({ asesorNombre: "Carlos", asesorTelefono: null }), deps);
  expect(mensaje).toContain("Ana Pérez al 49998888");
});

test("recibo conserva cierre genérico si resumen falla", async () => {
  let mensaje = "";
  const { deps } = buildDeps({
    obtenerAsesor: mock(async () => { throw new Error("cartera caída"); }),
    enviar: mock(async (p: any) => { mensaje = p.message; return { success: true }; }),
  });
  const resultado = await sendReciboPagoWhatsapp(baseParams(), deps);
  expect(resultado.sent).toBe(true);
  expect(mensaje).toContain("comunícate con tu asesor");
});
```

- [ ] **Step 2: Ejecutar RED**

Run: `bun test apps/server/src/services/send-recibo-pago-whatsapp.test.ts`

Expected: FAIL; `obtenerAsesor` no existe.

- [ ] **Step 3: Implementar integración mínima**

Agregar misma dependencia opcional y default que Estado de Cuenta. Resolver usando `{ nombre: asesorNombre, telefono: asesorTelefono }`, pasar contacto a `construirMensajeReciboPago`, y reemplazar lógica local de cierre por misma forma usada en Estado de Cuenta.

- [ ] **Step 4: Ejecutar GREEN**

Run: `bun test apps/server/src/services/send-recibo-pago-whatsapp.test.ts`

Expected: PASS.

### Task 4: Verificación integrada

**Files:** Ninguno.

- [ ] **Step 1: Ejecutar suite enfocada**

Run: `bun test apps/server/src/services/asesor-whatsapp.test.ts apps/server/src/services/send-estado-cuenta-whatsapp.test.ts apps/server/src/services/send-recibo-pago-whatsapp.test.ts`

Expected: PASS.

- [ ] **Step 2: Verificar tipos y formato**

Run: `bun run --cwd apps/server check-types && bunx biome check apps/server/src/services/asesor-whatsapp.ts apps/server/src/services/asesor-whatsapp.test.ts apps/server/src/services/send-estado-cuenta-whatsapp.ts apps/server/src/services/send-estado-cuenta-whatsapp.test.ts apps/server/src/services/send-recibo-pago-whatsapp.ts apps/server/src/services/send-recibo-pago-whatsapp.test.ts && git diff --check`

Expected: código 0.

- [ ] **Step 3: Commit**

Run: `git add apps/server/src/services/asesor-whatsapp.ts apps/server/src/services/asesor-whatsapp.test.ts apps/server/src/services/send-estado-cuenta-whatsapp.ts apps/server/src/services/send-estado-cuenta-whatsapp.test.ts apps/server/src/services/send-recibo-pago-whatsapp.ts apps/server/src/services/send-recibo-pago-whatsapp.test.ts && git commit -m "feat(crm): incluir asesor en documentos WhatsApp"`

Expected: commit creado con solo cambio funcional y pruebas.
