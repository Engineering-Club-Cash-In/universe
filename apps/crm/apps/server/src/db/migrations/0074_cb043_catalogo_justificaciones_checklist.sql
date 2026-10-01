-- CB-043 — Catálogo de justificaciones del checklist de recuperación.
--
-- Cuando un paso del checklist no se hizo, quien solicita la recuperación
-- elige POR QUÉ. Antes había un solo catálogo genérico en TypeScript
-- (con "No aplica"); desde el 2026-10-01 (pedido del PM) cada paso tiene sus
-- propias razones ("¿Por qué no hay llamadas al cliente?", "¿Por qué no hay
-- convenios?", …) y viven acá, en la base: se agregan o se retiran con un
-- INSERT/UPDATE, sin deploy.
--
-- Los PASOS siguen en TypeScript (lib/recuperacion-solicitud.ts): cada uno
-- está atado al código que detecta su evidencia. `paso` es una de esas claves.
--
-- Una razón no se borra: se desactiva (`activo = false`). La solicitud guarda
-- la clave Y la etiqueta que se eligió, así que las viejas se siguen leyendo
-- aunque el catálogo cambie. La nota del asesor es siempre opcional.
--
-- Idempotente: se puede correr más de una vez.

CREATE TABLE IF NOT EXISTS "cobros_checklist_justificaciones" (
	"id" serial PRIMARY KEY NOT NULL,
	"paso" text NOT NULL,
	"clave" text NOT NULL,
	"etiqueta" text NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cobros_checklist_justificaciones_paso_clave_unique" UNIQUE ("paso", "clave")
);
--> statement-breakpoint
INSERT INTO "cobros_checklist_justificaciones" ("paso", "clave", "etiqueta", "orden") VALUES
	-- ¿Por qué no hay llamadas al cliente?
	('llamadas_cliente', 'sin_telefono', 'El cliente no tiene teléfono registrado', 10),
	('llamadas_cliente', 'numeros_invalidos', 'Los números registrados no existen o están fuera de servicio', 20),
	('llamadas_cliente', 'numeros_de_terceros', 'Los números registrados pertenecen a otra persona', 30),
	('llamadas_cliente', 'riesgo_ocultamiento', 'Contactar al cliente podría alertarlo y provocar que oculte el vehículo', 40),
	('llamadas_cliente', 'urgencia', 'Urgencia: riesgo de venta, traslado o salida del país', 50),
	('llamadas_cliente', 'fuera_del_crm', 'Se realizaron, pero no quedaron registradas en el CRM', 60),
	('llamadas_cliente', 'otro', 'Otro motivo', 90),
	-- ¿Por qué no hay mensajes al cliente?
	('mensajes', 'sin_medio', 'El cliente no tiene WhatsApp, celular ni correo registrado', 10),
	('mensajes', 'numeros_invalidos', 'Los números registrados no existen o están fuera de servicio', 20),
	('mensajes', 'cliente_bloqueo', 'El cliente bloqueó los números de la empresa', 30),
	('mensajes', 'riesgo_ocultamiento', 'Contactar al cliente podría alertarlo y provocar que oculte el vehículo', 40),
	('mensajes', 'urgencia', 'Urgencia: riesgo de venta, traslado o salida del país', 50),
	('mensajes', 'fuera_del_crm', 'Se enviaron, pero no quedaron registrados en el CRM', 60),
	('mensajes', 'otro', 'Otro motivo', 90),
	-- ¿Por qué no hay promesas de pago?
	('promesa_pago', 'sin_contacto', 'No se ha logrado contactar al cliente', 10),
	('promesa_pago', 'cliente_se_niega', 'El cliente manifestó que no pagará', 20),
	('promesa_pago', 'sin_capacidad_pago', 'El cliente no tiene capacidad de pago', 30),
	('promesa_pago', 'incumplimientos_previos', 'El cliente ha incumplido acuerdos anteriores', 40),
	('promesa_pago', 'urgencia', 'Urgencia: riesgo de venta, traslado o salida del país', 50),
	('promesa_pago', 'fuera_del_crm', 'Se acordó, pero no quedó registrada en el CRM', 60),
	('promesa_pago', 'otro', 'Otro motivo', 90),
	-- ¿Por qué no hay convenios de pago?
	('convenio_pago', 'sin_contacto', 'No se ha logrado contactar al cliente', 10),
	('convenio_pago', 'cliente_rechaza', 'El cliente rechazó la propuesta de convenio', 20),
	('convenio_pago', 'sin_capacidad_pago', 'El cliente no tiene capacidad para cumplir un convenio', 30),
	('convenio_pago', 'incumplimientos_previos', 'El cliente incumplió convenios o promesas anteriores', 40),
	('convenio_pago', 'no_cumple_requisitos', 'El crédito no cumple los requisitos para un convenio', 50),
	('convenio_pago', 'urgencia', 'Urgencia: riesgo de venta, traslado o salida del país', 60),
	('convenio_pago', 'otro', 'Otro motivo', 90),
	-- ¿Por qué no se gestionaron las referencias?
	('referencias', 'sin_referencias', 'El crédito no tiene referencias registradas', 10),
	('referencias', 'no_contestan', 'Las referencias no contestan', 20),
	('referencias', 'numeros_invalidos', 'Los números de las referencias no existen o están fuera de servicio', 30),
	('referencias', 'no_conocen_al_cliente', 'Las referencias indican no conocer al cliente', 40),
	('referencias', 'riesgo_ocultamiento', 'Contactarlas podría alertar al cliente y provocar que oculte el vehículo', 50),
	('referencias', 'fuera_del_crm', 'Se contactaron, pero no quedó registrado en el CRM', 60),
	('referencias', 'otro', 'Otro motivo', 90),
	-- ¿Por qué no hay visita a la residencia?
	('visita_residencia', 'sin_direccion', 'No hay dirección de residencia registrada', 10),
	('visita_residencia', 'direccion_incorrecta', 'La dirección registrada no existe o está incompleta', 20),
	('visita_residencia', 'zona_riesgo', 'La zona representa un riesgo para el equipo', 30),
	('visita_residencia', 'fuera_de_cobertura', 'La dirección está fuera del área de cobertura', 40),
	('visita_residencia', 'riesgo_ocultamiento', 'Visitarlo podría alertar al cliente y provocar que oculte el vehículo', 50),
	('visita_residencia', 'urgencia', 'Urgencia: riesgo de venta, traslado o salida del país', 60),
	('visita_residencia', 'fuera_del_crm', 'Se realizó, pero no quedó registrada en el CRM', 70),
	('visita_residencia', 'otro', 'Otro motivo', 90),
	-- ¿Por qué no hay visita al lugar de trabajo?
	('visita_trabajo', 'sin_datos_laborales', 'No hay lugar de trabajo registrado', 10),
	('visita_trabajo', 'ya_no_trabaja_ahi', 'El cliente ya no trabaja en ese lugar', 20),
	('visita_trabajo', 'sin_lugar_fijo', 'El cliente trabaja por cuenta propia o sin lugar fijo', 30),
	('visita_trabajo', 'zona_riesgo', 'La zona representa un riesgo para el equipo', 40),
	('visita_trabajo', 'riesgo_ocultamiento', 'Visitarlo podría alertar al cliente y provocar que oculte el vehículo', 50),
	('visita_trabajo', 'urgencia', 'Urgencia: riesgo de venta, traslado o salida del país', 60),
	('visita_trabajo', 'fuera_del_crm', 'Se realizó, pero no quedó registrada en el CRM', 70),
	('visita_trabajo', 'otro', 'Otro motivo', 90),
	-- ¿Por qué no se consultó la ubicación por GPS?
	('ubicacion_gps', 'sin_gps', 'El vehículo no tiene GPS vinculado', 10),
	('ubicacion_gps', 'gps_sin_reportar', 'El GPS no está reportando', 20),
	('ubicacion_gps', 'ubicacion_conocida', 'Ya se conoce la ubicación del vehículo', 30),
	('ubicacion_gps', 'fuera_del_crm', 'Se consultó en la plataforma del GPS, fuera del CRM', 40),
	('ubicacion_gps', 'otro', 'Otro motivo', 90),
	-- ¿Por qué no se apagó la unidad?
	('apagado_unidad', 'sin_gps', 'El vehículo no tiene GPS vinculado', 10),
	('apagado_unidad', 'gps_sin_reportar', 'El GPS no está reportando', 20),
	('apagado_unidad', 'apagado_pendiente', 'El apagado está solicitado y pendiente de ejecución', 30),
	('apagado_unidad', 'apagado_rechazado', 'La solicitud de apagado fue rechazada', 40),
	('apagado_unidad', 'riesgo_seguridad', 'Apagarla representa un riesgo (vehículo en circulación)', 50),
	('apagado_unidad', 'riesgo_ocultamiento', 'Apagarla podría alertar al cliente y provocar que oculte el vehículo', 60),
	('apagado_unidad', 'otro', 'Otro motivo', 90)
ON CONFLICT ("paso", "clave") DO NOTHING;
