# Agent notes

Sign-in limit (`features/keystone/security/signInLimit.ts`, every path: API, dashboard form, OAuth forms): per address 20 attempts/15 min; per account+address 5 failures/15 min (only that address is refused); per account from never-signed-in addresses, after 10 attempts/15 min each further new address gets 1 attempt per 15 min (a delay, never a block: a first attempt always runs).
An address that signed in to the account in the last 90 days or redeemed a reset for it skips the address and account counts, a device still signed in is never refused, a success or reset clears the account; unknown emails add no per-email rows and expired rows are swept on each attempt (no timer).
