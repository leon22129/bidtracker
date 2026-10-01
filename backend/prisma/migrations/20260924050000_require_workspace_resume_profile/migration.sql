-- The unique workspace_id index enforces "at most one". Deferred constraint triggers enforce
-- "at least one" while still allowing Workspace and ResumeProfile to be inserted in one transaction.
CREATE FUNCTION "assert_workspace_has_resume_profile"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  old_workspace_id TEXT;
  new_workspace_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'workspaces' THEN
    new_workspace_id := NEW."id";
  ELSE
    IF TG_OP <> 'INSERT' THEN
      old_workspace_id := OLD."workspace_id";
    END IF;
    IF TG_OP <> 'DELETE' THEN
      new_workspace_id := NEW."workspace_id";
    END IF;
  END IF;

  IF old_workspace_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM "workspaces" WHERE "id" = old_workspace_id)
     AND NOT EXISTS (SELECT 1 FROM "resume_profiles" WHERE "workspace_id" = old_workspace_id) THEN
    RAISE EXCEPTION 'Workspace % must have exactly one resume profile', old_workspace_id
      USING ERRCODE = '23514';
  END IF;

  IF new_workspace_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM "workspaces" WHERE "id" = new_workspace_id)
     AND NOT EXISTS (SELECT 1 FROM "resume_profiles" WHERE "workspace_id" = new_workspace_id) THEN
    RAISE EXCEPTION 'Workspace % must have exactly one resume profile', new_workspace_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "workspaces_require_resume_profile"
AFTER INSERT OR UPDATE ON "workspaces"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "assert_workspace_has_resume_profile"();

CREATE CONSTRAINT TRIGGER "resume_profiles_require_workspace_profile"
AFTER INSERT OR UPDATE OR DELETE ON "resume_profiles"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "assert_workspace_has_resume_profile"();
