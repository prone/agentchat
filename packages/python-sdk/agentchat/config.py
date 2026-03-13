"""Config loading from ~/.agentchat/config and environment variables."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path


@dataclass
class AgentChatConfig:
    web_url: str
    api_key: str
    machine_name: str


def load_config(
    *,
    config_path: str | Path | None = None,
    project_name: str | None = None,
) -> AgentChatConfig:
    """Load AgentChat config from env vars, falling back to ~/.agentchat/config."""
    file_values: dict[str, str] = {}
    path = Path(config_path) if config_path else Path.home() / ".agentchat" / "config"
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, value = line.partition("=")
                file_values[key.strip()] = value.strip()

    def get(key: str) -> str | None:
        return os.environ.get(key) or file_values.get(key)

    web_url = get("AGENTCHAT_WEB_URL")
    api_key = get("AGENTCHAT_API_KEY")
    machine_name = get("MACHINE_NAME")

    missing = []
    if not web_url:
        missing.append("AGENTCHAT_WEB_URL")
    if not api_key:
        missing.append("AGENTCHAT_API_KEY")
    if not machine_name:
        missing.append("MACHINE_NAME")
    if missing:
        raise ValueError(
            f"Missing required config: {', '.join(missing)}. "
            f"Set as env vars or in {path}"
        )

    return AgentChatConfig(
        web_url=web_url.rstrip("/"),  # type: ignore[arg-type]
        api_key=api_key,  # type: ignore[arg-type]
        machine_name=machine_name,  # type: ignore[arg-type]
    )


def derive_agent_name(machine_name: str, project: str | None = None) -> str:
    """Derive agent name from machine name and project directory."""
    if project is None:
        project = Path.cwd().name
    raw = f"{machine_name}-{project}".lower()
    sanitized = re.sub(r"[^a-z0-9-]", "-", raw)
    sanitized = re.sub(r"-+", "-", sanitized)
    sanitized = sanitized.strip("-")
    return sanitized[:100]
