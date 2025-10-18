"""
Agents module for LLM-powered multi-agent orchestration.

This module contains the OpenAI Agent SDK implementation for the LINE Bot chatbot,
including agent definitions, tools, context management, and workflow orchestration.
"""

__version__ = "1.0.0"

# Lazy imports to avoid circular import issues
def __getattr__(name: str):
    # Import from the openai-agents package directly by bypassing sys.modules
    import importlib.util

    # Load the openai-agents package directly
    spec = importlib.util.find_spec('agents')
    if spec and spec.origin and 'site-packages' in spec.origin and spec.loader:
        # This is the real openai-agents package
        agents_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(agents_module)

        if hasattr(agents_module, name):
            return getattr(agents_module, name)

    # Handle special case for SQLAlchemySession which might not exist
    if name == "SQLAlchemySession":
        try:
            # Try to import it directly
            from agents.extensions.sqlalchemy_session import SQLAlchemySession
            return SQLAlchemySession
        except ImportError:
            return None

    raise AttributeError(f"module '{__name__}' has no attribute '{name}'")
