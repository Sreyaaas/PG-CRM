<!-- Title must start with the ticket ID, e.g. "BE-31: Log payment". Chores: add [no-ticket]. -->

Closes #

## What changed
<!-- 2–4 bullets. Mention any migration, new endpoint or changed field. -->

## Verification
- [ ] Ran `python tools/verify_ticket.py <ID>` locally: **VERIFIED**
- [ ] Every automated acceptance criterion has a tagged test
      (backend `@pytest.mark.ac("BE-31", "AC1")`, frontend test title `[FE-21/AC1]`)
- [ ] `contract/openapi.json` regenerated if the API changed

## Manual acceptance criteria
<!-- Copy each [manual] criterion from the issue, check it yourself, then tick it. CI re-runs when you edit this.
- [x] AC4 Tested on Redmi Note 12, Chrome: approve check-in took 22 s
-->

## Screenshots (frontend)
<!-- Phone screenshot(s) of the changed screens. -->
