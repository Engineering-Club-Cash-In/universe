-- NOTA: aplicar a mano en dev y prod (Cartera aplica el SQL a mano, no drizzle-kit).
-- Marca un crédito como excluido de la asignación de capital a inversionistas:
-- getCreditCandidates lo descarta y el modo manual de addInvestorToCredit lo rechaza.
ALTER TABLE cartera.creditos
  ADD COLUMN IF NOT EXISTS excluir_compras boolean NOT NULL DEFAULT false;
