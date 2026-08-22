-- ═══════════════════════════════════════════════════════════
--  SCHÉMA SUPABASE v2 — VOITURIER ORLY
--  À copier-coller dans : Supabase Dashboard → SQL Editor → Run
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS clients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text UNIQUE NOT NULL,
  firstname       text NOT NULL,
  lastname        text NOT NULL,
  phone           text NOT NULL,
  notes           text DEFAULT '',
  total_bookings  int  DEFAULT 0,
  total_spent     numeric(10,2) DEFAULT 0,
  is_vip          boolean DEFAULT false,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);

CREATE TABLE IF NOT EXISTS pricing_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  days_min      int NOT NULL,
  days_max      int NOT NULL,
  price_eur     numeric(10,2) NOT NULL,
  label         text DEFAULT '',
  created_at    timestamptz DEFAULT now()
);

INSERT INTO pricing_rules (days_min, days_max, price_eur, label) VALUES
  (1,1,29,'24h'),(2,2,49,'2 jours'),(3,3,65,'3 jours'),(4,5,79,'4-5 jours'),
  (6,7,89,'Une semaine'),(8,10,119,'8-10 jours'),(11,14,149,'2 semaines'),
  (15,21,199,'3 semaines'),(22,30,249,'1 mois'),(31,365,299,'Plus d''un mois')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS vehicle_categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text UNIQUE NOT NULL,
  name          text NOT NULL,
  description   text DEFAULT '',
  surcharge_eur numeric(10,2) DEFAULT 0,
  wash_surcharge_eur numeric(10,2) DEFAULT 0,
  display_order int DEFAULT 0,
  active        boolean DEFAULT true,
  created_at    timestamptz DEFAULT now()
);

INSERT INTO vehicle_categories (code, name, description, surcharge_eur, wash_surcharge_eur, display_order) VALUES
  ('citadine','Citadine','Petite voiture urbaine',0,0,1),
  ('berline','Berline / Break','Voiture standard, familiale',0,0,2),
  ('suv','SUV / 4×4 / Monospace','Grand véhicule familial',10,10,3),
  ('utilitaire','Van / Utilitaire','Van, fourgon, pickup',25,20,4)
ON CONFLICT DO NOTHING;

DO $$ BEGIN
  CREATE TYPE surcharge_kind AS ENUM ('time_window', 'holiday', 'option');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS surcharges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          surcharge_kind NOT NULL,
  name          text NOT NULL,
  description   text DEFAULT '',
  amount_eur    numeric(10,2) NOT NULL,
  time_start    time DEFAULT NULL,
  time_end      time DEFAULT NULL,
  applies_to    text DEFAULT 'both',
  option_code   text DEFAULT NULL,
  active        boolean DEFAULT true,
  display_order int DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);

INSERT INTO surcharges (kind, name, description, amount_eur, time_start, time_end, applies_to, display_order) VALUES
  ('time_window','Horaire matinal','03h30 - 05h00',15,'03:30:00','05:00:00','both',1),
  ('time_window','Horaire matinal','05h00 - 07h00',10,'05:00:00','07:00:00','both',2),
  ('time_window','Horaire de soirée','21h00 - 22h00',10,'21:00:00','22:00:00','both',3),
  ('time_window','Horaire de nuit','22h00 - 03h30',15,'22:00:00','03:30:00','both',4)
ON CONFLICT DO NOTHING;

INSERT INTO surcharges (kind, name, description, amount_eur, option_code, display_order) VALUES
  ('option','Parking couvert','Garage couvert',20,'covered_parking',10),
  ('option','Accès prioritaire','Prise en charge express, voiturier dédié',20,'priority_access',11)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS pricing_special (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, date_start date NOT NULL, date_end date NOT NULL,
  multiplier numeric(4,2) DEFAULT 1.0, flat_extra numeric(10,2) DEFAULT 0,
  active boolean DEFAULT true, created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL UNIQUE, name text NOT NULL,
  surcharge_eur numeric(10,2) DEFAULT 10, active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

INSERT INTO holidays (date, name) VALUES
  ('2026-01-01','Jour de l''An'),('2026-04-06','Lundi de Pâques'),
  ('2026-05-01','Fête du Travail'),('2026-05-08','Victoire 1945'),
  ('2026-05-14','Ascension'),('2026-05-25','Lundi de Pentecôte'),
  ('2026-07-14','Fête nationale'),('2026-08-15','Assomption'),
  ('2026-11-01','Toussaint'),('2026-11-11','Armistice'),('2026-12-25','Noël')
ON CONFLICT (date) DO NOTHING;

CREATE TABLE IF NOT EXISTS blocked_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date_start date NOT NULL, date_end date NOT NULL,
  reason text DEFAULT '', created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  discount_type text NOT NULL CHECK (discount_type IN ('percent','fixed')),
  discount_val numeric(10,2) NOT NULL,
  max_uses int DEFAULT NULL, uses_count int DEFAULT 0,
  valid_from date DEFAULT NULL, valid_until date DEFAULT NULL,
  active boolean DEFAULT true, created_at timestamptz DEFAULT now()
);

DO $$ BEGIN
  CREATE TYPE booking_status AS ENUM ('pending','confirmed','taken','in_storage','returned','cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('stripe','onsite','cash','card_onsite');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('pending','paid','refunded','failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text UNIQUE NOT NULL,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  customer_firstname text NOT NULL, customer_lastname text NOT NULL,
  customer_email text NOT NULL, customer_phone text NOT NULL,
  customer_flight text DEFAULT '',
  departure_date date NOT NULL, departure_time time NOT NULL, departure_terminal text DEFAULT '',
  return_date date NOT NULL, return_time time NOT NULL, return_terminal text DEFAULT '',
  car_brand text NOT NULL, car_model text NOT NULL,
  car_color text DEFAULT '', car_plate text NOT NULL,
  car_category_code text DEFAULT 'citadine',
  wash_type text DEFAULT 'none', wash_price numeric(10,2) DEFAULT 0,
  has_covered_parking boolean DEFAULT false,
  has_priority_access boolean DEFAULT false,
  promo_code text DEFAULT NULL, promo_discount numeric(10,2) DEFAULT 0,
  base_price numeric(10,2) NOT NULL,
  vehicle_surcharge numeric(10,2) DEFAULT 0,
  wash_surcharge numeric(10,2) DEFAULT 0,
  time_surcharges numeric(10,2) DEFAULT 0,
  options_total numeric(10,2) DEFAULT 0,
  total_price numeric(10,2) NOT NULL,
  surcharges_detail jsonb DEFAULT '[]'::jsonb,
  status booking_status DEFAULT 'pending',
  payment_method payment_method DEFAULT 'stripe',
  payment_status payment_status DEFAULT 'pending',
  stripe_session_id text DEFAULT NULL,
  parking_spot text DEFAULT '', internal_notes text DEFAULT '',
  late_dep_active boolean DEFAULT false,
  late_dep_actual_time time DEFAULT NULL,
  late_dep_fee numeric(10,2) DEFAULT 0,
  late_ret_active boolean DEFAULT false,
  late_ret_actual_time time DEFAULT NULL,
  late_ret_fee numeric(10,2) DEFAULT 0,
  late_fees_locked boolean DEFAULT false,
  taken_at timestamptz DEFAULT NULL, stored_at timestamptz DEFAULT NULL,
  returned_at timestamptz DEFAULT NULL, cancelled_at timestamptz DEFAULT NULL,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bookings_reference ON bookings(reference);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_dep_date ON bookings(departure_date);
CREATE INDEX IF NOT EXISTS idx_bookings_ret_date ON bookings(return_date);
CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings(customer_email);

CREATE TABLE IF NOT EXISTS quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text UNIQUE NOT NULL,
  customer_firstname text DEFAULT '', customer_lastname text DEFAULT '',
  customer_email text DEFAULT '', customer_phone text DEFAULT '',
  departure_date date NOT NULL, departure_time time NOT NULL,
  return_date date NOT NULL, return_time time NOT NULL,
  car_category_code text DEFAULT 'citadine',
  wash_type text DEFAULT 'none',
  has_covered_parking boolean DEFAULT false,
  has_priority_access boolean DEFAULT false,
  promo_code text DEFAULT NULL,
  base_price numeric(10,2) NOT NULL, total_price numeric(10,2) NOT NULL,
  surcharges_detail jsonb DEFAULT '[]'::jsonb,
  status text DEFAULT 'draft', valid_until date DEFAULT NULL,
  notes text DEFAULT '', sent_at timestamptz DEFAULT NULL,
  converted_to_booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL, name text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('sms','email')),
  subject text DEFAULT '', body text NOT NULL,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

INSERT INTO message_templates (code, name, channel, subject, body) VALUES
  ('reminder_d1_email','Rappel J-1 (email)','email',
   'Rappel : votre prise en charge demain — {{reference}}',
   E'Bonjour {{firstname}},\n\nDemain, vous nous confiez votre véhicule.\n\nProcédure :\n• Présentez-vous au moins 2h à 3h avant votre embarquement\n• Appelez-nous au {{phone_business}} 40 minutes avant votre arrivée à Orly\n• Direction : dépose-minute du Terminal {{terminal}}\n\nVotre rendez-vous : {{dep_date}} à {{dep_time}}\nVéhicule : {{car_brand}} {{car_model}} ({{car_plate}})\n\nBon voyage,\nVoiturier Orly'),
  ('reminder_d1_sms','Rappel J-1 (SMS)','sms','',
   'Bonjour {{firstname}}, rappel : demain prise en charge à {{dep_time}} au Terminal {{terminal}}. Appelez le {{phone_business}} 40min avant arrivée Orly. Voiturier Orly'),
  ('confirm_taken_sms','Prise en charge OK','sms','',
   '{{firstname}}, votre véhicule est en sécurité. Bon voyage ! Voiturier Orly'),
  ('return_request_sms','Demande infos retour','sms','',
   'Bonjour {{firstname}}, bon retour ! Avez-vous des bagages en soute ? Combien de temps avant le RDV ? Voiturier Orly'),
  ('delivery_sms','Livraison','sms','',
   '{{firstname}}, on arrive Terminal {{ret_terminal}} dans {{eta_minutes}} min. Sortie {{exit_number}}. Voiturier Orly'),
  ('post_review_email','Demande d''avis','email',
   'Merci pour ce voyage — {{firstname}}',
   E'Bonjour {{firstname}},\n\nMerci d''avoir choisi Voiturier Orly. Votre avis compte :\n👉 {{google_review_link}}\n\nÀ très bientôt,\nVoiturier Orly')
ON CONFLICT (code) DO NOTHING;

CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bookings_updated ON bookings;
CREATE TRIGGER bookings_updated BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
DROP TRIGGER IF EXISTS clients_updated ON clients;
CREATE TRIGGER clients_updated BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
DROP TRIGGER IF EXISTS quotes_updated ON quotes;
CREATE TRIGGER quotes_updated BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
DROP TRIGGER IF EXISTS templates_updated ON message_templates;
CREATE TRIGGER templates_updated BEFORE UPDATE ON message_templates
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE OR REPLACE FUNCTION trg_update_client_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.client_id IS NOT NULL THEN
    UPDATE clients SET
      total_bookings = (SELECT COUNT(*) FROM bookings WHERE client_id = NEW.client_id AND status != 'cancelled'),
      total_spent = (SELECT COALESCE(SUM(total_price),0) FROM bookings WHERE client_id = NEW.client_id AND payment_status = 'paid')
    WHERE id = NEW.client_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bookings_stats ON bookings;
CREATE TRIGGER bookings_stats AFTER INSERT OR UPDATE OF status, payment_status ON bookings
  FOR EACH ROW EXECUTE FUNCTION trg_update_client_stats();

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_special ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocked_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE surcharges ENABLE ROW LEVEL SECURITY;
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
