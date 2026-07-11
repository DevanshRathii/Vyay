CREATE TABLE "preapproved_emails" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "preapproved_emails_email_unique" UNIQUE("email")
);
