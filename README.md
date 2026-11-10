# Openfront Vet Clinic

The open-source alternative to Avimark.

Openfront Vet Clinic runs a veterinary practice on one system: clients and patients with species, breed and weight history, appointments, boarding and grooming, SOAP medical records, vaccines and reminders, treatment plans and estimates, in-house and reference lab results, inventory, prescriptions and controlled-substance logs, payments, deposits and wellness plans, end-of-life care, and public booking and client-portal APIs. AI agents work through the same records over MCP.

Built on Next.js and KeystoneJS 6 with PostgreSQL.

## What works today

- **Practice set-up (Phase 0):** locations, staff with licences and DEA registrations, roles, maker-checker approvals, a hash-chained audit log, a read audit on every client and clinical record, and federal and California policy packs that fail closed when a rule is missing.
- **Front desk (Phase 1):** clients (households), patients with alerts, weights, microchips and VCPR status, a day sheet with booking, a patient-flow whiteboard, a waitlist, client messages with quiet hours and STOP handling, and the controlled-substance register foundation (the database refuses a negative balance and Schedule II refills).
- **AI receptionist (inbound calls only):** it plays an AI and recording disclosure, screens for emergencies (an emergency is transferred, never booked), verifies the caller before sharing anything, books routine visits and takes refill and records requests for staff. It works only through scoped MCP tools, can be switched off instantly, and is switched on only by a second approver. It never prescribes, never touches controlled substances and never makes outbound calls.

Coming next: the medical record, orders, vaccines and reminders, inventory, invoicing, payments and wellness plans (see the build plan).

## Coming from another system

Practice-management imports run behind adapters, so a practice can move over without retyping its records. ezyVet and Avimark are the first two import targets; Cornerstone follows the same adapter contract.

## Sample practice

The seed loads **Cedar Creek Animal Hospital** (Sacramento, CA) and its Elk Grove satellite: 20+ staff, 400 households and about 640 patients. Every name, phone number and address is fictional. Phones use the 916-555-01xx range. Staff emails use the practice's own domain (for example `elena.marsh@cedarcreekvet.com`) and clients use common mail providers. Messaging and telephony run on manual or recording adapters in the sample, so nothing is ever sent.

Seeded staff cannot sign in until an owner sets their password. Create the first owner at `/dashboard/init`, then load the sample practice from onboarding or set staff passwords from the Team screen.

## Running it

```bash
cp .env.example .env   # set DATABASE_URL and SESSION_SECRET
npm install
npm run dev            # builds Keystone, applies migrations, starts Next.js
```

`npm run verify` runs type checks, lint, unit and database tests (database tests need `VC_TEST_DATABASE_URL`).

## Using the GraphQL API

- A top-level list returns at most 500 rows; page through it with `take` and `skip`.
- A nested list with no `take` returns at most 50 rows. A few short ones (a patient's owners, microchips, VCPRs and insurance; a client's people; a person's contact points) return at most 10. Pass `take` (up to 500) for more.
- One request may ask for about 5,000 rows and 2,000 nested lookups in total. A request over that is refused with `QUERY_TOO_BROAD` before it runs.
- One request may sign in only once, and may check the audit chain at most twice.
- After 5 failed sign-ins for one email, or 20 from one address, within 15 minutes, sign-in answers "Too many sign-in attempts. Try again later." until the 15 minutes pass. A successful sign-in resets the email's count.

## License

MIT. See [LICENSE](./LICENSE).
