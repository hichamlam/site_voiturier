-- Voituriers : l'admin les ajoute (nom + téléphone) et en attribue un à chaque réservation.
CREATE TABLE IF NOT EXISTS valets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  phone       text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE valets ENABLE ROW LEVEL SECURITY; -- accès uniquement via l'API (clé service)

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS valet_id uuid REFERENCES valets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_valet ON bookings(valet_id);
