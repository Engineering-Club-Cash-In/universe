import { expect, test } from "bun:test";
import { textoTokenNexa } from "./textoTokenNexa";

const base = { isLoading: false, error: null };

test("binding inactivo: avisa que no recibe pagos, en gris, aunque tenga token", () => {
  expect(textoTokenNexa({ ...base, credito: { nexaToken: "32200100000002", bindingActivo: false } })).toEqual({
    texto: "Token Nexa inactivo: no recibe pagos",
    tono: "gris",
  });
});

test("binding activo con token: muestra el token", () => {
  expect(textoTokenNexa({ ...base, credito: { nexaToken: "32200100000002", bindingActivo: true } })).toEqual({
    texto: "32200100000002",
    tono: "token",
  });
});

test("binding activo sin token: habilitado sin token registrado", () => {
  expect(textoTokenNexa({ ...base, credito: { nexaToken: null, bindingActivo: true } })).toEqual({
    texto: "Habilitado para Nexa, sin token registrado",
    tono: "gris",
  });
});

test("sin crédito, cargando y error", () => {
  expect(textoTokenNexa({ ...base, credito: undefined }).texto).toBe("Este crédito no está habilitado para Nexa");
  expect(textoTokenNexa({ isLoading: true, error: null, credito: undefined }).texto).toBe("Cargando…");
  expect(textoTokenNexa({ isLoading: false, error: new Error("x"), credito: undefined })).toEqual({
    texto: "No se pudo consultar el token de Nexa",
    tono: "error",
  });
});
