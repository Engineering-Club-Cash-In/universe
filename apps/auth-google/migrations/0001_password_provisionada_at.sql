-- Marca de "esta contraseña la generamos nosotros, no su dueño".
--
-- La escribe el provisionamiento al crear la cuenta y se limpia sola en cuanto
-- la persona elige la suya. Mientras tenga fecha, el portal la manda a la
-- pantalla de cambio de contraseña antes de dejarla entrar.
--
-- Nace NULL para TODAS las cuentas que ya existen, y eso es deliberado: a nadie
-- que ya estaba se le pide cambiar nada. Solo las cuentas creadas después de
-- correr esta migración quedan marcadas.
--
-- ORDEN DE DESPLIEGUE: esta migración va ANTES de subir el código. auth-google
-- lee la columna en cada consulta de sesión; si el código sube primero, el
-- login se cae con "column does not exist".
--
-- Como el despliegue de producción NO corre migraciones —ninguna app de este
-- repo las corre desde CI—, `src/db/columnasRequeridas.ts` repite esta misma
-- sentencia al arrancar el servicio, por si el despliegue llega antes. Esta
-- sigue siendo la migración de verdad; aquello es solo la red.

ALTER TABLE "auth-google"."users"
  ADD COLUMN IF NOT EXISTS "password_provisionada_at" timestamp;
