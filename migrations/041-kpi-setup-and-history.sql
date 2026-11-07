-- KPI targets include valid zero limits; old logged snapshots remain untouched.
ALTER TABLE activity_kpis DROP CONSTRAINT plan_kpis_target_check;
ALTER TABLE activity_kpis ADD CONSTRAINT activity_kpis_target_check CHECK(target>=0 AND target<=1000000000000);
ALTER TABLE activity_kpis DROP CONSTRAINT plan_kpis_cadence_check;
ALTER TABLE activity_kpis ADD CONSTRAINT activity_kpis_cadence_check CHECK(cadence IN ('once','daily','weekly','monthly','quarterly','half_year','yearly'));
CREATE TABLE activity_kpi_targets (
 kpi_id TEXT NOT NULL REFERENCES activity_kpis(id) ON DELETE CASCADE,
 effective_from DATE NOT NULL,
 target NUMERIC NOT NULL CHECK(target>=0 AND target<=1000000000000),
 unit TEXT NOT NULL,
 direction TEXT NOT NULL CHECK(direction IN ('at_least','at_most')),
 PRIMARY KEY(kpi_id,effective_from)
);
-- Before version tracking, only saved period snapshots are historical evidence.
-- Retain those snapshots; use the existing definition as the legacy baseline.
INSERT INTO activity_kpi_targets(kpi_id,effective_from,target,unit,direction)
 SELECT id,'0001-01-01',target,unit,direction FROM activity_kpis;
CREATE FUNCTION humeto_kpi_target_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE effective DATE;
BEGIN
 IF TG_OP='UPDATE' AND (OLD.target,OLD.unit,OLD.direction,OLD.cadence,OLD.timezone) IS NOT DISTINCT FROM (NEW.target,NEW.unit,NEW.direction,NEW.cadence,NEW.timezone) THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM plan_kpi_results WHERE kpi_id=NEW.id) THEN
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
CREATE TRIGGER activity_kpi_target_version AFTER INSERT OR UPDATE ON activity_kpis FOR EACH ROW EXECUTE FUNCTION humeto_kpi_target_version();
