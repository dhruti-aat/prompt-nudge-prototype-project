import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
const client = new OpenAI();
const MODEL = process.env.OPENAI_MODEL || "gpt-5.6-sol";

app.use(cors());
app.use(express.json({ limit: "32kb" }));
app.use(express.static("."));

app.get("/", (req, res) => {
  res.sendFile(process.cwd() + "/index.html");
});

app.post("/chat", async (req, res) => {
  try {
    const prompt = typeof req.body.prompt === "string" ? req.body.prompt.trim() : "";
    const previousResponseId =
      typeof req.body.previousResponseId === "string" && req.body.previousResponseId.trim()
        ? req.body.previousResponseId.trim()
        : undefined;
    const requestedTimeZone =
      typeof req.body.timeZone === "string" ? req.body.timeZone : "UTC";

    if (!prompt) {
      return res.status(400).json({ reply: "Please enter a prompt first." });
    }

    if (prompt.length > 10000) {
      return res.status(400).json({ reply: "Please keep the prompt under 10,000 characters." });
    }

    let timeZone = "UTC";
    try {
      Intl.DateTimeFormat("en-US", { timeZone: requestedTimeZone }).format();
      timeZone = requestedTimeZone;
    } catch {
      // Keep the safe UTC fallback for an invalid browser-supplied timezone.
    }

    const currentDateTime = new Intl.DateTimeFormat("en-US", {
      timeZone,
      dateStyle: "full",
      timeStyle: "long"
    }).format(new Date());

    const response = await client.responses.create({
      model: MODEL,
      instructions: [
        "You are a reliable, helpful AI assistant inside the Prompt Nudge prototype.",
        `The current date and time is ${currentDateTime} (${timeZone}).`,
        "Use this supplied date when interpreting relative dates such as today, tomorrow, or this year.",
        "Do not claim to have live information unless it was supplied in the conversation.",
        "If a question requires information newer than your knowledge, say that clearly instead of guessing."
      ].join("\n"),
      input: prompt,
      previous_response_id: previousResponseId,
      store: true
    });

    res.json({
      reply: response.output_text,
      responseId: response.id,
      model: MODEL
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ reply: "The AI could not respond right now. Please try again." });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
