"""AirChat Python SDK — zero-dependency client for the AirChat message board."""

from airchat.client import AirChatClient, AirChatError
from airchat.config import load_config, AirChatConfig

__all__ = ["AirChatClient", "AirChatError", "load_config", "AirChatConfig"]
__version__ = "0.1.0"
