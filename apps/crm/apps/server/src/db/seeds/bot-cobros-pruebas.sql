-- ═══════════════════════════════════════════════════════════════════════════
-- Datos ficticios para que el equipo de IT pruebe el bot de cobros.
--
-- Base: green-tree (dev). NO correr en producción.
-- Cada cliente ficticio está amarrado al celular de una persona del equipo,
-- así cada quien recibe SU propio código por SMS.
--
-- Idempotente: se puede re-correr sin duplicar (ON CONFLICT DO NOTHING).
-- Al final está el bloque para borrar todo.
--
-- Se crean 9 leads + 10 vehículos + 10 oportunidades ganadas + 1 codeudor.
-- Los ids empiezan con `b07…` para poder encontrarlos y borrarlos después.
--
-- Ver docs/features/bot-whatsapp-cobros/pruebas-equipo-it.md
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Leads (clientes ficticios) ─────────────────────────────────────────
INSERT INTO public.leads (id, first_name, middle_name, last_name, second_last_name, email, phone, dpi, nit, client_type, source, status, assigned_to, created_by, assignment_type, updated_at) VALUES
  ('b0710000-0000-4000-8000-000000000001', 'Mario', 'Andrés', 'Pérez', 'Prueba', 'bot.prueba1@clubcashin.com', '58446376', '9900000280101', '90000011', 'individual', 'other', 'converted', '17c5e9f9-6cad-464a-8d00-902e0e335c1a', '17c5e9f9-6cad-464a-8d00-902e0e335c1a', 'manual', now()),  -- titular; Andrea es su codeudora
  ('b0710000-0000-4000-8000-000000000002', 'Lucía', NULL, 'Gómez', 'Prueba', 'bot.prueba2@clubcashin.com', '57099747', '9900000360101', NULL, 'individual', 'other', 'converted', '17c5e9f9-6cad-464a-8d00-902e0e335c1a', '17c5e9f9-6cad-464a-8d00-902e0e335c1a', 'manual', now()),  -- NIT solo en la oportunidad
  ('b0710000-0000-4000-8000-000000000003', 'Carlos', 'José', 'Ramírez', 'Prueba', 'bot.prueba3@clubcashin.com', '22215273, 35219722', '9900000440101', '90000033', 'individual', 'other', 'converted', '17c5e9f9-6cad-464a-8d00-902e0e335c1a', '17c5e9f9-6cad-464a-8d00-902e0e335c1a', 'manual', now()),  -- fijo primero + placa guardada con espacio
  ('b0710000-0000-4000-8000-000000000004', 'Ana', NULL, 'Morales', 'Prueba', 'bot.prueba4@clubcashin.com', '50230047424', '9900000520101', '90000044', 'individual', 'other', 'converted', '17c5e9f9-6cad-464a-8d00-902e0e335c1a', '17c5e9f9-6cad-464a-8d00-902e0e335c1a', 'manual', now()),  -- telefono con 502 + placa en minusculas
  ('b0710000-0000-4000-8000-000000000005', 'Jorge', 'Luis', 'Castillo', 'Prueba', 'bot.prueba5@clubcashin.com', '30440828 / 22334455', '9900000600101', '90000055', 'individual', 'other', 'converted', '17c5e9f9-6cad-464a-8d00-902e0e335c1a', '17c5e9f9-6cad-464a-8d00-902e0e335c1a', 'manual', now()),  -- separador / + placa guardada sin letra
  ('b0710000-0000-4000-8000-000000000006', 'Sofía', NULL, 'Herrera', 'Prueba', 'bot.prueba6@clubcashin.com', '47705027', NULL, '90000066', 'individual', 'other', 'converted', '17c5e9f9-6cad-464a-8d00-902e0e335c1a', '17c5e9f9-6cad-464a-8d00-902e0e335c1a', 'manual', now()),  -- SIN DPI: se identifica por NIT o placa
  ('b0710000-0000-4000-8000-000000000007', 'Diego', 'Alberto', 'Vásquez', 'Prueba', 'bot.prueba7@clubcashin.com', '54673367', '9900000790101', '90000077', 'individual', 'other', 'converted', '17c5e9f9-6cad-464a-8d00-902e0e335c1a', '17c5e9f9-6cad-464a-8d00-902e0e335c1a', 'manual', now()),  -- tiene DOS creditos
  ('b0710000-0000-4000-8000-000000000008', 'Andrea', NULL, 'Solórzano', 'Prueba', 'bot.prueba8@clubcashin.com', '59226561', '9900000870101', '90000088', 'individual', 'other', 'converted', '17c5e9f9-6cad-464a-8d00-902e0e335c1a', '17c5e9f9-6cad-464a-8d00-902e0e335c1a', 'manual', now()),  -- titular + codeudora del credito de Mario
  ('b0710000-0000-4000-8000-000000000009', 'Pedro', NULL, 'Menéndez', 'Prueba', 'bot.prueba9@clubcashin.com', NULL, '9900000950101', '90000099', 'individual', 'other', 'converted', '17c5e9f9-6cad-464a-8d00-902e0e335c1a', '17c5e9f9-6cad-464a-8d00-902e0e335c1a', 'manual', now())  -- SIN telefono: prueba el error de soporte
ON CONFLICT (id) DO NOTHING;

-- ─── 2. Vehículos ──────────────────────────────────────────────────────────
INSERT INTO public.vehicles (id, make, model, year, color, vehicle_type, license_plate, status, updated_at) VALUES
  ('b0720000-0000-4000-8000-000000000001', 'Toyota', 'Yaris', 2019, 'Blanco', 'sedan', 'P-901BOT', 'sold', now()),
  ('b0720000-0000-4000-8000-000000000002', 'Mazda', 'CX-5', 2020, 'Gris', 'sedan', 'P-902BOT', 'sold', now()),
  ('b0720000-0000-4000-8000-000000000003', 'Kia', 'Rio', 2018, 'Rojo', 'sedan', 'P 903BOT', 'sold', now()),
  ('b0720000-0000-4000-8000-000000000004', 'Hyundai', 'Tucson', 2021, 'Negro', 'sedan', 'p-904bot', 'sold', now()),
  ('b0720000-0000-4000-8000-000000000005', 'Nissan', 'Frontier', 2017, 'Azul', 'sedan', '905BOT', 'sold', now()),
  ('b0720000-0000-4000-8000-000000000006', 'Suzuki', 'Swift', 2022, 'Plata', 'sedan', 'P-906BOT', 'sold', now()),
  ('b0720000-0000-4000-8000-000000000007', 'Toyota', 'Hilux', 2020, 'Blanco', 'sedan', 'P-907BOT', 'sold', now()),
  ('b0720000-0000-4000-8000-000000000008', 'Honda', 'CR-V', 2019, 'Verde', 'sedan', 'P-908BOT', 'sold', now()),
  ('b0720000-0000-4000-8000-000000000009', 'Chevrolet', 'Spark', 2016, 'Amarillo', 'sedan', 'P-909BOT', 'sold', now()),
  ('b0720000-0000-4000-8000-000000000010', 'Mitsubishi', 'L200', 2023, 'Gris', 'pickup', 'P-910BOT', 'sold', now())  -- 2do credito de Diego
ON CONFLICT (id) DO NOTHING;

-- ─── 3. Oportunidades ganadas (los créditos) ───────────────────────────────
INSERT INTO public.opportunities (id, title, lead_id, vehicle_id, nit, numero_sifco, credit_type, stage_id, status, probability, assigned_to, created_by, updated_at) VALUES
  ('b0730000-0000-4000-8000-000000000001', 'Crédito de prueba 1 - Mario Pérez', 'b0710000-0000-4000-8000-000000000001', 'b0720000-0000-4000-8000-000000000001', '90000011', 'BOT-TEST-001', 'autocompra', '06f88099-87ba-4e3c-b46c-3eb1b0997b85', 'won', 100, '17c5e9f9-6cad-464a-8d00-902e0e335c1a', '17c5e9f9-6cad-464a-8d00-902e0e335c1a', now()),
  ('b0730000-0000-4000-8000-000000000002', 'Crédito de prueba 2 - Lucía Gómez', 'b0710000-0000-4000-8000-000000000002', 'b0720000-0000-4000-8000-000000000002', '90000022', 'BOT-TEST-002', 'autocompra', '06f88099-87ba-4e3c-b46c-3eb1b0997b85', 'won', 100, '17c5e9f9-6cad-464a-8d00-902e0e335c1a', '17c5e9f9-6cad-464a-8d00-902e0e335c1a', now()),
  ('b0730000-0000-4000-8000-000000000003', 'Crédito de prueba 3 - Carlos Ramírez', 'b0710000-0000-4000-8000-000000000003', 'b0720000-0000-4000-8000-000000000003', '90000033', 'BOT-TEST-003', 'autocompra', '06f88099-87ba-4e3c-b46c-3eb1b0997b85', 'won', 100, '17c5e9f9-6cad-464a-8d00-902e0e335c1a', '17c5e9f9-6cad-464a-8d00-902e0e335c1a', now()),
  ('b0730000-0000-4000-8000-000000000004', 'Crédito de prueba 4 - Ana Morales', 'b0710000-0000-4000-8000-000000000004', 'b0720000-0000-4000-8000-000000000004', '90000044', 'BOT-TEST-004', 'autocompra', '06f88099-87ba-4e3c-b46c-3eb1b0997b85', 'won', 100, '17c5e9f9-6cad-464a-8d00-902e0e335c1a', '17c5e9f9-6cad-464a-8d00-902e0e335c1a', now()),
  ('b0730000-0000-4000-8000-000000000005', 'Crédito de prueba 5 - Jorge Castillo', 'b0710000-0000-4000-8000-000000000005', 'b0720000-0000-4000-8000-000000000005', '90000055', 'BOT-TEST-005', 'autocompra', '06f88099-87ba-4e3c-b46c-3eb1b0997b85', 'won', 100, '17c5e9f9-6cad-464a-8d00-902e0e335c1a', '17c5e9f9-6cad-464a-8d00-902e0e335c1a', now()),
  ('b0730000-0000-4000-8000-000000000006', 'Crédito de prueba 6 - Sofía Herrera', 'b0710000-0000-4000-8000-000000000006', 'b0720000-0000-4000-8000-000000000006', '90000066', 'BOT-TEST-006', 'autocompra', '06f88099-87ba-4e3c-b46c-3eb1b0997b85', 'won', 100, '17c5e9f9-6cad-464a-8d00-902e0e335c1a', '17c5e9f9-6cad-464a-8d00-902e0e335c1a', now()),
  ('b0730000-0000-4000-8000-000000000007', 'Crédito de prueba 7 - Diego Vásquez', 'b0710000-0000-4000-8000-000000000007', 'b0720000-0000-4000-8000-000000000007', '90000077', 'BOT-TEST-007', 'autocompra', '06f88099-87ba-4e3c-b46c-3eb1b0997b85', 'won', 100, '17c5e9f9-6cad-464a-8d00-902e0e335c1a', '17c5e9f9-6cad-464a-8d00-902e0e335c1a', now()),
  ('b0730000-0000-4000-8000-000000000008', 'Crédito de prueba 8 - Andrea Solórzano', 'b0710000-0000-4000-8000-000000000008', 'b0720000-0000-4000-8000-000000000008', '90000088', 'BOT-TEST-008', 'autocompra', '06f88099-87ba-4e3c-b46c-3eb1b0997b85', 'won', 100, '17c5e9f9-6cad-464a-8d00-902e0e335c1a', '17c5e9f9-6cad-464a-8d00-902e0e335c1a', now()),
  ('b0730000-0000-4000-8000-000000000009', 'Crédito de prueba 9 - Pedro Menéndez', 'b0710000-0000-4000-8000-000000000009', 'b0720000-0000-4000-8000-000000000009', '90000099', 'BOT-TEST-009', 'autocompra', '06f88099-87ba-4e3c-b46c-3eb1b0997b85', 'won', 100, '17c5e9f9-6cad-464a-8d00-902e0e335c1a', '17c5e9f9-6cad-464a-8d00-902e0e335c1a', now()),
  ('b0730000-0000-4000-8000-000000000010', 'Crédito de prueba 10 - Diego Vásquez (segundo)', 'b0710000-0000-4000-8000-000000000007', 'b0720000-0000-4000-8000-000000000010', '90000077', 'BOT-TEST-010', 'autocompra', '06f88099-87ba-4e3c-b46c-3eb1b0997b85', 'won', 100, '17c5e9f9-6cad-464a-8d00-902e0e335c1a', '17c5e9f9-6cad-464a-8d00-902e0e335c1a', now())  -- segundo credito de Diego
ON CONFLICT (id) DO NOTHING;

-- ─── 4. Codeudor ───────────────────────────────────────────────────────────
-- Andrea (persona 8) es codeudora del crédito de Mario (persona 1). Con su
-- propio DPI debe ver DOS créditos: el suyo y el de Mario.
INSERT INTO public.co_debtors (id, opportunity_id, full_name, dpi, phone, email, updated_at) VALUES
  ('b0740000-0000-4000-8000-000000000008', 'b0730000-0000-4000-8000-000000000001', 'Andrea Solórzano Prueba', '9900000870101', '59226561', 'bot.prueba8@clubcashin.com', now())
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- ─── Verificación: esto es lo que debería quedar ───────────────────────────
SELECT l.first_name || ' ' || l.last_name AS cliente,
       coalesce(l.phone, '(sin telefono)') AS telefono_en_crm,
       coalesce(l.dpi, '(sin DPI)') AS dpi,
       coalesce(l.nit, o.nit) AS nit,
       v.license_plate AS placa,
       o.numero_sifco
FROM public.leads l
JOIN public.opportunities o ON o.lead_id = l.id
LEFT JOIN public.vehicles v ON v.id = o.vehicle_id
WHERE l.id::text LIKE 'b071%'
ORDER BY o.numero_sifco;

-- ═══════════════════════════════════════════════════════════════════════════
-- BORRAR TODO (descomentar y correr cuando ya no se necesite)
-- ═══════════════════════════════════════════════════════════════════════════
-- BEGIN;
-- DELETE FROM public.otps          WHERE lead_id::text LIKE 'b071%' OR co_debtor_id::text LIKE 'b074%';
-- DELETE FROM public.co_debtors    WHERE id::text LIKE 'b074%';
-- DELETE FROM public.opportunities WHERE id::text LIKE 'b073%';
-- DELETE FROM public.vehicles      WHERE id::text LIKE 'b072%';
-- DELETE FROM public.leads         WHERE id::text LIKE 'b071%';
-- COMMIT;
