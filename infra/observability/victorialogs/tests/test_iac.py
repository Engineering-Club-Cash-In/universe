from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from collections.abc import Sequence
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CENTRAL_COMPOSE = ROOT / "central" / "compose.yaml"
VMAUTH_TEMPLATE = ROOT / "central" / "config" / "vmauth.template.yaml"
RENDER = ROOT / "scripts" / "render-config.py"
VERIFY_SECRET_ISOLATION = ROOT / "scripts" / "verify-secret-isolation.py"
VERIFY_HOST_SECRET_FILES = ROOT / "scripts" / "verify-host-secret-files.py"
RENDER_DOCKERFILE = ROOT / "config-renderer.Dockerfile"
README = ROOT / "README.md"
SPEC = ROOT / "SPEC.md"
GITIGNORE = ROOT / ".gitignore"
DOCKERIGNORE = ROOT / ".dockerignore"
ENV_EXAMPLE = ROOT / "central" / ".env.example"
PROJECT = "observability-test"
SERVICES = ("config-init", "victoria-logs", "vmauth")


class StaticCentralIacTests(unittest.TestCase):
    def read(self, path: Path) -> str:
        self.assertTrue(path.is_file(), f"missing required artifact: {path}")
        return path.read_text(encoding="utf-8")

    def test_stack_relies_on_coolify_proxy(self) -> None:
        compose = self.read(CENTRAL_COMPOSE).lower()
        self.assertIn("vmauth", compose)
        self.assertIn("victoria-logs", compose)
        for forbidden_proxy in ("caddy", "nginx", "traefik"):
            self.assertNotIn(forbidden_proxy, compose)
        self.assertNotIn("ports:", compose)
        self.assertIn('"8427"', compose)
        self.assertIn('"9428"', compose)

    def test_images_are_versioned_and_digest_pinned(self) -> None:
        compose = self.read(CENTRAL_COMPOSE)
        dockerfile = self.read(RENDER_DOCKERFILE)
        self.assertRegex(
            compose,
            r"victoriametrics/victoria-logs:v1\.52\.0@sha256:[a-f0-9]{64}",
        )
        self.assertRegex(
            compose,
            r"victoriametrics/vmauth:v1\.150\.0@sha256:[a-f0-9]{64}",
        )
        self.assertRegex(
            dockerfile,
            r"FROM python:3\.13-alpine@sha256:[a-f0-9]{64}",
        )

    def test_retention_and_memory_fit_the_25gb_host(self) -> None:
        compose = self.read(CENTRAL_COMPOSE)
        self.assertIn("-retentionPeriod=30d", compose)
        self.assertIn("-retention.maxDiskSpaceUsageBytes=12GiB", compose)
        self.assertIn("-memory.allowedBytes=512MiB", compose)
        self.assertNotIn("18GiB", compose)

    def test_vmauth_separates_query_and_ingest(self) -> None:
        compose = self.read(CENTRAL_COMPOSE)
        template = self.read(VMAUTH_TEMPLATE)
        self.assertIn("-httpInternalListenAddr=127.0.0.1:8428", compose)
        self.assertIn('src_paths: ["^/health$"]', template)
        self.assertIn('src_paths: ["/select/.*"]', template)
        self.assertIn('src_paths: ["/insert/.*"]', template)
        self.assertNotIn("/internal/", template)
        self.assertNotIn("/metrics", template)

    def test_runtime_config_uses_compose_secrets(self) -> None:
        compose = self.read(CENTRAL_COMPOSE)
        self.assertIn("config-init:", compose)
        self.assertEqual(compose.count("exclude_from_hc: true"), 1)
        self.assertIn("condition: service_completed_successfully", compose)
        self.assertNotIn("environment: VMAUTH_QUERY_PASSWORD", compose)
        self.assertNotIn("environment: VMAUTH_INGEST_PASSWORD", compose)
        self.assertIn(
            "file: ${VICTORIALOGS_SECRETS_DIR:-./secrets}/query_username",
            compose,
        )
        self.assertIn(
            "file: ${VICTORIALOGS_SECRETS_DIR:-./secrets}/query_password",
            compose,
        )
        self.assertIn(
            "file: ${VICTORIALOGS_SECRETS_DIR:-./secrets}/ingest_username",
            compose,
        )
        self.assertIn(
            "file: ${VICTORIALOGS_SECRETS_DIR:-./secrets}/ingest_password",
            compose,
        )
        self.assertIn("vmauth-config:/etc/vmauth:ro", compose)
        self.assertNotIn("./runtime/vmauth.yaml", compose)

    def test_runtime_and_secret_material_are_gitignored(self) -> None:
        ignore = self.read(GITIGNORE)
        self.assertIn("central/runtime/", ignore)
        self.assertIn("central/secrets/", ignore)
        self.assertNotIn("agent/", ignore)

    def test_runtime_and_secret_material_are_dockerignored(self) -> None:
        ignore = self.read(DOCKERIGNORE)
        self.assertIn("central/runtime/**", ignore)
        self.assertIn("central/secrets/**", ignore)
        self.assertIn("**/.env", ignore)
        self.assertIn("**/.env.*", ignore)

    def test_env_example_contains_only_the_non_sensitive_path(self) -> None:
        example = self.read(ENV_EXAMPLE)
        self.assertIn("VICTORIALOGS_SECRETS_DIR=", example)
        self.assertNotIn("VMAUTH_QUERY_", example)
        self.assertNotIn("VMAUTH_INGEST_", example)

    def test_secret_provisioning_refuses_existing_files(self) -> None:
        readme = self.read(README)
        self.assertIn("os.O_EXCL", readme)
        self.assertNotIn("install -m 600 /dev/null", readme)
        self.assertIn("nunca lo trunca", readme)

    def test_agent_is_explicitly_out_of_scope(self) -> None:
        self.assertFalse((ROOT / "agent").exists())
        spec = self.read(SPEC)
        self.assertIn("fuera de este PR", spec)
        self.assertIn("PRs posteriores", spec)
        self.assertNotIn("docker-socket-proxy", self.read(CENTRAL_COMPOSE))


class RendererAndGateTests(unittest.TestCase):
    @staticmethod
    def container(
        service: str,
        *,
        project: str = PROJECT,
        environment: object = None,
        name: str | None = None,
        include_project: bool = True,
    ) -> dict[str, object]:
        labels: dict[str, object] = {"com.docker.compose.service": service}
        if include_project:
            labels["com.docker.compose.project"] = project
        return {
            "Name": name or f"/{project}-{service}-1",
            "Config": {
                "Env": [] if environment is None else environment,
                "Labels": labels,
            },
        }

    def run_gate(self, containers: Sequence[object]) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as tmp:
            inspect_path = Path(tmp) / "inspect.json"
            inspect_path.write_text(json.dumps(containers), encoding="utf-8")
            return subprocess.run(
                [
                    sys.executable,
                    str(VERIFY_SECRET_ISOLATION),
                    PROJECT,
                    str(inspect_path),
                ],
                check=False,
                capture_output=True,
                text=True,
            )

    def test_renderer_writes_0600_without_printing_secrets(self) -> None:
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
                (secrets / name).write_text(value, encoding="utf-8")
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
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)

    def test_renderer_rejects_shared_credentials(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            secrets = base / "secrets"
            secrets.mkdir()
            shared = "shared-password-at-least-24-chars"
            (secrets / "query_username").write_text("query", encoding="utf-8")
            (secrets / "ingest_username").write_text("ingest", encoding="utf-8")
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
                    str(base / "vmauth.yaml"),
                    "--template",
                    str(VMAUTH_TEMPLATE),
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn(shared, result.stdout + result.stderr)

    def write_host_secrets(self, directory: Path, *, canary: str = "") -> None:
        directory.mkdir(mode=0o700)
        values = {
            "query_username": "query-user",
            "query_password": f"query-password-at-least-24-chars{canary}",
            "ingest_username": "ingest-user",
            "ingest_password": "ingest-password-at-least-24-chars",
        }
        for name, value in values.items():
            path = directory / name
            path.write_text(value, encoding="utf-8")
            path.chmod(0o600)

    def run_host_secret_gate(
        self,
        directory: Path,
        *,
        required_uid: int | None = None,
    ) -> subprocess.CompletedProcess[str]:
        command = [sys.executable, str(VERIFY_HOST_SECRET_FILES), str(directory)]
        if required_uid is not None:
            command.extend(["--require-uid", str(required_uid)])
        return subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )

    def test_host_secret_gate_accepts_private_distinct_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp) / "secrets"
            self.write_host_secrets(directory)
            result = self.run_host_secret_gate(directory, required_uid=os.getuid())
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("host_secret_files=PASS files_checked=4", result.stdout)

    def test_host_secret_gate_defaults_to_root_owner(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp) / "secrets"
            self.write_host_secrets(directory)
            result = self.run_host_secret_gate(directory)
            expected_returncode = 0 if os.getuid() == 0 else 2
            self.assertEqual(result.returncode, expected_returncode, result.stderr)

    def test_host_secret_gate_rejects_wrong_required_owner(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp) / "secrets"
            self.write_host_secrets(directory)
            result = self.run_host_secret_gate(
                directory,
                required_uid=os.getuid() + 1,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn("PASS", result.stdout + result.stderr)

    def test_host_secret_gate_rejects_fifo_without_blocking(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp) / "secrets"
            self.write_host_secrets(directory)
            target = directory / "query_password"
            target.unlink()
            os.mkfifo(target, mode=0o600)
            result = self.run_host_secret_gate(
                directory,
                required_uid=os.getuid(),
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn("PASS", result.stdout + result.stderr)

    def test_host_secret_gate_rejects_oversized_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp) / "secrets"
            self.write_host_secrets(directory)
            target = directory / "query_password"
            target.write_bytes(b"x" * 4097)
            target.chmod(0o600)
            result = self.run_host_secret_gate(
                directory,
                required_uid=os.getuid(),
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn("PASS", result.stdout + result.stderr)

    def test_host_secret_gate_rejects_broad_permissions_and_symlinks(self) -> None:
        for case in ("directory-mode", "file-mode", "symlink"):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as tmp:
                directory = Path(tmp) / "secrets"
                self.write_host_secrets(directory)
                if case == "directory-mode":
                    directory.chmod(0o755)
                elif case == "file-mode":
                    (directory / "query_password").chmod(0o644)
                else:
                    target = directory / "query_password"
                    target.unlink()
                    target.symlink_to(directory / "ingest_password")
                result = self.run_host_secret_gate(directory, required_uid=os.getuid())
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("PASS", result.stdout + result.stderr)

    def test_host_secret_gate_never_prints_values(self) -> None:
        canary = "SYNTHETIC_SECRET_MUST_NOT_BE_PRINTED"
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp) / "secrets"
            self.write_host_secrets(directory, canary=canary)
            (directory / "query_password").chmod(0o644)
            result = self.run_host_secret_gate(directory, required_uid=os.getuid())
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn(canary, result.stdout + result.stderr)

    def test_gate_accepts_exact_complete_project(self) -> None:
        result = self.run_gate([self.container(service) for service in SERVICES])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(
            "secret_environment_isolation=PASS services_checked=3 containers_checked=3",
            result.stdout,
        )

    def test_gate_rejects_incomplete_or_ambiguous_evidence(self) -> None:
        valid = [self.container(service) for service in SERVICES]
        cases = {
            "empty": [],
            "missing": valid[:-1],
            "duplicate": valid + [self.container("vmauth")],
            "unknown": valid + [self.container("unknown-service")],
            "mixed-project": [
                self.container("config-init"),
                self.container("victoria-logs", project="other-project"),
                self.container("vmauth"),
            ],
            "missing-project": [
                self.container("config-init"),
                self.container("victoria-logs", include_project=False),
                self.container("vmauth"),
            ],
            "missing-env": [
                self.container("config-init"),
                {
                    "Name": "/victoria-logs",
                    "Config": {
                        "Labels": {
                            "com.docker.compose.service": "victoria-logs",
                            "com.docker.compose.project": PROJECT,
                        }
                    },
                },
                self.container("vmauth"),
            ],
            "wrong-env-type": [
                self.container("config-init"),
                self.container("victoria-logs", environment="not-a-list"),
                self.container("vmauth"),
            ],
            "non-string-env": [
                self.container("config-init"),
                self.container("victoria-logs", environment=["PATH=/bin", 7]),
                self.container("vmauth"),
            ],
        }
        for case, containers in cases.items():
            with self.subTest(case=case):
                result = self.run_gate(containers)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("PASS", result.stdout + result.stderr)

    def test_gate_reports_names_only_and_never_values_or_container_names(self) -> None:
        value_canary = "SYNTHETIC_SECRET_MUST_NOT_BE_PRINTED"
        name_canary = "CANARY_SECRET_NAME_123456"
        containers = [self.container(service) for service in SERVICES]
        containers[2] = self.container(
            "vmauth",
            environment=[f"VMAUTH_QUERY_PASSWORD={value_canary}"],
            name=f"/{name_canary}",
        )
        result = self.run_gate(containers)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("VMAUTH_QUERY_PASSWORD", result.stderr)
        self.assertNotIn(value_canary, result.stdout + result.stderr)
        self.assertNotIn(name_canary, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
