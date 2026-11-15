// Demo Mode answer bank — used ONLY when no Groq key is set.
// Keyword-matched, local, no network. Real answers come from Groq when a key is added.
window.DEMO_BANK = [
  { keys: ['two sum', 'array', 'hash map'], short: 'Use a hash map: one pass, store value → index, check complement target − num.', detailed: 'Approach: iterate once, for each num check if (target − num) is in the map. If yes, return both indices. Else store num → index. Time O(n), space O(n). Mention the brute-force O(n²) first, then optimise — interviewers like hearing the trade-off.' },
  { keys: ['tell me about yourself', 'introduce yourself'], short: 'Present → past → future: who you are now, 1–2 relevant projects, why this role.', detailed: '“I’m Gautam, final-year B.Sc. Data Science & AI at IIT Guwahati. I build production GenAI systems — IncidentPilot and RegLens, both live with measured evals. I’m looking for a GenAI Engineer intern role where I can ship RAG and agent systems, which is why this role fits.” Keep it under 90 seconds.' },
  { keys: ['rag', 'retrieval'], short: 'RAG = retrieve relevant chunks, then generate with them as context — grounds the LLM and cuts hallucinations.', detailed: 'Pipeline: chunk documents → embed (e.g. Sentence Transformers) → store in a vector DB (FAISS / Pinecone) → retrieve top-k by similarity → pass chunks + question to the LLM → answer with citations. Add re-ranking, evals (recall@k, faithfulness), and an abstention rule when nothing relevant is retrieved — that is what RegLens does (recall@5 0.897, faithfulness 0.974).' },
  { keys: ['langchain', 'langgraph'], short: 'LangChain = chains/tools for LLM apps; LangGraph = stateful, graph-based agents with cycles and memory.', detailed: 'LangChain gives LCEL chains, prompts, retrievers and tool calling. LangGraph models the agent as a graph of nodes/edges with persistent state — better for multi-step agents, human-in-the-loop, and retries. Mention a real project: a research assistant agent with planner → retriever → summariser nodes.' },
  { keys: ['system design', 'design a', 'architecture'], short: 'Clarify requirements → estimate scale → high-level design → deep-dive one component → trade-offs.', detailed: 'Start: functional + non-functional requirements, then back-of-envelope numbers (QPS, storage). Draw: client → load balancer → API servers → cache → DB → queue/workers. Then deep-dive (e.g. sharding, caching, consistency) and end with bottlenecks and trade-offs. Flowchart: [Client] → [LB] → [API] → [Cache + DB] → [Queue] → [Workers].' },
  { keys: ['why should we hire', 'why you'], short: 'Match 2–3 of their needs to your proven work, then show hunger to learn.', detailed: 'Pick the exact skills in the job description, map each to a shipped project with a number, and close with what you will do in the first 30 days. Avoid generic claims — give evidence.' },
  { keys: ['strength', 'weakness'], short: 'Strength with proof; weakness that is real, improving, and not core to the role.', detailed: 'Strength: e.g. “I ship end-to-end — my RAG projects are live with evals, not just notebooks.” Weakness: e.g. “I used to over-engineer; now I time-box a working version first, then harden it — that is how QueryPilot got its 50-case eval.”' },
  { keys: ['sql', 'join'], short: 'JOIN combines rows from two tables on a matching key; INNER returns matches only, LEFT keeps all left rows.', detailed: 'INNER JOIN: only matching rows. LEFT JOIN: all left rows + NULLs where no match. Use LEFT when you must not drop rows (e.g. users with no orders). Mention indexes on join keys and EXPLAIN for slow queries.' },
  { keys: ['python', 'list comprehension', 'decorator'], short: 'Python: readable, batteries-included; use list comprehensions for transforms, decorators to wrap functions.', detailed: 'Example: squares = [x*x for x in nums if x % 2 == 0]. A decorator is a function returning a wrapper — used for logging, auth, caching. Mention GIL for threading limits and asyncio for I/O-bound work.' },
  { keys: ['machine learning', 'overfitting', 'bias variance'], short: 'Overfitting = memorising training data; fix with more data, regularisation, cross-validation, simpler model.', detailed: 'High variance → overfit: use L1/L2, dropout, early stopping, k-fold CV. High bias → underfit: add features or a bigger model. Always split train/val/test and report the val metric.' },
  { keys: ['fastapi'], short: 'FastAPI = modern async Python API framework, Pydantic validation, auto OpenAPI docs.', detailed: 'Highlights: async endpoints, Pydantic models for request/response validation, dependency injection, auto /docs. Mention a real API you shipped and how you handled auth (JWT) and errors.' },
  { keys: ['where do you see yourself', 'five years'], short: 'Grow deep in GenAI engineering, own production systems, then mentor others.', detailed: '“In 5 years I want to be a strong GenAI engineer owning production RAG/agent systems end-to-end, and mentoring juniors — I’m building that foundation now with live, evaluated projects.”' },
];

window.demoAnswer = function demoAnswer(question) {
  const q = (question || '').toLowerCase();
  for (const item of window.DEMO_BANK) {
    if (item.keys.some((k) => q.includes(k))) return { short: item.short, detailed: item.detailed, source: 'Demo Mode — local bank' };
  }
  return {
    short: 'Structure it: clarify, outline 2–3 points, give one concrete example, then conclude.',
    detailed: 'Demo Mode has no matching canned answer for this question. Structure: 1) restate the question briefly, 2) give 2–3 clear points, 3) back one point with a real project example and a number, 4) close in one line. Add a Groq key in Settings for a real, tailored answer using your resume and job description.',
    source: 'Demo Mode — generic structure',
  };
};

window.isQuestion = function isQuestion(text) {
  const t = (text || '').trim();
  if (!t) return false;
  if (t.endsWith('?')) return true;
  return /^(what|why|how|when|where|who|which|can you|could you|tell me|explain|describe|do you|have you|is it|are you|would you)\b/i.test(t) && t.split(/\s+/).length >= 4;
};
