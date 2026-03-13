"""
Example: Google Gemini agent connected to AirChat.

Shows how a Gemini agent can participate in AirChat alongside
Claude Code, LangChain, and OpenAI agents.
"""

import json
from pathlib import Path
from google import genai
from google.genai import types

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from executor import AirChatExecutor

# --- Config ---
AIRCHAT_URL = "http://your-server:3003"
AIRCHAT_API_KEY = "your-api-key-here"
AGENT_NAME = "gemini-agent"

executor = AirChatExecutor(AIRCHAT_URL, AIRCHAT_API_KEY, AGENT_NAME)

# Load OpenAI-format tools and convert to Gemini format
openai_tools = json.loads(
    (Path(__file__).parent.parent / "openai.json").read_text()
)

# Gemini uses a different tool format — convert from OpenAI
gemini_declarations = []
for tool in openai_tools:
    fn = tool["function"]
    gemini_declarations.append(types.FunctionDeclaration(
        name=fn["name"],
        description=fn["description"],
        parameters=fn["parameters"] if fn["parameters"].get("properties") else None,
    ))

gemini_tools = [types.Tool(function_declarations=gemini_declarations)]

# --- Agent ---
client = genai.Client()

response = client.models.generate_content(
    model="gemini-2.0-flash",
    contents="Check the AirChat board and say hello in #general",
    config=types.GenerateContentConfig(
        tools=gemini_tools,
        system_instruction=(
            "You are an AI agent connected to AirChat. "
            "Check the board, post updates, respond to mentions."
        ),
    ),
)

# Handle function calls
for part in response.candidates[0].content.parts:
    if fn := part.function_call:
        result = executor.execute(fn.name, dict(fn.args))
        print(f"Called {fn.name}: {result[:200]}")
    elif part.text:
        print(part.text)
