# Guía de redacción del CRM de cobros

Todo texto que ve un asesor o un supervisor en el CRM de cobros sigue esta guía:
pantallas, modales, botones, placeholders, mensajes de error, toasts y
notificaciones. La pidió el PM (2026-10-01) después de revisar el módulo: textos
como «Ya fui», «Quién va» o «Elegí a alguien» le quitan seriedad al producto.

El objetivo no es sonar sofisticado. Es sonar **profesional, claro y directo**,
como un sistema de trabajo y no como un mensaje entre compañeros.

## Reglas

1. **Trato de usted, nunca de vos ni de tú.**
   - Imperativos en forma usted: *Seleccione*, *Ingrese*, *Revise*, *Registre*,
     *Espere*, *Verifique*.
   - Nunca voseo (*Elegí*, *Escribí*, *Registrá*, *tenés*, *podés*, *fijate*) ni
     tuteo (*elige*, *tienes*, *puedes*).
2. **Etiquetas con sustantivos, no con preguntas coloquiales.**
   «Responsable de la visita», no «Quién va». «Resultado de la visita», no «¿Qué
   pasó?».
3. **Botones con verbo en infinitivo.** *Guardar visita*, *Registrar promesa*,
   *Solicitar recuperación del vehículo*.
4. **Placeholders de selección en infinitivo**: *Seleccionar responsable*,
   *Seleccionar motivo*. Los ejemplos se escriben con «Ej.:».
5. **Mensajes de error: qué falta y cómo resolverlo.** «Seleccione el motivo por
   el que no hubo contacto.» «Falta la dirección de la visita.» Sin reproches ni
   bromas.
6. **Avisos y notificaciones en tercera persona o en forma impersonal.**
   «Se le asignó una visita», «Hoy tiene una visita a residencia», «Se notificó
   a Samuel Gamboa». No «Te programaron» ni «ya tiene el aviso».
7. **Sin coloquialismos.** *vehículo* (no *carro*), *realizar* (no *ir a hacer*),
   *a medias* → *incompleto*, *mandar* → *enviar*.
8. **Los términos del negocio son siempre los mismos:**

   | Se dice | No se dice |
   | ------- | ---------- |
   | Recuperación del vehículo | Recuperación forzosa, quitarle el carro |
   | Entrega voluntaria | Devolución |
   | Promesa de pago | Promesa (sola, en títulos) |
   | Convenio de pago | Arreglo |
   | Pago parcial | 50% (el porcentaje es variable) |
   | Apagado de la unidad | Bloqueo del carro |
   | Asesor / supervisor / cliente | El que lleva, el que pide |

## Ejemplos

| Antes | Después |
| ----- | ------- |
| Ya fui / Programarla | Visita realizada / Programar visita |
| Quién va / Quién fue | Responsable de la visita |
| Cuándo fue | Fecha y hora de la visita |
| ¿Qué pasó? | Resultado de la visita |
| Notas para quien va | Indicaciones para la visita |
| Cómo llegar | Puntos de referencia |
| Elegí a alguien | Seleccionar responsable |
| Esperá a que terminen de subir las fotos. | Espere a que terminen de subir las fotos. |
| Escribí la justificación para el supervisor. | Escriba la justificación para el supervisor. |
| Visita programada. Ese día te llega el aviso. | Visita programada. El día de la visita recibirá un aviso. |
| Hoy tenés una visita a residencia | Hoy tiene una visita a residencia |
| Solicitar recuperación forzosa | Solicitar recuperación del vehículo |

## Qué no cubre

- **Comentarios y nombres en el código**: son internos y pueden seguir en el
  español informal del equipo.
- **Los mensajes del bot de WhatsApp al cliente** (`lib/bot-cobros/`): salen por
  SimpleTech y tienen su propio contrato ([docs del bot](../bot-whatsapp-cobros/README.md)).
  Los **avisos que el bot genera para el asesor** en el CRM sí siguen esta guía.
- **Plantillas de mensajes a clientes**: las define el área de cobros.

Al agregar una pantalla o un mensaje nuevo en cobros, revisar esta guía antes
de abrir el PR.
