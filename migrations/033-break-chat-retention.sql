-- The public room displays the last day. Retain messages/report evidence for moderation for at most 30 days.
CREATE FUNCTION humeto_purge_break_chat() RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE removed INTEGER;
BEGIN
 DELETE FROM break_messages WHERE created_at < now()-interval '30 days';
 GET DIAGNOSTICS removed = ROW_COUNT;
 RETURN removed;
END $$;
