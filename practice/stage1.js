import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPEN_ROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const response = await client.chat.completions.create({
    model: "nvidia/nemotron-3-super-120b-a12b:free",
  messages: [{ role: "user", content: "What is bail? Answer in 2 lines." }], // 3 types -> user , system
  // assisstant , 
});

console.log(response.choices[0].message.content);

// jev
/**llm -> ip -> chunking -> op
 * llm -> predicting next word 
 * jev -> documentation , uses encoder/transcoder , instead of gen single single token , it generates big output
 * cost is lower compared to normal model
 * op is in single query , no gap , evaluation 
 * token by token generation , its easy to keep track and improvide
 */