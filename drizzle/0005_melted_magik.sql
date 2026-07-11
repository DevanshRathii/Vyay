-- feedback_messages (table + FK + index) was already created by an earlier,
-- since-superseded version of this migration file, applied to the database
-- via an automatic Vercel preview-deployment build (MIGRATE_DATABASE_URL is
-- shared between Preview and Production) before this file was regenerated.
-- That earlier version also added users.approved, which this branch later
-- decided not to keep — clean it up here since the column-add itself already
-- landed for real and schema.ts no longer declares it.
ALTER TABLE "users" DROP COLUMN IF EXISTS "approved";
