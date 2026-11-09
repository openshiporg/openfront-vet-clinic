-- Review r5 #4: scribe maker-checker in the database. A draft a person decided (accepted, partly accepted or
-- rejected) names who decided and when; a revision that came from the scribe names the draft and its author.
ALTER TABLE "ScribeDraft" ADD CONSTRAINT "ScribeDraft_decision_names_decider"
  CHECK (status NOT IN ('accepted', 'partly_accepted', 'rejected') OR ("decidedBy" IS NOT NULL AND "decidedAt" IS NOT NULL)) NOT VALID;
ALTER TABLE "ScribeDraft" VALIDATE CONSTRAINT "ScribeDraft_decision_names_decider";
ALTER TABLE "SoapSectionRevision" ADD CONSTRAINT "SoapSectionRevision_scribe_has_draft_and_author"
  CHECK (source <> 'scribe' OR ("scribeDraft" IS NOT NULL AND "author" IS NOT NULL)) NOT VALID;
ALTER TABLE "SoapSectionRevision" VALIDATE CONSTRAINT "SoapSectionRevision_scribe_has_draft_and_author";
