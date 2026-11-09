# Adult profile-write gate — partially deployed

A live aggregate-only check found seven non-demo onboarded profiles: zero with a
valid under-18 date and one with a missing/invalid birthday. No identity or
birthday was retrieved. The new server guard validates birthday writes and onboarding transitions, but
pre-onboarding access still requires server-side gating across social paths. Do not enable teen mode or claim server-side
age isolation on this basis.

01 and 02 are the original disposable experiments. The matching profile-write
guard was deployed as `20261109110817_harden_adult_profile_writes`; the trigger
rejects invalid/under-18 self-reported birthdays and completing onboarding
without an adult birthday, while allowing incomplete signups. `age_of` handles
invalid calendar dates and is STABLE because it depends on today's date. Test
cases exercise direct authenticated table writes, the 18th-birthday boundary and
invalid/missing/over-99 dates. A self-reported date does not verify real age.

Before release: design a safe remediation and re-onboarding experience for
existing incomplete records, enforce adult eligibility on all social RPCs and
direct table/media/realtime paths even before onboarding is complete, ensure
age changes and signups cannot race with access, test service roles/migration
and installed clients, and handle correct birthday recovery. Teen mode requires
separate verified/enforced isolation and safeguards; it must remain off.
