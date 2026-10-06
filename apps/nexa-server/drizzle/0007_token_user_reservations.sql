-- Reserva durable del identificador de cada crédito ANTES de pedirle a Nexa el
-- token user. Si Nexa crea el usuario y nexa-server no alcanza a guardarlo,
-- el reintento reusa ESTE identificador: Nexa lo rechaza como repetido en vez
-- de crear un segundo usuario huérfano. Una fila por crédito.
--
-- `nexa_user_id` y `token` guardan la respuesta de Nexa apenas llega, antes de
-- escribir nexa_token_users: si esa segunda escritura falla, el reintento
-- termina de guardar desde acá sin volver a llamar a Nexa.
CREATE TABLE IF NOT EXISTS "nexa_token_user_reservations" (
	"credito_id" integer PRIMARY KEY NOT NULL,
	"identifier" varchar(9) NOT NULL,
	"nexa_user_id" integer,
	"token" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nexa_token_user_reservations_identifier_unique" UNIQUE("identifier")
);
