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
--> statement-breakpoint

-- Y el rol del representante de RDBE entre los firmantes admitidos.
--
-- El contrato de servicios lo firman las dos sociedades, y WeeTrust junta a los
-- firmantes por correo: la segunda entidad firma con su propio rol
-- (`REP_LEGAL_RDBE`). El check de `contract_signatories` venía de antes y no lo
-- conocía, así que guardar ese contrato fallaba al insertar su firmante, se
-- deshacía la fila y se borraba el documento en WeeTrust.
--
-- Va acá y no en una migración aparte porque ésta todavía no corrió en prod.
-- Idempotente: borra el check si existe y lo vuelve a crear con los cinco roles.

ALTER TABLE "public"."contract_signatories" DROP CONSTRAINT IF EXISTS "contract_signatories_role_valid";
--> statement-breakpoint
ALTER TABLE "public"."contract_signatories" ADD CONSTRAINT "contract_signatories_role_valid" CHECK ("role" IN ('TITULAR', 'COFIRMANTE', 'REP_LEGAL', 'REP_LEGAL_RDBE', 'VENDEDOR'));
