import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
const client = new OpenAI();

app.use(cors());
app.use(express.json());
app.use(express.static("."));

app.get("/", (req, res) => {
  res.sendFile(process.cwd() + "/index.html");
});

app.post("/chat", async (req, res) => {
  try {
    const userPrompt = req.body.prompt;

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: userPrompt
    });

    res.json({ reply: response.output_text });
  } catch (error) {
    console.error(error);
    res.status(500).json({ reply: "Error connecting to AI." });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
