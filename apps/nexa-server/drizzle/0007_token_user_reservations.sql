-- Reserva durable del identificador de cada crédito ANTES de pedirle a Nexa el
-- token user. Si Nexa crea el usuario y nexa-server no alcanza a guardarlo
-- (caída de la base), el reintento reusa ESTE identificador: Nexa lo rechaza
-- como repetido en vez de crear un segundo usuario huérfano. Una fila por
-- crédito y un identificador por fila.
CREATE TABLE IF NOT EXISTS "nexa_token_user_reservations" (
	"credito_id" integer PRIMARY KEY NOT NULL,
	"identifier" varchar(9) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nexa_token_user_reservations_identifier_unique" UNIQUE("identifier")
);
