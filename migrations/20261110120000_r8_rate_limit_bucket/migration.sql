-- Review r8 #3: the sign-in limiter sweeps expired rows by window start, and a count is never negative.
CREATE INDEX "RateLimitBucket_windowStart_idx" ON "RateLimitBucket"("windowStart");
ALTER TABLE "RateLimitBucket" ADD CONSTRAINT "RateLimitBucket_count_not_negative" CHECK ("count" IS NULL OR "count" >= 0) NOT VALID;
ALTER TABLE "RateLimitBucket" VALIDATE CONSTRAINT "RateLimitBucket_count_not_negative";
