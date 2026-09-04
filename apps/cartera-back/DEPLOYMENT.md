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
