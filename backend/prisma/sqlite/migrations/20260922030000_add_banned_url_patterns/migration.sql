CREATE TABLE "banned_url_patterns" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pattern" TEXT NOT NULL,
    "created_by_user_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "banned_url_patterns_created_by_user_id_fkey"
      FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "banned_url_patterns_pattern_key" ON "banned_url_patterns"("pattern");
CREATE INDEX "banned_url_patterns_created_by_user_id_idx" ON "banned_url_patterns"("created_by_user_id");

INSERT INTO "banned_url_patterns" ("id", "pattern") VALUES
('banned-sundayy', 'sundayy'),
('banned-remotehunter', 'remotehunter'),
('banned-alignerr', 'alignerr'),
('banned-jackandjill', 'jackandjill'),
('banned-fetchjobs', 'fetchjobs'),
('banned-afterquery', 'afterquery'),
('banned-hire-feed', 'hire feed'),
('banned-bestjobtool', 'bestjobtool'),
('banned-haystack', 'haystack'),
('banned-gdit', 'gdit'),
('banned-saic', 'saic'),
('banned-accenture', 'accenture'),
('banned-amazon', 'amazon'),
('banned-turing', 'turing'),
('banned-fullstacklabs', 'fullstacklabs'),
('banned-infosys', 'infosys'),
('banned-tcs', 'tcs'),
('banned-collabera', 'collabera'),
('banned-hcl', 'hcl'),
('banned-agileengine', 'agileengine'),
('banned-pearson', 'pearson'),
('banned-osc-global', 'osc global'),
('banned-teamworxsecurity', 'teamworxsecurity'),
('banned-jackhenry', 'jackhenry'),
('banned-github', 'github'),
('banned-cvshealth', 'cvshealth'),
('banned-capitalone', 'capitalone'),
('banned-brightvisiontechnologies', 'brightvisiontechnologies'),
('banned-yohrconsultancy', 'yohrconsultancy.hiresome.ai'),
('banned-micro1', 'jobs.micro1.ai'),
('banned-yoailabs', 'yoailabs'),
('banned-mercor', 'mercor'),
('banned-theladders', 'theladders'),
('banned-teksystems', 'teksystems'),
('banned-caci', 'caci'),
('banned-affirm', 'affirm'),
('banned-maximus', 'maximus'),
('banned-mindrift', 'mindrift'),
('banned-peraton', 'peraton');

