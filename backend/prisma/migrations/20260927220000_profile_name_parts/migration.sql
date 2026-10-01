ALTER TABLE "resume_profiles"
  ADD COLUMN "first_name" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "middle_name" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "last_name" TEXT NOT NULL DEFAULT '';

WITH parsed_names AS (
  SELECT
    "id",
    regexp_split_to_array(btrim("full_name"), E'\\s+') AS parts
  FROM "resume_profiles"
  WHERE btrim("full_name") <> ''
)
UPDATE "resume_profiles" AS profile
SET
  "first_name" = parsed.parts[1],
  "middle_name" = CASE
    WHEN cardinality(parsed.parts) > 2
      THEN array_to_string(parsed.parts[2:cardinality(parsed.parts) - 1], ' ')
    ELSE ''
  END,
  "last_name" = CASE
    WHEN cardinality(parsed.parts) > 1
      THEN parsed.parts[cardinality(parsed.parts)]
    ELSE ''
  END
FROM parsed_names AS parsed
WHERE profile."id" = parsed."id";
