import "dotenv/config";
import express from "express";
import OpenAI from "openai";
import { randomUUID } from "node:crypto";

const app = express();
app.use(express.json());// doesnt actually parses json , whenever FE-> network , it comes in streams of data , express.json reads in stream(bit/byte)
// accumulate , then parses into js
// express js code base on github
const client = new OpenAI({
  apiKey: process.env.OPEN_ROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
const SYSTEM_PROMPT = "You are a helpful assistant.";
const MAX_MESSAGES = 20;

// Memory: one history array per conversation, stored in RAM.
// Key = sessionId, value = array of { role, content }
const sessions = new Map();
// <session id , [conversation-> prmpts , system prompts , replies] >

// POST /chat   body: { "message": "hi", "sessionId": "optional" }
app.post("/chat", async (req, res) => {
  const { message } = req.body;
  let { sessionId } = req.body;

  if (typeof message !== "string" || message.trim() === "") {
    return res.status(400).json({ error: "message must be a non-empty string" });
  }

  // New conversation? Make an id and an empty history.
  if (!sessionId) sessionId = randomUUID();
  if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  const history = sessions.get(sessionId);

  history.push({ role: "user", content: message });

  try {
    const result = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history.slice(-MAX_MESSAGES),
      ],
    });

    const reply = result.choices[0].message.content;
    history.push({ role: "assistant", content: reply });

    res.json({ sessionId, reply, messagesStored: history.length });
  } catch (err) {
    history.pop(); // remove the unanswered user message
    console.error(err.status, err.message);
    if (err.status === 429) {
      return res.status(429).json({ error: "Free usage limit reached. Try again later." });
    }
    // 
    res.status(500).json({ error: "Something went wrong" });
  }
});

// GET /history/:sessionId   see what the server remembers
app.get("/history/:sessionId", (req, res) => {
  const history = sessions.get(req.params.sessionId);
  if (!history) return res.status(404).json({ error: "session not found" });
  res.json({ sessionId: req.params.sessionId, history });
});

// DELETE /history/:sessionId   make the server forget
app.delete("/history/:sessionId", (req, res) => {
  sessions.delete(req.params.sessionId);
  res.json({ ok: true });
});

app.listen(3000, () => console.log("Stage 2 server on http://localhost:3000"));
// https://chatgpt.com/c/6abb9c76-308c-83e8-a101-db19a83e688f