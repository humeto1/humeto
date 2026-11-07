-- Preserve target definitions even when the activity has not logged results yet.
CREATE OR REPLACE FUNCTION humeto_kpi_target_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE effective DATE;
BEGIN
 IF TG_OP='UPDATE' AND (OLD.target,OLD.unit,OLD.direction,OLD.cadence,OLD.timezone) IS NOT DISTINCT FROM (NEW.target,NEW.unit,NEW.direction,NEW.cadence,NEW.timezone) THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
  effective='0001-01-01';
 ELSIF (OLD.cadence,OLD.timezone) IS DISTINCT FROM (NEW.cadence,NEW.timezone) AND NOT EXISTS(SELECT 1 FROM plan_kpi_results WHERE kpi_id=NEW.id) THEN
  DELETE FROM activity_kpi_targets WHERE kpi_id=NEW.id;
  effective='0001-01-01';
 ELSE
  effective=(now() AT TIME ZONE NEW.timezone)::date;
 END IF;
 INSERT INTO activity_kpi_targets(kpi_id,effective_from,target,unit,direction)
 VALUES(NEW.id,effective,NEW.target,NEW.unit,NEW.direction)
 ON CONFLICT(kpi_id,effective_from) DO UPDATE SET target=excluded.target,unit=excluded.unit,direction=excluded.direction;
 RETURN NEW;
END $$;
