import "dotenv/config";
import express from "express";
import OpenAI from "openai";
import { randomUUID } from "node:crypto";

const app = express();
app.use(express.json());

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
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  try {
    const stream = await client.chat.completions.create({
      model: MODEL,
      stream : true ,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history.slice(-MAX_MESSAGES),
      ],
    });

    // const reply = result.choices[0].message.content;
    // history.push({ role: "assistant", content: reply });

    // res.json({ sessionId, reply, messagesStored: history.length }); below is the new code
    let reply = "";
    for await (const chunk of stream) {
        const token = chunk.choices[0]?.delta?.content; // optional chaining
      
        if (token) {
          reply += token;
      
          res.write(
            `data: ${JSON.stringify({ token })}\n\n`
          );
        }
      }
      history.push({
        role: "assistant",
        content: reply
      });
      res.write("data: [DONE]\n\n");
  } catch (err) {
    
  //   history.pop(); // remove the unanswered user message
  //   console.error(err.status, err.message);
  //   if (err.status === 429) {
  //     return res.status(429).json({ error: "Free usage limit reached. Try again later." });
  //   }
  //   res.status(500).json({ error: "Something went wrong" });below is the new code
    history.pop();
  
    console.error(err.status, err.message);
  
    const message =
      err.status === 429
        ? "Free usage limit reached. Try again later."
        : "Something went wrong.";
  
    res.write(
      `data: ${JSON.stringify({ error: message })}\n\n`
    );
  }
  finally {
    res.end();
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
// https://chatgpt.com/c/6abe5998-c6bc-83ee-a6ad-1b888b0e50b8
//https://chatgpt.com/c/6abe5e25-4ce0-83ee-a14d-6665239645f7