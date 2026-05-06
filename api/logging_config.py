"""
structlog configuration for the Enterprise QnA API.

Two-part stdlib integration:
  Part 1: structlog.stdlib.LoggerFactory() as the logger factory.
          Ensures structlog.get_logger(__name__) returns a logger backed
          by a stdlib Logger with a .name attribute.
          Required for structlog.stdlib.add_logger_name to work correctly.

  Part 2: structlog.stdlib.ProcessorFormatter attached to stdlib's root handler.
          Routes uvicorn, asyncpg, and other library log output through the
          same structlog processor chain, producing consistent format.

Output modes (controlled by LOG_FORMAT in .env):
  "console" — human-readable colored output for local development.
  "json"    — newline-delimited JSON for Grafana Loki / Datadog / CloudWatch.
"""

from __future__ import annotations

import logging
import os
import sys

import structlog


def configure_logging() -> None:
    """
    Configure structlog with stdlib integration.

    Must be called exactly once, at process startup, before any logger is
    acquired. Call site: the very first line of api/main.py, before the
    module-level `log = structlog.get_logger(__name__)` call.

    Calling it after the first get_logger() call means that logger was
    constructed with the default (unconfigured) factory and will not have
    a valid .name attribute — the bug this function exists to prevent.
    """
    log_format = os.getenv("LOG_FORMAT", "console").lower()
    log_level_str = os.getenv("LOG_LEVEL", "INFO").upper()
    log_level = getattr(logging, log_level_str, logging.INFO)

    # ── Part 1: Processors shared by both structlog and stdlib paths ──────────
    # These run on every log event before the final renderer.
    shared_processors: list = [
        # Merges any fields bound via structlog.contextvars.bind_contextvars()
        # into the log event. This is how request_id propagates to all log
        # calls within a request coroutine without being passed as a parameter.
        structlog.contextvars.merge_contextvars,
        # Adds the "level" key (e.g., "info", "warning", "error").
        structlog.stdlib.add_log_level,
        # Adds the "logger" key from the underlying stdlib Logger's .name
        # attribute. Works correctly because we use LoggerFactory() below,
        # which backs each structlog logger with a stdlib Logger.
        structlog.stdlib.add_logger_name,
        # Adds an ISO 8601 "timestamp" key.
        structlog.processors.TimeStamper(fmt="iso"),
        # Renders stack trace information if present.
        structlog.processors.StackInfoRenderer(),
        # Formats exc_info tuples into readable tracebacks.
        structlog.processors.format_exc_info,
    ]

    # ── Part 2: Attach ProcessorFormatter to stdlib's root logger ─────────────
    # This routes log records from uvicorn, asyncpg, and other libraries that
    # use stdlib logging through the same shared_processors chain.
    # Without this, uvicorn's access log and asyncpg warnings use stdlib's
    # default formatter and look completely different from structlog output.
    if log_format == "json":
        # Production renderer: one JSON object per line.
        final_renderer = structlog.processors.JSONRenderer()
    else:
        # Development renderer: colored, human-readable console output.
        final_renderer = structlog.dev.ConsoleRenderer(colors=True)

    # ProcessorFormatter is a stdlib logging.Formatter subclass.
    # It applies shared_processors + final_renderer to every stdlib log record.
    formatter = structlog.stdlib.ProcessorFormatter(
        # foreign_pre_chain: processors applied to log records that did NOT
        # originate from structlog (i.e., records from uvicorn, asyncpg, etc.)
        foreign_pre_chain=shared_processors,
        # processors: the complete chain for ALL records (structlog + foreign).
        processors=[
            # Extracts structlog-specific keys from the stdlib LogRecord.
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            final_renderer,
        ],
    )

    # Replace the root logger's handlers with one StreamHandler using our formatter.
    # basicConfig() is not used here because it only takes effect if no handlers
    # are configured yet — in some environments it is a no-op.
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.addHandler(handler)
    root_logger.setLevel(log_level)

    # Suppress uvicorn's duplicate access log (it has its own handler by default;
    # we are already capturing it via the root logger above).
    logging.getLogger("uvicorn.access").propagate = True

    # ── structlog core configuration ──────────────────────────────────────────
    structlog.configure(
        processors=shared_processors + [
            # Prepares the event for the ProcessorFormatter when structlog
            # is bridged to stdlib. This processor must be last in the
            # structlog chain when using stdlib integration.
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        # LoggerFactory: structlog.get_logger(__name__) creates a structlog
        # logger backed by logging.getLogger(__name__) — a stdlib Logger with
        # a real .name attribute equal to __name__.
        # This is what makes structlog.stdlib.add_logger_name work correctly.
        logger_factory=structlog.stdlib.LoggerFactory(),
        # make_filtering_bound_logger: creates a fast bound logger class with
        # level-filtering methods (log.info, log.debug, etc.) baked in.
        # More performant than the default BoundLogger for high-frequency logging.
        wrapper_class=structlog.make_filtering_bound_logger(log_level),
        cache_logger_on_first_use=True,
    )