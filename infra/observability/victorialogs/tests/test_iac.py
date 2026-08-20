from __future__ import annotations

import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CENTRAL_COMPOSE = ROOT / "central" / "compose.yaml"
VMAUTH_TEMPLATE = ROOT / "central" / "config" / "vmauth.template.yaml"
AGENT_COMPOSE = ROOT / "agent" / "compose.yaml"
VECTOR_TEMPLATE = ROOT / "agent" / "config" / "vector.template.yaml"
RENDER = ROOT / "scripts" / "render-config.py"
RENDER_DOCKERFILE = ROOT / "config-renderer.Dockerfile"
SPEC = ROOT / "SPEC.md"
GITIGNORE = ROOT / ".gitignore"


class StaticIacContractTests(unittest.TestCase):
    def read(self, path: Path) -> str:
        self.assertTrue(path.is_file(), f"missing required artifact: {path}")
        return path.read_text(encoding="utf-8")

    def test_central_stack_relies_on_coolify_proxy(self) -> None:
        compose = self.read(CENTRAL_COMPOSE).lower()
        self.assertIn("vmauth", compose)
        self.assertIn("victoria-logs", compose)
        for forbidden_proxy in ("caddy", "nginx", "traefik"):
            self.assertNotIn(forbidden_proxy, compose)
        self.assertNotIn("ports:", compose)
        self.assertIn('"8427"', compose)
        self.assertIn('"9428"', compose)

    def test_images_are_versioned_and_digest_pinned(self) -> None:
        central = self.read(CENTRAL_COMPOSE)
        agent = self.read(AGENT_COMPOSE)
        self.assertRegex(
            central,
            r"victoriametrics/victoria-logs:v1\.52\.0@sha256:[a-f0-9]{64}",
        )
        self.assertRegex(
            central,
            r"victoriametrics/vmauth:v1\.150\.0@sha256:[a-f0-9]{64}",
        )
        self.assertRegex(agent, r"timberio/vector:0\.57\.0-debian@sha256:[a-f0-9]{64}")

    def test_retention_and_memory_are_safe_for_25gb_host(self) -> None:
        compose = self.read(CENTRAL_COMPOSE)
        self.assertIn("-retentionPeriod=30d", compose)
        self.assertIn("-retention.maxDiskSpaceUsageBytes=12GiB", compose)
        self.assertIn("-memory.allowedBytes=512MiB", compose)
        self.assertNotIn("18GiB", compose)

    def test_vmauth_separates_query_and_ingest_and_blocks_internal(self) -> None:
        template = self.read(VMAUTH_TEMPLATE)
        self.assertIn('src_paths: ["^/health$"]', template)
        self.assertIn('src_paths: ["/select/.*"]', template)
        self.assertIn('src_paths: ["/insert/.*"]', template)
        self.assertNotIn("/internal/", template)
        self.assertNotIn("/metrics", template)
        self.assertNotIn("password: bar", template)

    def test_vector_uses_low_cardinality_stream_fields_and_bounded_buffer(self) -> None:
        vector = self.read(VECTOR_TEMPLATE)
        self.assertIn("_stream_fields: service,environment,host,container_name", vector)
        stream_line = next(line for line in vector.splitlines() if "_stream_fields:" in line)
        for forbidden in ("request_id", "trace_id", "operation_id", "user_id", "credit_id"):
            self.assertNotIn(forbidden, stream_line)
        self.assertIn("type: disk", vector)
        self.assertIn("max_size: 536870912", vector)
        self.assertIn("when_full: drop_newest", vector)

    def test_vector_has_defense_in_depth_redaction(self) -> None:
        vector = self.read(VECTOR_TEMPLATE).lower()
        for sensitive_name in (
            "authorization",
            "cookie",
            "password",
            "token",
            "api_key",
            "dpi",
            "nit",
            "phone",
            "email",
        ):
            self.assertIn(sensitive_name, vector)

    def test_runtime_config_is_generated_from_compose_secrets(self) -> None:
        central = self.read(CENTRAL_COMPOSE)
        agent = self.read(AGENT_COMPOSE)
        dockerfile = self.read(RENDER_DOCKERFILE)

        self.assertIn("config-init:", central)
        self.assertEqual(central.count("exclude_from_hc: true"), 1)
        self.assertIn("condition: service_completed_successfully", central)
        self.assertIn("environment: VMAUTH_QUERY_PASSWORD", central)
        self.assertIn("environment: VMAUTH_INGEST_PASSWORD", central)
        self.assertIn("vmauth-config:/etc/vmauth:ro", central)
        self.assertNotIn("./runtime/vmauth.yaml", central)

        self.assertIn("config-init:", agent)
        self.assertEqual(agent.count("exclude_from_hc: true"), 1)
        self.assertIn("condition: service_completed_successfully", agent)
        self.assertIn("environment: VECTOR_INGEST_PASSWORD", agent)
        self.assertIn("vector-config:/etc/vector:ro", agent)
        self.assertNotIn("./runtime/vector.yaml", agent)

        self.assertRegex(
            dockerfile,
            r"FROM python:3\.13-alpine@sha256:[a-f0-9]{64}",
        )

    def test_runtime_and_secret_material_are_gitignored(self) -> None:
        ignore = self.read(GITIGNORE)
        self.assertIn("central/runtime/", ignore)
        self.assertIn("central/secrets/", ignore)
        self.assertIn("agent/runtime/", ignore)
        self.assertIn("agent/secrets/", ignore)

    def test_spec_covers_required_architecture_decisions(self) -> None:
        spec = self.read(SPEC).lower()
        for required in (
            "coolify",
            "telemetría frontend",
            "stream fields",
            "auditoría de negocio",
            "request_id",
            "operation_id",
            "rotación local",
            "podman",
        ):
            self.assertIn(required, spec)


class RendererTests(unittest.TestCase):
    def test_central_renderer_requires_distinct_credentials_and_writes_0600(self) -> None:
        self.assertTrue(RENDER.is_file(), f"missing renderer: {RENDER}")
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            secrets = base / "secrets"
            secrets.mkdir()
            values = {
                "query_username": "query-user",
                "query_password": "query-password-at-least-24-chars",
                "ingest_username": "ingest-user",
                "ingest_password": "ingest-password-at-least-24-chars",
            }
            for name, value in values.items():
                (secrets / name).write_text(value + "\n", encoding="utf-8")
            output = base / "runtime" / "vmauth.yaml"
            result = subprocess.run(
                [
                    sys.executable,
                    str(RENDER),
                    "central",
                    "--secrets-dir",
                    str(secrets),
                    "--output",
                    str(output),
                    "--template",
                    str(VMAUTH_TEMPLATE),
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            rendered = output.read_text(encoding="utf-8")
            for value in values.values():
                self.assertIn(value, rendered)
                self.assertNotIn(value, result.stdout + result.stderr)
            self.assertNotIn("__QUERY_", rendered)
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)

    def test_renderer_rejects_same_query_and_ingest_password(self) -> None:
        self.assertTrue(RENDER.is_file(), f"missing renderer: {RENDER}")
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            secrets = base / "secrets"
            secrets.mkdir()
            (secrets / "query_username").write_text("query-user", encoding="utf-8")
            (secrets / "ingest_username").write_text("ingest-user", encoding="utf-8")
            shared = "same-password-at-least-24-chars"
            (secrets / "query_password").write_text(shared, encoding="utf-8")
            (secrets / "ingest_password").write_text(shared, encoding="utf-8")
            result = subprocess.run(
                [
                    sys.executable,
                    str(RENDER),
                    "central",
                    "--secrets-dir",
                    str(secrets),
                    "--output",
                    str(base / "runtime" / "vmauth.yaml"),
                    "--template",
                    str(VMAUTH_TEMPLATE),
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn(shared, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
