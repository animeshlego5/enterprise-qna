"""
RAG system prompt template.

Extracted from pipeline/query.py to allow both the CLI entrypoint (pipeline/query.py)
and the HTTP endpoint (api/routes/query.py) to import from a single source of truth.

Prompt changes must happen here — not in both consumers.
"""

from langchain_core.prompts import ChatPromptTemplate

RAG_PROMPT = ChatPromptTemplate.from_messages([
    (
        "system",
        (
            "You are a precise enterprise AI assistant. "
            "Answer the user's question using ONLY the information in the context below. "
            "If the context does not contain enough information to fully answer the question, "
            "respond with exactly: "
            "'I do not have that information in the enterprise knowledge base.' "
            "Do not infer, extrapolate, guess, or draw on your training data. "
            "Your answer must be fully traceable to the provided context."
        ),
    ),
    (
        "human",
        "Context:\n{context}\n\nQuestion: {question}",
    ),
])