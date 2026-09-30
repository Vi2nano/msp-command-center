<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# Architecture rules
- Console pages live under src/routes/_authenticated/ and query via the browser client with RLS — tenant isolation is enforced in the database (is_staff/current_tenant).
- First signup is auto-granted msp_admin in handle_new_user — bootstraps the MSP owner without manual SQL.
- Endpoint agents talk to /api/public/agent/* with a per-device bearer token stored only as a SHA-256 hash — a leaked database row can't impersonate a device.
- Remote scripts are queued in script_runs and handed out on agent check-in (pull model) — no inbound connectivity to endpoints needed.
