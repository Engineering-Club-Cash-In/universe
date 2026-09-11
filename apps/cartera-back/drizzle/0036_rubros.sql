-- NOTA: aplicar a mano en dev y prod (Cartera aplica el SQL a mano, no drizzle-kit).
--
-- Rubros: cobros adicionales por crédito (ej. tarjeta de circulación) que se
-- consumen del disponible de cada pago, aparte de la amortización normal.
--
-- El TIPO define la NATURALEZA del cobro —si es obligatorio o no—, y el rubro
-- guarda sólo el caso concreto: a qué crédito, por cuánto, con qué saldo. No
-- hay periodicidad ni activación programada: el rubro se cobra desde que se
-- crea, y un índice único parcial deja UNO VIVO por crédito+tipo — cuando ese
-- se salda (`completado`), el mismo concepto se puede volver a cobrar con una
-- fila nueva, que conserva su propio saldo e historial.
--
-- rubros_tipos es el catálogo editable (admin da de alta tipos de rubro);
-- rubros son las instancias por crédito; rubros_historial es el log de eventos
-- (creación, edición de monto, abonos, activación/desactivación, reversas) que
-- consumen cada rubro.
--
-- Todo en el schema cartera. IF NOT EXISTS / guards para que el archivo sea
-- re-ejecutable sin romper si ya se aplicó parcialmente.

DO $$ BEGIN
  CREATE TYPE cartera.rubro_evento AS ENUM (
    'creacion',
    'edicion_monto',
    'edicion',
    'abono',
    'activacion',
    'desactivacion',
    'reversa',
    -- Un rubro cargado por error no se borra (su historial es evidencia) ni se
    -- edita a 0 (un rubro de Q0 no es un rubro): se ANULA. La fila conserva su
    -- monto_original y sale del índice único, liberando el tipo para el rubro
    -- correcto.
    'anulacion'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- `asesor` va aparte de `admin`: el alta de rubros dejó de ser ADMIN-only, y
-- con un solo valor para "escritura manual" el historial no puede responder
-- qué rubros dio de alta un asesor — que es justo para lo que existe.
DO $$ BEGIN
  CREATE TYPE cartera.rubro_origen AS ENUM ('admin', 'asesor', 'job', 'pago', 'reversa');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- OJO si en el futuro hay que AGREGAR un valor a alguno de estos dos enums:
-- `ALTER TYPE ... ADD VALUE` NO puede correr dentro de un bloque de
-- transacción, así que NO va en este archivo. Acá vivía un
-- `ALTER TYPE cartera.rubro_origen ADD VALUE IF NOT EXISTS 'asesor'` que sólo
-- servía para el caso de re-ejecución (el CREATE TYPE de arriba ya trae todos
-- los valores), pero hacía abortar el archivo ENTERO cuando se aplicaba con
-- `psql -1` —lo prudente en producción—, y encima después de que las tablas
-- parecían haberse creado. El valor nuevo se agrega en un ALTER suelto, fuera
-- de transacción, antes o después de correr este archivo.

CREATE TABLE IF NOT EXISTS cartera.rubros_tipos (
  tipo_id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  -- La naturaleza del cobro vive acá y no en cada rubro: quien da de alta un
  -- rubro elige el CONCEPTO, no si ese concepto puede saltarse los frenos de
  -- mora. Sólo un ADMIN puede instanciar un tipo obligatorio.
  obligatorio BOOLEAN NOT NULL DEFAULT false,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_by INTEGER REFERENCES cartera.platform_users(id),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- Un mismo nombre de rubro no puede repetirse activo (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS rubros_tipos_uq_nombre_activo
  ON cartera.rubros_tipos (lower(nombre))
  WHERE activo = true;

CREATE TABLE IF NOT EXISTS cartera.rubros (
  rubro_id SERIAL PRIMARY KEY,
  credito_id INTEGER NOT NULL REFERENCES cartera.creditos(credito_id) ON DELETE CASCADE,
  -- SIN cascada, a propósito (el default NO ACTION alcanza): `rubros_historial`
  -- cuelga de `rubros`, así que un CASCADE acá haría que borrar una entrada del
  -- catálogo se llevara en silencio el historial de cobros de clientes reales.
  -- Con RESTRICT el DELETE del tipo falla y el endpoint responde 409 diciendo
  -- que la salida es desactivar el tipo (`activo = false`).
  tipo_id INTEGER NOT NULL REFERENCES cartera.rubros_tipos(tipo_id),
  -- NOT NULL: el tipo dice QUÉ se cobra, la descripción dice POR QUÉ en este
  -- crédito en particular. Sin ella el historial no explica el cobro.
  descripcion TEXT NOT NULL,
  monto_original NUMERIC(18, 2) NOT NULL,
  saldo_pendiente NUMERIC(18, 2) NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT true,
  completado BOOLEAN NOT NULL DEFAULT false,
  -- Anulado NO se deduce del saldo: un rubro anulado y uno pagado quedan los dos
  -- en cero, y son hechos distintos. Sin esta columna la ficha mostraba
  -- "Completado" sobre un cargo que se canceló, o sea "ya se cobró" cuando no se
  -- cobró nada. Es el único flag de la tabla que no es derivable.
  anulado BOOLEAN NOT NULL DEFAULT false,
  created_by INTEGER REFERENCES cartera.platform_users(id),
  -- created_at define el orden de consumo.
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rubros_credito_activo_idx
  ON cartera.rubros (credito_id, activo);

-- Un solo rubro VIVO por crédito y tipo: dos "tarjeta de circulación"
-- pendientes a la vez son un cobro duplicado. El filtro por `completado` es lo
-- que permite volver a cobrar el mismo concepto más adelante: el rubro saldado
-- sale del índice y deja lugar al siguiente.
CREATE UNIQUE INDEX IF NOT EXISTS rubros_uq_credito_tipo_vivo
  ON cartera.rubros (credito_id, tipo_id)
  WHERE completado = false;

CREATE TABLE IF NOT EXISTS cartera.rubros_historial (
  historial_id SERIAL PRIMARY KEY,
  rubro_id INTEGER NOT NULL REFERENCES cartera.rubros(rubro_id) ON DELETE CASCADE,
  tipo_evento cartera.rubro_evento NOT NULL,
  monto_anterior NUMERIC(18, 2),
  monto_nuevo NUMERIC(18, 2),
  saldo_anterior NUMERIC(18, 2),
  saldo_nuevo NUMERIC(18, 2),
  pago_id INTEGER REFERENCES cartera.pagos_credito(pago_id) ON DELETE SET NULL,
  usuario_id INTEGER REFERENCES cartera.platform_users(id),
  origen cartera.rubro_origen NOT NULL,
  motivo TEXT,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rubros_historial_rubro_idx
  ON cartera.rubros_historial (rubro_id, created_at);

CREATE INDEX IF NOT EXISTS rubros_historial_pago_idx
  ON cartera.rubros_historial (pago_id);
