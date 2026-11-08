-- refuse_if_encounter_signed() referenced OLD.encounter / NEW.encounter in expressions that PL/pgSQL
-- prepares for every table, and RabiesCertificate has no encounter column ("record old has no field
-- encounter"), so linking a rendered certificate failed. Read the encounter through to_jsonb so the one
-- function serves tables with and without the column. Behaviour is otherwise unchanged.
CREATE OR REPLACE FUNCTION refuse_if_encounter_signed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE enc_id text; old_enc text; enc_status text; enc_ref text; allowed text[];
BEGIN
  IF TG_TABLE_NAME = 'RabiesCertificate' THEN
    -- A certificate belongs to the encounter of the vaccine that issued it.
    SELECT va.encounter INTO enc_id FROM "VaccineAdministration" va
     WHERE va.certificate = (CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END) ->> 'id' LIMIT 1;
  ELSE
    IF TG_OP <> 'INSERT' THEN old_enc := to_jsonb(OLD) ->> 'encounter'; END IF;
    IF TG_OP = 'DELETE' THEN enc_id := old_enc; ELSE enc_id := COALESCE(to_jsonb(NEW) ->> 'encounter', old_enc); END IF;
  END IF;
  IF enc_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  SELECT status, ref INTO enc_status, enc_ref FROM "Encounter" WHERE id = enc_id;
  IF enc_status IS DISTINCT FROM 'signed' THEN
    -- Moving a row off a signed encounter must not escape the check either.
    IF old_enc IS NOT NULL AND old_enc IS DISTINCT FROM enc_id
       AND (SELECT status FROM "Encounter" WHERE id = old_enc) = 'signed' THEN
      RAISE EXCEPTION 'This entry belongs to a signed record and cannot be moved' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    allowed := CASE TG_TABLE_NAME WHEN 'RabiesCertificate' THEN ARRAY['document', 'voidedAt', 'voidReason', 'updatedAt'] ELSE ARRAY[]::text[] END;
    IF (to_jsonb(NEW) - allowed) = (to_jsonb(OLD) - allowed) THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION '% is signed; this entry cannot change (add an addendum instead)', enc_ref USING ERRCODE = 'check_violation';
END $$;
