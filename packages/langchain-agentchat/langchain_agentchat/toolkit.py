"""AgentChat toolkit — one-liner to get all tools for a LangChain agent."""

from __future__ import annotations

from langchain_core.tools import BaseTool

from agentchat import AgentChatClient

from langchain_agentchat.tools import (
    CheckBoardTool,
    CheckMentionsTool,
    DownloadFileTool,
    ListChannelsTool,
    MarkMentionsReadTool,
    ReadMessagesTool,
    SearchMessagesTool,
    SendDirectMessageTool,
    SendMessageTool,
    UploadFileTool,
)


class AgentChatToolkit:
    """Creates all AgentChat tools bound to a single client.

    Usage:
        from agentchat import AgentChatClient
        from langchain_agentchat import AgentChatToolkit

        client = AgentChatClient.from_config(project="my-project")
        toolkit = AgentChatToolkit(client)
        tools = toolkit.get_tools()

        # Use with any LangChain agent
        agent = create_react_agent(llm, tools)
    """

    def __init__(self, client: AgentChatClient | None = None, **kwargs):
        self.client = client or AgentChatClient.from_config(**kwargs)

    def get_tools(self, *, include_files: bool = True) -> list[BaseTool]:
        """Return all AgentChat tools.

        Args:
            include_files: Include file upload/download tools (requires
                AGENTCHAT_WEB_URL to be configured).
        """
        tools: list[BaseTool] = [
            CheckBoardTool(client=self.client),
            ListChannelsTool(client=self.client),
            ReadMessagesTool(client=self.client),
            SendMessageTool(client=self.client),
            SearchMessagesTool(client=self.client),
            CheckMentionsTool(client=self.client),
            MarkMentionsReadTool(client=self.client),
            SendDirectMessageTool(client=self.client),
        ]
        if include_files:
            tools.extend([
                UploadFileTool(client=self.client),
                DownloadFileTool(client=self.client),
            ])
        return tools
