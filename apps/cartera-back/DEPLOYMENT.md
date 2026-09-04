# Cartera backend deployment safeguards

## Coolify health check

The production application must keep its Coolify health check enabled with:

- method: `GET`
- expected status: `200`
- path: `/health` once the release containing that endpoint is in production

Until that release reaches production, `/` remains the compatible health-check path.
The `/health` route is intentionally a lightweight process-readiness check. It does
not query PostgreSQL or external integrations.

## Production environment gate

`required-env.production.json` inventories the environment variables managed
directly on the production Cartera application in Coolify. Before building or
pushing a production image, `deploy-prod.yaml` reads Coolify's environment-variable
metadata and fails closed when a required key:

- is missing;
- exists only for preview deployments;
- is duplicated in the production scope; or
- is disabled at runtime.

The validator never logs or compares variable values. Variables inherited from an
image or another configuration source are outside this manifest. Update the
manifest in the same pull request whenever the application-managed production
inventory intentionally changes.

### Seed Coolify before merging a new key

The gate fails closed, so the order matters: seed the value in Coolify **first**,
merge the manifest change **after**. A key added to the manifest that does not yet
exist in Coolify turns the next production deploy of `cartera-back` red — including
an unrelated hotfix.

`AUTH_GOOGLE_URL` and `PORTAL_PROVISIONING_SECRET` are the portal-provisioning pair
(`src/services/portalProvisioning.ts`). Both must be production-scoped and
runtime-enabled — the validator rejects `preview-only` and `runtime-disabled` the
same way it rejects `missing`. `AUTH_GOOGLE_URL` is the auth-google base URL with no
trailing slash, and `PORTAL_PROVISIONING_SECRET` must hold the *same value* as the
one configured on auth-google. The manifest only proves presence, never that the two
services agree: a mismatched secret surfaces at runtime as `http_401` in the daily
provisioning summary, not as a failed deploy.

auth-google deliberately has no equivalent gate. `src/config/env.ts` reads the secret
with a `|| ""` fallback and only warns, because losing login is worse than losing
provisioning; the endpoint closes itself with a 503 instead. A CI gate there would
block a login hotfix, which is exactly what that decision avoids.
