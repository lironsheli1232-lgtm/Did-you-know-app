
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const COUNT = Math.max(1, Math.min(30, Number(process.env.DAILY_ARTICLE_COUNT || 5)));
const FILE = path.resolve("content/articles.json");

const CATEGORIES = [
  "ספורט", "מדע וחלל", "היסטוריה", "פסיכולוגיה",
  "פילוסופיה", "טבע ובעלי חיים", "טכנולוגיה",
  "תרבות ואמנות", "גוף האדם", "תעלומות"
];

if (!API_KEY) {
  console.error("Missing GEMINI_API_KEY");
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);

const database = JSON.parse(await fs.readFile(FILE, "utf8"));
const existing = Array.isArray(database.articles) ? database.articles : [];

if (database.updatedAt === today && !process.env.FORCE_GENERATE) {
  console.log("Today's articles already exist. Skipping.");
  process.exit(0);
}

const recentTitles = existing.slice(-200).map(a => a.title);

const prompt = `
You are the editor of DID YOU KNOW?, a Hebrew educational discovery app.

Generate exactly ${COUNT} original, interesting, factually careful
educational articles in natural, engaging Hebrew.

Use a wide variety of these categories:
${CATEGORIES.join(", ")}

Avoid repeating these previous titles or substantially similar topics:
${JSON.stringify(recentTitles)}

Requirements for every article:
- category: one of the categories above.
- title: intriguing Hebrew headline.
- teaser: 1-2 sentences.
- body: array of 3-5 substantial Hebrew paragraphs.
- fact: one additional interesting, accurate detail.
- image: an HTTPS URL to a relevant photograph, if verifiable.
  Otherwise use an empty string.
- sources: array of 1-3 real, relevant HTTPS source URLs.
  Never invent URLs or citations.
- quiz: object with q (Hebrew question), a (array of 3 answers),
  correct (zero-based index of the correct answer).

Do not invent facts, research findings, links or images.
If unsure about a claim, choose another topic.

Return ONLY valid JSON:
{"articles":[{"category":"","title":"","teaser":"",
"body":[],"fact":"","image":"","sources":[],
"quiz":{"q":"","a":[],"correct":0}}]}
`;

async function generate() {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": API_KEY
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.8,
          responseMimeType: "application/json"
        }
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini API failed: ${response.status} ${await response.text()}`);
  }

  const result = await response.json();
  const output = result.candidates?.[0]?.content?.parts
    ?.map(part => part.text || "").join("");

  if (!output) throw new Error("Gemini returned no content");

  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed.articles)) {
    throw new Error("Invalid response: articles array missing");
  }

  return parsed.articles;
}

function valid(article) {
  return article &&
    CATEGORIES.includes(article.category) &&
    typeof article.title === "string" &&
    article.title.trim().length >= 12 &&
    typeof article.teaser === "string" &&
    article.teaser.trim().length >= 30 &&
    Array.isArray(article.body) &&
    article.body.length >= 3 &&
    article.body.every(p => typeof p === "string" && p.length >= 70) &&
    Array.isArray(article.sources) &&
    article.sources.length >= 1 &&
    article.sources.every(url => /^https:\/\/[^ ]+$/i.test(url)) &&
    article.quiz &&
    typeof article.quiz.q === "string" &&
    Array.isArray(article.quiz.a) &&
    article.quiz.a.length === 3 &&
    Number.isInteger(article.quiz.correct) &&
    article.quiz.correct >= 0 &&
    article.quiz.correct <= 2;
}

function createId(title) {
  return crypto.createHash("sha256")
    .update(title.trim().toLowerCase())
    .digest("hex")
    .slice(0, 20);
}

try {
  const generated = await generate();
  const knownIds = new Set(existing.map(a => a.id));
  const knownTitles = new Set(existing.map(a => a.title?.trim().toLowerCase()));
  const accepted = [];

  for (const article of generated) {
    if (!valid(article)) continue;

    const id = createId(article.title);
    const titleKey = article.title.trim().toLowerCase();

    if (knownIds.has(id) || knownTitles.has(titleKey)) continue;

    // An image is required by the existing content-loader.js.
    // Do not save articles with missing or unverified images.
    if (!/^https:\/\/\S+$/i.test(article.image || "")) continue;

    accepted.push({
      ...article,
      id,
      date: today
    });

    knownIds.add(id);
    knownTitles.add(titleKey);
  }

  if (accepted.length !== COUNT) {
    throw new Error(
      `Expected ${COUNT} valid articles, got ${accepted.length}. ` +
      "Database was not modified."
    );
  }

  database.articles = [...existing, ...accepted];
  database.updatedAt = today;
  database.version = Number(database.version || 1) + 1;

  await fs.writeFile(FILE, JSON.stringify(database, null, 2) + "\n", "utf8");

  console.log(`Saved ${accepted.length} articles for ${today}`);
} catch (error) {
  console.error("Content generation failed:", error.message);
  process.exit(1);
}
