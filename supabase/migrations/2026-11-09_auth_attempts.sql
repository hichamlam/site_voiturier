-- Compteur anti-force-brute du code de connexion de l'app (partagé entre instances Vercel).
CREATE TABLE IF NOT EXISTS auth_attempts (
  key text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE auth_attempts ENABLE ROW LEVEL SECURITY; -- aucune règle : accès uniquement via l'API (clé service)
