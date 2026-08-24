# Contacto de asesor en documentos de WhatsApp

**Fecha:** 2026-08-24  
**Estado:** Aprobado para revisión

## Objetivo

Los mensajes de WhatsApp con documento adjunto de **Estado de Cuenta** y
**Recibo de Pago** deben indicar nombre y teléfono del asesor asignado cuando
esa información exista.

## Origen y prioridad de datos

1. Recibo de Pago usa primero `asesorNombre` y `asesorTelefono` recibidos de
   cartera-back en el webhook.
2. Si falta cualquiera de esos datos, CRM consulta
   `carteraBackClient.getResumenCredito(numeroSifco)`, cuyo contrato contiene
   `asesor: { nombre, telefono }`.
3. Estado de Cuenta no recibe datos de asesor; obtiene los datos desde el mismo
   resumen de cartera-back.
4. Si el resumen no tiene asesor o teléfono, se conserva cierre genérico para
   enviar documento sin bloquear cliente.

CRM no almacena teléfono en tabla `user`; `responsableCobros` solo identifica
usuario asignado. Por eso cartera-back sigue siendo fuente de teléfono.

## Arquitectura

Crear helper reutilizable de contacto de asesor, inyectable en pruebas:

```ts
resolverContactoAsesor({ numeroSifco, preferido })
  -> preferido completo
  -> getResumenCredito(numeroSifco).asesor
  -> null
```

El helper normaliza espacios. No sustituye parcialmente datos: si fuente
preferida no contiene ambos nombre y teléfono, usa fuente de cartera para
evitar combinar asesor/número de asignaciones distintas.

Cada servicio usa resultado para construir cierre:

`Para cualquier duda, comunícate con tu asesor {nombre} al {teléfono}.`

Sin contacto completo mantiene cierre genérico actual.

## Flujo

```
Estado de Cuenta ─┐
                  ├─ resolverContactoAsesor ─► mensaje WhatsApp
Recibo de Pago ───┘        │
                           ├─ payload webhook (solo recibo)
                           └─ GET /credito/resumen (fallback)
```

Para Estado de Cuenta, búsqueda asesor ocurre después de validar caso/teléfono
y antes de enviar WhatsApp. PDF generado conserva flujo actual. Para Recibo,
consulta remota ocurre solo cuando payload no contiene contacto completo.

## Errores y resiliencia

- Fallo consultando resumen no cancela documento: registrar error y usar cierre
  genérico.
- `null` de resumen o asesor incompleto tampoco cancela envío.
- No agregar reintentos: servicios actuales evitan duplicar documentos/mensajes.

## Pruebas

- Helper: preferido completo evita llamada a cartera.
- Helper: preferido incompleto usa asesor de resumen.
- Helper: resumen sin teléfono devuelve `null`.
- Helper: error de cartera devuelve `null`.
- Estado de Cuenta: mensaje incluye asesor resuelto por fallback.
- Recibo de Pago: conserva contacto recibido; usa fallback cuando falta.
- Ambos: cierre genérico cuando no hay contacto completo.

## Alcance

Solo servicios CRM y pruebas. No cambia endpoint webhook, esquema BD, plantilla
WittyBots ni rutas de cartera-back.
