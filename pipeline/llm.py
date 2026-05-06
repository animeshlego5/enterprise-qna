"""
Gemini 2.5 Flash provider module.

Two streaming modes:
  streaming=True  → callback-based (StreamingStdOutCallbackHandler)
                    Used by pipeline/query.py CLI entrypoint.
                    llm.invoke(messages) writes tokens to stdout.

  streaming=False → iterator-based (no callbacks)
                    Used by api/routes/query.py SSE endpoint.
                    async for chunk in llm.astream(messages) yields AIMessageChunk.
                    Each chunk.content is a token string.

The distinction matters because FastAPI's SSE generator is an async generator
function. You cannot use a callback inside an async generator — callbacks are
fire-and-forget side effects with no awaitable surface. The astream() iterator
gives you awaitable token chunks that slot naturally into `async for` loops
and `yield` statements inside async generator functions.
"""

from __future__ import annotations

import os

import structlog
from langchain_core.callbacks.streaming_stdout import StreamingStdOutCallbackHandler
from langchain_core.language_models import BaseLanguageModel
from langchain_google_genai import ChatGoogleGenerativeAI
from dotenv import load_dotenv

load_dotenv()

log = structlog.get_logger(__name__)


def get_llm(streaming: bool = False) -> BaseLanguageModel:
    """
    Return a configured ChatGoogleGenerativeAI instance.

    Note the default is now streaming=False — the SSE route is the primary
    consumer and uses astream(), not invoke() with a callback.
    The CLI (pipeline/query.py) passes streaming=True explicitly.

    Args:
        streaming: When True, attaches StreamingStdOutCallbackHandler for
                   terminal output. When False, returns a clean model
                   instance for use with astream() in async generators.

    Returns:
        Configured BaseLanguageModel ready to invoke or astream.

    Raises:
        EnvironmentError: If GOOGLE_API_KEY is not set.
    """
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise EnvironmentError(
            "GOOGLE_API_KEY is not set. "
            "Add GOOGLE_API_KEY=your_key to your .env file. "
            "Create a key at https://aistudio.google.com/app/apikey"
        )

    model_name = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    temperature = float(os.getenv("LLM_TEMPERATURE", "0.1"))

    callbacks = [StreamingStdOutCallbackHandler()] if streaming else []

    log.debug(
        "llm_initialized",
        model=model_name,
        temperature=temperature,
        streaming=streaming,
    )

    return ChatGoogleGenerativeAI(
        model=model_name,
        google_api_key=api_key,
        temperature=temperature,
        streaming=streaming,
        callbacks=callbacks,
        convert_system_message_to_human=False,
    )