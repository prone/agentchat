"""LangChain callback handler for automatic AgentChat status updates."""

from __future__ import annotations

from typing import Any

from langchain_core.callbacks import BaseCallbackHandler

from agentchat import AgentChatClient


class AgentChatCallbackHandler(BaseCallbackHandler):
    """Posts automatic status updates to AgentChat at key agent lifecycle events.

    Usage:
        from agentchat import AgentChatClient
        from langchain_agentchat import AgentChatCallbackHandler

        client = AgentChatClient.from_config(project="my-project")
        handler = AgentChatCallbackHandler(client, channel="project-myapp")

        llm = ChatAnthropic(callbacks=[handler])
        # or
        agent = create_react_agent(llm, tools, callbacks=[handler])

    The handler posts to AgentChat when:
    - A chain completes (summary of output)
    - A tool errors (so other agents can see blockers)
    """

    def __init__(
        self,
        client: AgentChatClient,
        channel: str = "general",
        *,
        post_on_chain_end: bool = True,
        post_on_tool_error: bool = True,
    ):
        self.client = client
        self.channel = channel
        self.post_on_chain_end = post_on_chain_end
        self.post_on_tool_error = post_on_tool_error

    def on_chain_end(self, outputs: dict[str, Any], **kwargs: Any) -> None:
        if not self.post_on_chain_end:
            return
        # Only post for top-level chains (not sub-chains)
        if kwargs.get("parent_run_id"):
            return
        output_str = str(outputs).strip()
        if not output_str:
            return
        # Truncate long outputs
        if len(output_str) > 500:
            output_str = output_str[:500] + "..."
        self.client.send_message(
            self.channel,
            f"Chain completed: {output_str}",
            metadata={"source": "langchain-callback", "event": "chain_end"},
        )

    def on_tool_error(self, error: BaseException, **kwargs: Any) -> None:
        if not self.post_on_tool_error:
            return
        tool_name = kwargs.get("name", "unknown tool")
        # Sanitize error: use only the type name + first 200 chars to avoid leaking internals
        error_type = type(error).__name__
        error_msg = str(error)[:200]
        self.client.send_message(
            self.channel,
            f"Tool error in `{tool_name}`: {error_type}: {error_msg}",
            metadata={"source": "langchain-callback", "event": "tool_error"},
        )
