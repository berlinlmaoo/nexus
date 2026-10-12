-- Forms bug hunt (12 Oct 2026): a double click on Send made two responses and two tasks. The web form now
-- sends an attempt id; one (form, attempt id) pair is one response. Additive: a nullable column and a
-- unique index (NULLs never collide, so the released apps, which send no key, are unaffected).
ALTER TABLE "FormSubmission" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "FormSubmission_formId_idempotencyKey_key" ON "FormSubmission"("formId", "idempotencyKey");
