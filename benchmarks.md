Warmup completed:        YES 
Neon region selected:    AWS Asia Pacific 1 (Singapore)

## Latency Benchmark (Representative Query: Test 1)
Stage 1 — Embedding:          28.0ms
Stage 2 — Retrieval (Neon):   1484.0ms
Stage 4 — LLM generation:     2526ms
Total pipeline:               4039ms

## Validation

Test 1 — PASS  
Test 2 — PASS  
Test 3 — PASS (guardrail blocked LLM)  
Test 4 — PASS (no LLM call)  
Test 5 — PASS (similarity high)


(.venv) PS C:\Users\Animesh Gosain\Downloads\enterprise-qna> python -m pipeline.query "What benefits does the company provide to employees?"
Warning: You are sending unauthenticated requests to the HF Hub. Please set a HF_TOKEN to enable higher rate limits and faster downloads.
Loading weights: 100%|██████████████████████████████████████████████████████████████| 103/103 [00:00<00:00, 14579.77it/s]
BertModel LOAD REPORT from: sentence-transformers/all-MiniLM-L6-v2
Key                     | Status     |  |
------------------------+------------+--+-
embeddings.position_ids | UNEXPECTED |  |

Notes:
- UNEXPECTED:   can be ignored when loading from different task/architecture; not ok if you expect identical arch.        
[Timing] Stage 1 — Embedding:    28.2ms
[Timing] Stage 2 — Retrieval:    1520.9ms  (1 docs above threshold)

[Retrieved documents]
  [1] similarity=0.654  Employee benefits include health, dental, vision, a $2000 annual learning budget...

════════════════════════════════════════════════════════════════
Model:    gemini-2.5-flash
Question: What benefits does the company provide to employees?
════════════════════════════════════════════════════════════════
Answer: Employee benefits include health, dental, vision, a $2000 annual learning budget, and flexible PTO.

────────────────────────────────────────────────────────────────
[Timing] Stage 4 — LLM generation:  1430ms
[Timing] Total pipeline:             2980ms
────────────────────────────────────────────────────────────────


python -m pipeline.query "How does the on-call rotation work?"       
[Timing] Stage 1 — Embedding:    33.5ms
[Timing] Stage 2 — Retrieval:    1544.8ms  (1 docs above threshold)

[Retrieved documents]
  [1] similarity=0.651  The on-call rotation uses PagerDuty with a one-week rotation schedule among seni...

════════════════════════════════════════════════════════════════
Model:    gemini-2.5-flash
Question: How does the on-call rotation work?
════════════════════════════════════════════════════════════════
Answer: The on-call rotation uses PagerDuty with a one-week rotation schedule among senior engineers.

────────────────────────────────────────────────────────────────
[Timing] Stage 4 — LLM generation:  2667ms
[Timing] Total pipeline:             4246ms
────────────────────────────────────────────────────────────────


python -m pipeline.query "What was our Q3 revenue?"
[Timing] Stage 1 — Embedding:    24.4ms
[Timing] Stage 2 — Retrieval:    1650.8ms  (1 docs above threshold)

[Retrieved documents]
  [1] similarity=0.766  Our Q3 2024 revenue was $4.2M, up 18% year-over-year driven by enterprise tier g...

════════════════════════════════════════════════════════════════
Model:    gemini-2.5-flash
Question: What was our Q3 revenue?
════════════════════════════════════════════════════════════════
Answer: Our Q3 2024 revenue was $4.2M.

────────────────────────────────────────────────────────────────
[Timing] Stage 4 — LLM generation:  2073ms
[Timing] Total pipeline:             3753ms
────────────────────────────────────────────────────────────────

## Week 2 

Test 2 (Q3 revenue — full pipeline):

embed_ms: 191.4 ms

retrieve_ms: 2854.1 ms

generation_ms: 1992.4 ms

total_ms: 5122.6 ms

tokens_generated: 2

Test 3 (guardrail — no LLM call):

embed_ms: 13.8 ms

retrieve_ms: 1129.5 ms

total_ms: 1143.3 ms  (This is your retrieval-only baseline!)