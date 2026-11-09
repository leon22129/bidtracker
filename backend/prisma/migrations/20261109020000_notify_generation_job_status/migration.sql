CREATE FUNCTION notify_generation_job_status() RETURNS trigger AS $$
BEGIN
    PERFORM pg_notify('bidtracker_generation_jobs', json_build_object(
        'schema', TG_TABLE_SCHEMA, 'job_id', NEW.id, 'status', NEW.status
    )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER generation_job_status_changed
AFTER UPDATE OF status ON generation_jobs
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION notify_generation_job_status();
