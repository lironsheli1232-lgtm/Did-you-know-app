
const test = require("node:test");
const assert = require("node:assert/strict");

const loader = require("../content-loader.js");
const engine = require("../personalization.js");

function article(id, category = "ספורט") {
  return {
    id,
    title: "כותרת " + id,
    teaser: "תיאור קצר ומעניין",
    category,
    image: "https://example.com/image.jpg",
    body: ["פסקה ראשונה", "פסקה שנייה"]
  };
}

test("accepts a valid article", () => {
  assert.equal(
    loader.validateArticle(article("a1")),
    true
  );
});

test("rejects an incomplete article", () => {
  const invalid = article("a1");
  delete invalid.title;

  assert.equal(
    loader.validateArticle(invalid),
    false
  );
});

test("removes duplicate articles", () => {
  const database = loader.normalizeDatabase({
    version: 1,
    articles: [
      article("a1"),
      article("a1"),
      article("a2")
    ]
  });

  assert.equal(database.articles.length, 2);
});

test("rejects an invalid database", () => {
  assert.throws(() => {
    loader.normalizeDatabase({});
  });
});

test("loads articles from JSON", async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      version: 1,
      articles: [article("a1")]
    })
  });

  const result = await loader.loadDatabase(
    "./content/articles.json",
    fakeFetch
  );

  assert.equal(result.articles.length, 1);
});

test("handles a failed network response", async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 404
  });

  await assert.rejects(
    loader.loadDatabase(
      "./content/articles.json",
      fakeFetch
    )
  );
});

test("connects the database to personalization", () => {
  const categories = [
    "ספורט",
    "ספורט",
    "ספורט",
    "ספורט",
    "היסטוריה",
    "פסיכולוגיה",
    "פילוסופיה"
  ];

  const database = {
    version: 1,
    settings: {
      dailyArticleCount: 5,
      personalizedArticleCount: 3,
      discoveryArticleCount: 2
    },
    articles: categories.map((category, index) =>
      article("a" + index, category)
    )
  };

  const result = loader.prepareDailyFeed({
    database,
    engine,
    interests: ["ספורט"],
    history: {},
    date: "2026-11-23"
  });

  assert.equal(result.selectedCount, 5);
  assert.equal(result.personalizedCount, 3);
  assert.equal(result.discoveryCount, 2);
  assert.equal(result.source, "shared-database");
});

test("handles an empty shared database", () => {
  const result = loader.prepareDailyFeed({
    database: {
      version: 1,
      articles: []
    },
    engine,
    interests: ["ספורט"]
  });

  assert.equal(result.selectedCount, 0);
  assert.equal(result.hasEnoughArticles, false);
});
