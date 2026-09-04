-- NOTA: aplicar a mano en dev y prod (Cartera aplica el SQL a mano, no drizzle-kit).
--
-- Marca de procedencia: id de la cuenta de auth-google que dio de alta esta
-- fila desde el registro del portal. Es lo que permite que un registro a
-- medias reconozca la fila que ÉL creó al reintentar.
--
-- Antes eso se decidía comparando correo + DPI + nombre, y esa heurística no
-- podía funcionar: la consulta por correo de cartera devuelve
-- `dpi: dpi_rep_legal` cuando la fila tiene representante legal, así que las
-- filas de sociedad (con `dpi` NULL) pasaban la comparación con el DPI del
-- representante y una cuenta del portal podía adueñarse de ellas.
--
-- SIN BACKFILL A PROPÓSITO. Toda fila existente se queda en NULL: ninguna la
-- creó el portal, y ese NULL es justo lo que impide que se reclamen. Solo el
-- alta desde el registro del portal escribe esta columna; carteraFront, el CRM
-- y las importaciones la dejan en NULL.
--
-- Nullable y sin default: aditiva y retrocompatible.
ALTER TABLE cartera.inversionistas
  ADD COLUMN IF NOT EXISTS creado_por_usuario_portal text;
