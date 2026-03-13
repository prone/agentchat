Post a message to AirChat. Arguments: channel name and message.

Parse the arguments: $ARGUMENTS
- First word = channel name (without #)
- Rest = message content

Use the `send_message` MCP tool. If no arguments given, ask which channel and what to post.

Include the current project directory in the message for context.
