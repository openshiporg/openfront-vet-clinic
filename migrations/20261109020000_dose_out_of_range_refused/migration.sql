-- N2 (r2): a dose outside the formulary range is refused outright, whatever the reason (the
-- application refuses above_range / below_range as hard blocks since dose-2026.11-3). The database
-- refuses a new calculation that carries one. DoseCalculation is append-only, so an INSERT trigger
-- covers every future row without rewriting the two earlier calculations that carry a range warning
-- (ORD-2026-000008, reversed; ORD-2026-000015, cancelled), which stay as the evidence they are.
CREATE OR REPLACE FUNCTION vc_dose_in_range() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.warnings @> '[{"code": "above_range"}]'::jsonb OR NEW.warnings @> '[{"code": "below_range"}]'::jsonb THEN
    RAISE EXCEPTION 'A dose outside the formulary range is not given (DoseCalculation_in_range)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "DoseCalculation_in_range" BEFORE INSERT ON "DoseCalculation" FOR EACH ROW EXECUTE FUNCTION vc_dose_in_range();
