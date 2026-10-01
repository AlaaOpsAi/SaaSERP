# Workspace approval workflow

New companies don't get a live workspace straight away. They **request** one and a platform operator reviews it.

```
 sign-up ──► PENDING ──approve──► ACTIVE ◄──reactivate── SUSPENDED
                │                    └──────suspend──────────▲
                └──reject──► REJECTED ──approve (reconsider)──► ACTIVE
```

| Status | Owner can sign in? | What the owner sees |
|---|---|---|
| pending | no | "Your workspace is waiting for approval" |
| active | yes | the app |
| rejected | no | "Your workspace request was not approved" plus your reason |
| suspended | no; existing sessions end on their next request | "This workspace has been suspended" plus your reason |

Data is never deleted by these actions. Suspending and then reactivating a workspace restores everything.

## Operator console: `/platform`

Operators are separate from workspace users. They have their own table, their own login and a token that cannot open any workspace data.

- The queue shows each request's company, owner, email, phone, the "about your business" note, and when it was requested.
- **Approve** sets the plan (trial / starter / pro / enterprise) and the maximum number of login users.
- **Reject** and **Suspend** require a reason, which the customer sees when they try to sign in.
- **Plan** changes the plan or user limit of an active workspace.
- Each decision records who made it and when.

Create an operator:

```bash
npm run platform:admin -w apps/api -- you@company.com 'a-long-password' "Your Name"             # local
docker compose exec app node apps/api/dist/scripts/create-platform-admin.js you@company.com 'a-long-password' "Your Name"   # Docker
```

Running the same command again for an existing email resets that operator's password.

## Settings

| Variable | Default | Effect |
|---|---|---|
| `AUTO_APPROVE_SIGNUPS` | `false` | `true` activates new workspaces immediately (e.g. for a demo server) |
| `SIGNUP_WEBHOOK_URL` | empty | POSTs `{ "text": "New workspace waiting for approval: …" }` to a Slack/Teams/Zapier incoming webhook on every sign-up |

## How it is enforced

- `tenants.status` (migration `002_workspace_approval.sql`).
- Login refuses a workspace that isn't active and returns the status and reason.
- Every API request re-checks the workspace status inside its transaction, so a suspension takes effect at once instead of waiting for the token to expire.
- Operator routes (`/api/platform/*`) need a platform token, and workspace routes reject platform tokens. Cross-tenant reads go through `SECURITY DEFINER` functions (`platform_tenants`, `platform_update_tenant`). Row-level security on tenant data is unchanged.
