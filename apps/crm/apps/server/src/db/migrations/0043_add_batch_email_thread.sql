-- El correo de "Compra de Cartera aceptada" que abrió la batería.
--
-- Es el id que devuelve Resend al mandarlo. Con él se le pregunta a Resend el
-- Message-ID real del correo (el de Amazon SES; el nuestro no lo respeta), su
-- asunto y a quiénes fue, y así el "Listo" de jurídico contesta DENTRO de ese
-- hilo, con los contratos adjuntos y los enlaces de firma, en vez de que
-- jurídico e inversiones lo hagan a mano.
--
-- Vacío en las baterías de antes: su correo sale igual, pero fuera del hilo.
--
-- Idempotente: se puede correr más de una vez sin romper nada.

ALTER TABLE "public"."investor_contract_batches" ADD COLUMN IF NOT EXISTS "email_thread_id" text;
