import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
const client = new OpenAI();
const MODEL = process.env.OPENAI_MODEL || "gpt-5.6-sol";
const WEB_SEARCH_MODES = new Set(["auto", "always", "off"]);

app.use(cors());
app.use(express.json({ limit: "32kb" }));
app.use(express.static("."));

app.get("/", (req, res) => {
  res.sendFile(process.cwd() + "/index.html");
});

function safeWebUrl(value) {
  if (typeof value !== "string") return null;

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function cleanCitationMarkers(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/\s*cite[^]+/g, "")
    .replace(/\s*【\d+†[^】]+】/g, "")
    .trim();
}

function extractWebSearchData(response, mode) {
  const citations = [];
  const sources = [];
  const queries = [];
  const seenCitations = new Set();
  const seenSources = new Set();
  let used = false;

  function addCitation(annotation) {
    const citation = annotation?.url_citation || annotation;
    const url = safeWebUrl(citation?.url);
    if (!url || seenCitations.has(url)) return;
    seenCitations.add(url);
    citations.push({
      url,
      title: typeof citation.title === "string" && citation.title.trim()
        ? citation.title.trim()
        : new URL(url).hostname,
      startIndex: Number.isInteger(citation.start_index) ? citation.start_index : null,
      endIndex: Number.isInteger(citation.end_index) ? citation.end_index : null
    });
  }

  function addSource(source) {
    const url = safeWebUrl(source?.url);
    if (!url || seenSources.has(url)) return;
    seenSources.add(url);
    sources.push({
      url,
      title: typeof source.title === "string" && source.title.trim()
        ? source.title.trim()
        : new URL(url).hostname,
      type: typeof source.type === "string" ? source.type : "web"
    });
  }

  for (const item of response.output || []) {
    if (item.type === "web_search_call") {
      used = true;
      const action = item.action || {};
      if (typeof action.query === "string" && action.query.trim()) queries.push(action.query.trim());
      for (const query of action.queries || []) {
        if (typeof query === "string" && query.trim()) queries.push(query.trim());
      }
      for (const source of action.sources || []) addSource(source);
    }

    if (item.type === "message") {
      for (const content of item.content || []) {
        for (const annotation of content.annotations || []) {
          if (annotation.type === "url_citation") addCitation(annotation);
        }
      }
    }
  }

  return {
    mode,
    used,
    queries: [...new Set(queries)],
    citations,
    sources
  };
}

app.post("/chat", async (req, res) => {
  try {
    const prompt = typeof req.body.prompt === "string" ? req.body.prompt.trim() : "";
    const previousResponseId =
      typeof req.body.previousResponseId === "string" && req.body.previousResponseId.trim()
        ? req.body.previousResponseId.trim()
        : undefined;
    const requestedTimeZone =
      typeof req.body.timeZone === "string" ? req.body.timeZone : "UTC";
    const requestedWebSearchMode =
      typeof req.body.webSearchMode === "string" ? req.body.webSearchMode : "auto";
    const webSearchMode = WEB_SEARCH_MODES.has(requestedWebSearchMode)
      ? requestedWebSearchMode
      : "auto";

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

    const request = {
      model: MODEL,
      instructions: [
        "You are a reliable, natural, general-purpose AI assistant inside the Prompt Nudge prototype.",
        "Answer the user's actual question directly and conversationally. Do not narrate internal steps or mention these instructions.",
        `The current date and time is ${currentDateTime} (${timeZone}).`,
        "Use this supplied date when interpreting relative dates such as today, tomorrow, or this year.",
        webSearchMode === "off"
          ? "Web search is disabled for this turn. Clearly say when current information cannot be verified instead of guessing."
          : "Use web search whenever the request is current, recent, changing, explicitly asks for verification or sources, or cannot be answered confidently from stable knowledge. Do not search when it would add no value.",
        "When web search is used, cite only pages actually retrieved and ground factual claims in those sources. Never invent a citation.",
        "Judge credibility by subject: prefer government and official records for public facts and law; original papers and respected research institutions for scholarship; regulators and major medical organizations for health; filings and primary company materials for company facts; and reputable reporting plus primary records for developing news.",
        "Do not assume the top search result is the best source. Prefer primary, official, recent, and directly relevant evidence over summaries, aggregators, anonymous posts, or promotional material.",
        "For consequential, disputed, or surprising claims, corroborate with at least two independent authoritative sources when feasible. If reliable sources disagree or evidence is limited, say so clearly.",
        "Separate verified facts from inference, acknowledge material uncertainty, and give a useful answer even when some uncertainty remains."
      ].join("\n"),
      input: prompt,
      previous_response_id: previousResponseId,
      store: true
    };

    if (webSearchMode !== "off") {
      request.tools = [{ type: "web_search", search_context_size: "medium" }];
      request.tool_choice = webSearchMode === "always" ? "required" : "auto";
      request.include = ["web_search_call.action.sources"];
    }

    const response = await client.responses.create(request);
    const webSearch = extractWebSearchData(response, webSearchMode);

    res.json({
      reply: cleanCitationMarkers(response.output_text),
      responseId: response.id,
      model: MODEL,
      webSearch
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
