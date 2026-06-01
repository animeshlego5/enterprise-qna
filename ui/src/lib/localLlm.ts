// Browser-side LLM streaming for local mode.
// Supports OpenAI-compatible APIs, Google Gemini, and Anthropic.
// The API key is provided by the user and never leaves their browser.

import type { LlmProvider } from "./appMode";

const SYSTEM_PROMPT =
  "You are a helpful assistant. Answer the question using ONLY the provided context. " +
  "Do not use outside knowledge. If the context does not contain the answer, say so.";

function buildUserMessage(context: string, question: string): string {
  return `Context:\n${context}\n\nQuestion: ${question}`;
}

// ── SSE line parser shared by all providers ───────────────────────────────────
async function* readSSELines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) yield line;
  }
  if (buf) yield buf;
}

// ── OpenAI ────────────────────────────────────────────────────────────────────
async function* streamOpenAI(
  apiKey: string,
  model: string,
  context: string,
  question: string
): AsyncGenerator<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(context, question) },
      ],
    }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error?.message ?? `OpenAI error ${res.status}`);
  }
  for await (const line of readSSELines(res.body!)) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6);
    if (data === "[DONE]") return;
    try {
      const token = JSON.parse(data).choices?.[0]?.delta?.content;
      if (token) yield token;
    } catch {}
  }
}

// ── Google Gemini ─────────────────────────────────────────────────────────────
async function* streamGemini(
  apiKey: string,
  model: string,
  context: string,
  question: string
): AsyncGenerator<string> {
  const prompt = `${SYSTEM_PROMPT}\n\n${buildUserMessage(context, question)}`;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1 },
      }),
    }
  );
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error?.message ?? `Gemini error ${res.status}`);
  }
  for await (const line of readSSELines(res.body!)) {
    if (!line.startsWith("data: ")) continue;
    try {
      const token =
        JSON.parse(line.slice(6)).candidates?.[0]?.content?.parts?.[0]?.text;
      if (token) yield token;
    } catch {}
  }
}

// ── Anthropic Claude ──────────────────────────────────────────────────────────
async function* streamAnthropic(
  apiKey: string,
  model: string,
  context: string,
  question: string
): AsyncGenerator<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      // Required header for direct browser access
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      stream: true,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserMessage(context, question) }],
    }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error?.message ?? `Anthropic error ${res.status}`);
  }
  for await (const line of readSSELines(res.body!)) {
    if (!line.startsWith("data: ")) continue;
    try {
      const parsed = JSON.parse(line.slice(6));
      if (parsed.type === "content_block_delta") {
        const token = parsed.delta?.text;
        if (token) yield token;
      }
    } catch {}
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
export async function* streamLocalLlm(
  provider: LlmProvider,
  apiKey: string,
  model: string,
  context: string,
  question: string
): AsyncGenerator<string> {
  switch (provider) {
    case "openai":
      yield* streamOpenAI(apiKey, model, context, question);
      break;
    case "gemini":
      yield* streamGemini(apiKey, model, context, question);
      break;
    case "anthropic":
      yield* streamAnthropic(apiKey, model, context, question);
      break;
  }
}
