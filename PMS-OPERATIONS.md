# PMOffice PMS deployment and recovery

Release preparation: group and individual viewer/editor roles implemented. Production status is recorded separately; do not merge until the protected API is deployed and verified.

## Architecture

- Existing public homepage: VitePress on GitHub Pages, same domain and existing inquiry Admin.
- /pms/: project catalog; /pms/<slug>/: generic project shell. Titles, permissions and customer data load at runtime.
- Supabase: existing Google authentication, profiles and current server-side is_admin. PMS tables have RLS and no direct anon/authenticated grants.
- Private repository: NAMWoongchan/pmoffice-pms-data; projects/<slug>/workbook.json is the versioned source. It contains the original Excel bytes, not a spreadsheet re-creation.
- Supabase Edge pms function checks current project access before GitHub reads and again before sending file bytes. It fails closed if the data repository is public.
- The shared viewer supports PMOffice Excel workbooks with a master sheet named 사업 일정표 and one schedule sheet per organization token. Different spreadsheet schemas and entirely different site applications need an adapter.

## Required production setup

1. Preserve the existing DB definitions and take the available backup before applying supabase/migrations/202610200001_pms.sql, then 202610200002_pms_groups.sql. Requires the existing profiles, service_settings, account_ok and is_admin. This migration adds PMS tables/functions only; no existing inquiry/account function is replaced.
2. In GitHub, create a fine-grained token limited to NAMWoongchan/pmoffice-pms-data and NAMWoongchan/pmoffice, Contents read/write plus required Metadata read. The operator enters it directly in Supabase Edge secrets as PMS_GITHUB_TOKEN. Never enter it in this repository, browser code or a chat.
3. Other server configuration: PMS_DATA_REPO=NAMWoongchan/pmoffice-pms-data; PMS_SITE_REPO=NAMWoongchan/pmoffice; PMS_ALLOWED_ORIGIN=https://pmoffice.co.kr. SUPABASE_URL and SUPABASE_ANON_KEY are standard function environment values.
4. Deploy supabase/functions/pms. Gateway JWT verification is disabled only for this function because public reads must work; every request performs live RPC authorization with the caller token. There is NO service-role authorization bypass. Do not weaken policies in other functions.
5. Add the exact redirect https://pmoffice.co.kr/pms/callback.html to the existing Supabase OAuth allow list without removing the existing admin callback. Reuse the configured Google provider. Verify the Google audience allows real customers.
6. Run real anonymous/member/assigned-member/admin tests against API and direct file requests. Test access revocation, suspended profiles, expired grants, stale update SHA, Google callback, logout, and token failure. Local mock UI and PGlite tests do not establish production authentication.
7. After owner approval of the public/member choice, publish the Korail project through Admin; initial SQL creates a draft; the approved launch changes Korail to public, listed and published after API verification. The imported workbook already resides in the private repository.
8. Merge the homepage branch and verify GitHub Pages completion and /pms/, /pms/korail/, /admin/, /admin/callback.html and the existing inquiry flow.
9. An old public source URL remains public independently. Restrict/unpublish the old ChatGPT Site before claiming that the project is member-only across all addresses; retain its source backup.

## Admin operations

- New project: choose unique lowercase slug → save draft → create homepage address → wait for GitHub Pages build → upload a matching Excel → choose access and listed → publish.
- Public: everyone can retrieve workbook and reports. Members: all active Google members who accepted current signup policy. Assigned: active individual or manually managed group grants.
- Listed shows the project title/description in the catalog even to users who cannot read its workbook. Turn it off for private customer metadata.
- Search an existing Google member by email, grant/revoke access and optionally set expiry.
- Upload commits the original workbook to private GitHub. Optimistic concurrency compares blob SHA; conflicts do not overwrite a newer workbook.
- Version recovery opens an authorized historical commit in the viewer and publishes it as a new commit. Previously downloaded files cannot be recalled.
- Audit: DB records settings and membership changes. GitHub is the durable commit history for workbook versions. A failed post-commit DB audit must be reconciled from GitHub.

## Validation and limits

Commands: pnpm install --frozen-lockfile; pnpm run pms:test; pnpm run docs:build.
Customer-fixture regression tests are private and excluded from Git.
Builds must never contain an XLSM/XLSX, source JSON fixture, token, public workbook fallback or legacy ChatGPT owner-header authentication.
Google login requires normal provider account/consent steps; an exact one-click count or guaranteed One Tap display is not promised.
PMS supports files up to 8 MiB and lists the last 50 Git commits per project.
Visibility revocation blocks subsequent API requests; the screen rechecks every 30 seconds. Already delivered/downloaded data cannot be remotely erased.
GitHub API quotas and the configured Supabase plan may limit throughput. No paid upgrade is included.

## Rollback

Revert only the PMS homepage commit through a new Git commit to restore the previous public UI.
Archive/unpublish the PMS project or disable the pms function to stop new reads.
Do not delete the private repository or rewrite its commit history. Do not drop existing membership/inquiry objects.
The SQL additions can remain disabled while investigating; preserve pms_audit and membership history.

## References

- https://supabase.com/docs/guides/auth/social-login/auth-google — existing Google provider and PKCE callback.
- https://supabase.com/docs/guides/database/postgres/row-level-security — database access boundary.
- https://docs.github.com/en/rest/repos/contents — source writes with current blob SHA.


## Group and editor roles

New projects default to public visibility but remain draft until explicitly published. Draft/archived projects are administrator-only. Public visitors can read/download; only active Google members with a valid editor grant or administrators may publish/restore. Personal and active group grants combine by highest valid role; revoking one grant does not cancel other grants. Group removal, disablement and expiry take effect on subsequent server requests. Only admins can manage groups, permissions, project settings and create routes. The pms_access response exposes canRead, canPublish, canManage and keeps allowed/admin compatibility fields. Never infer admin from editor.
