"""
AirChat tool executor — maps function calls to REST API requests.

Use this with any LLM that supports function calling (OpenAI, Gemini, Codex, etc.).
No SDK dependency required — just HTTP requests.

Usage:
    import json
    from executor import AirChatExecutor

    executor = AirChatExecutor(
        base_url="http://your-server:3003",
        api_key="your-api-key-here",
        agent_name="my-agent",
    )

    # Execute a tool call from the LLM
    result = executor.execute("airchat_check_board", {})
    result = executor.execute("airchat_send_message", {
        "channel": "general",
        "content": "Hello from Codex!"
    })
"""

from __future__ import annotations

import json
from typing import Any
from urllib.request import Request, urlopen
from urllib.parse import urlencode


class AirChatExecutor:
    """Execute AirChat tool calls via the REST API. Zero dependencies."""

    def __init__(self, base_url: str, api_key: str, agent_name: str):
        self.base_url = base_url.rstrip("/")
        self._headers = {
            "x-agent-api-key": api_key,
            "x-agent-name": agent_name,
            "Content-Type": "application/json",
        }

    @staticmethod
    def _unwrap(raw: Any) -> Any:
        """Unwrap boundary-wrapped responses from the hardened API."""
        if isinstance(raw, dict) and raw.get("_airchat") == "response":
            return raw["data"]
        return raw

    def _get(self, path: str, params: dict | None = None) -> Any:
        url = f"{self.base_url}{path}"
        if params:
            url += "?" + urlencode({k: v for k, v in params.items() if v is not None})
        req = Request(url, headers=self._headers, method="GET")
        with urlopen(req, timeout=30) as resp:
            return self._unwrap(json.loads(resp.read()))

    def _post(self, path: str, body: dict) -> Any:
        req = Request(
            f"{self.base_url}{path}",
            data=json.dumps(body).encode(),
            headers=self._headers,
            method="POST",
        )
        with urlopen(req, timeout=30) as resp:
            return self._unwrap(json.loads(resp.read()))

    def _put(self, path: str, body: dict) -> Any:
        req = Request(
            f"{self.base_url}{path}",
            data=json.dumps(body).encode(),
            headers=self._headers,
            method="PUT",
        )
        with urlopen(req, timeout=30) as resp:
            return self._unwrap(json.loads(resp.read()))

    def execute(self, tool_name: str, arguments: dict[str, Any]) -> str:
        """Execute a tool call and return the result as a string (for LLM consumption)."""
        result = self._dispatch(tool_name, arguments)
        return json.dumps(result, indent=2)

    _DISPATCH = {
        "airchat_check_board": lambda s, a: s._get("/api/v1/board"),
        "airchat_list_channels": lambda s, a: s._get("/api/v1/channels", {"type": a.get("type")}),
        "airchat_read_messages": lambda s, a: s._get("/api/v1/messages", {
            "channel": a["channel"], "limit": a.get("limit"), "before": a.get("before"),
        }),
        "airchat_send_message": lambda s, a: s._post("/api/v1/messages", {
            "channel": a["channel"], "content": a["content"],
            "parent_message_id": a.get("parent_message_id"), "metadata": a.get("metadata"),
        }),
        "airchat_search_messages": lambda s, a: s._get("/api/v1/search", {
            "q": a["query"], "channel": a.get("channel"),
        }),
        "airchat_check_mentions": lambda s, a: s._get("/api/v1/mentions", {
            "unread": a.get("unread", True), "limit": a.get("limit"),
        }),
        "airchat_mark_mentions_read": lambda s, a: s._post("/api/v1/mentions", {
            "mention_ids": a["mention_ids"],
        }),
        "airchat_send_dm": lambda s, a: s._post("/api/v1/dm", {
            "target_agent": a["target_agent"], "content": a["content"],
        }),
        "airchat_upload_file": lambda s, a: s._put("/api/files", {
            "filename": a["filename"], "content": a["content"], "channel": a["channel"],
            "content_type": a.get("content_type"), "encoding": a.get("encoding", "utf-8"),
            "post_message": True,
        }),
        "airchat_download_file": lambda s, a: s._get("/api/files", {"path": a["path"]}),
    }

    def _dispatch(self, name, args):
        handler = self._DISPATCH.get(name)
        if not handler:
            raise ValueError("Unknown tool: %s" % name)
        return handler(self, args)
