
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const COUNT = Math.max(1, Math.min(30,
  Number(process.env.DAILY_ARTICLE_COUNT) || 5
));

const FILE = path.resolve("content/articles.json");

const CATEGORIES = [
  "ספורט",
  "מדע וחלל",
  "היסטוריה",
  "פסיכולוגיה",
  "פילוסופיה",
  "טבע ובעלי חיים",
  "טכנולוגיה",
  "תרבות ואמנות",
  "גוף האדם",
  "תעלומות"
];

async function main() {
  if (!API_KEY) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

  const database = JSON.parse(
    await fs.readFile(FILE, "utf8")
  );

  const existing = Array.isArray(database.articles)
    ? database.articles
    : [];

  if (database.updatedAt === today &&
      !process.env.FORCE_GENERATE) {
    console.log("Today's content already exists.");
    return;
  }

  const previousTitles = existing
    .slice(-200)
    .map(article => article.title);

  const prompt = `
You are the editor of DID YOU KNOW?,
a Hebrew educational discovery app.

Generate exactly ${COUNT} original articles
in natural, engaging Hebrew.

Categories:
${CATEGORIES.join(", ")}

Avoid repeating previous topics:
${JSON.stringify(previousTitles)}

Every article must include:
- category: one of the listed categories
- title: an intriguing Hebrew headline
- teaser: 1-2 interesting sentences
- body: 3-5 substantial paragraphs
- fact: an additional interesting fact
- image: a relevant HTTPS photograph URL
- sources: 1-3 relevant HTTPS source URLs
- quiz: a question with three possible answers

Never invent facts, studies, or sources.
Avoid exaggerated claims.
If an image or source is unknown, do not invent it.

Return only valid JSON in this format:

{
  "articles": [
    {
      "category": "",
      "title": "",
      "teaser": "",
      "body": [],
      "fact": "",
      "image": "",
      "sources": [],
      "quiz": {
        "q": "",
        "a": [],
        "correct": 0
      }
    }
  ]
}
`;

  console.log("Generating articles:", COUNT);
  console.log("Using model:", MODEL);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": API_KEY
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.8,
          responseMimeType: "application/json"
        }
      }),
      signal: AbortSignal.timeout(180000)
    }
  );

  if (!response.ok) {
    throw new Error(
      `Gemini API error: ${response.status} ${await response.text()}`
    );
  }

  const result = await response.json();

  const output = result.candidates?.[0]?.content?.parts
    ?.filter(part => !part.thought)
    .map(part => part.text || "")
    .join("");

  if (!output) {
    throw new Error("Gemini returned no content");
  }

  const parsed = JSON.parse(output);

  if (!Array.isArray(parsed.articles)) {
    throw new Error("Invalid articles response");
  }

  const normalizeTitle = title =>
    String(title || "").trim().toLowerCase();

  const knownTitles = new Set(
    existing.map(article => normalizeTitle(article.title))
  );

  const knownIds = new Set(
    existing.map(article => article.id)
  );

  const accepted = [];

  const isHttps = value =>
    typeof value === "string" &&
    /^https:\/\/\S+$/i.test(value);

  for (const article of parsed.articles) {
    if (!article || !CATEGORIES.includes(article.category)) {
      continue;
    }

    if (
      typeof article.title !== "string" ||
      article.title.trim().length < 12 ||
      typeof article.teaser !== "string" ||
      !article.teaser.trim() ||
      !Array.isArray(article.body) ||
      article.body.length < 3 ||
      !article.body.every(p =>
        typeof p === "string" && p.trim().length >= 70
      ) ||
      typeof article.fact !== "string" ||
      !isHttps(article.image) ||
      !Array.isArray(article.sources) ||
      !article.sources.length ||
      !article.sources.every(isHttps) ||
      !article.quiz ||
      typeof article.quiz.q !== "string" ||
      !Array.isArray(article.quiz.a) ||
      article.quiz.a.length !== 3 ||
      !article.quiz.a.every(a =>
        typeof a === "string" && a.trim()
      ) ||
      !Number.isInteger(article.quiz.correct) ||
      article.quiz.correct < 0 ||
      article.quiz.correct > 2
    ) {
      console.log("Rejected article:", article.title);
      continue;
    }

    const title = normalizeTitle(article.title);

    const id = crypto
      .createHash("sha256")
      .update(title)
      .digest("hex")
      .slice(0, 20);

    if (knownTitles.has(title) || knownIds.has(id)) {
      console.log("Duplicate article:", article.title);
      continue;
    }

    accepted.push({
      ...article,
      id,
      date: today
    });

    knownTitles.add(title);
    knownIds.add(id);

    if (accepted.length >= COUNT) break;
  }

  if (accepted.length !== COUNT) {
    throw new Error(
      `Expected ${COUNT} valid articles, received ${accepted.length}. Database unchanged.`
    );
  }

  database.articles = [...existing, ...accepted];
  database.updatedAt = today;
  database.version = Number(database.version || 1) + 1;

  await fs.writeFile(
    FILE,
    JSON.stringify(database, null, 2) + "\n",
    "utf8"
  );

  console.log("SUCCESS");
  console.log("New articles:", accepted.length);
  console.log("Total articles:", database.articles.length);
  console.log("Updated:", today);
}

main().catch(error => {
  console.error("Content generation failed:", error.message);
  process.exitCode = 1;
});
