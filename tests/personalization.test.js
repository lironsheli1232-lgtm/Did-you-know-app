
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  selectDailyArticles,
  recordInteraction,
  normalizeCategory
} = require("../personalization.js");

const articles = [
  { id: "s1", category: "ספורט" },
  { id: "s2", category: "כדורגל" },
  { id: "s3", category: "כדורסל" },
  { id: "s4", category: "ספורט" },
  { id: "h1", category: "היסטוריה" },
  { id: "p1", category: "פסיכולוגיה" },
  { id: "n1", category: "טבע" }
];

function select(overrides = {}) {
  return selectDailyArticles({
    articles,
    interests: ["ספורט"],
    date: "2026-11-23",
    ...overrides
  });
}

test("chooses five articles: three preferred and two discoveries", () => {
  const result = select();

  assert.equal(result.selectedCount, 5);
  assert.equal(result.personalizedCount, 3);
  assert.equal(result.discoveryCount, 2);
  assert.equal(result.hasEnoughArticles, true);
});

test("does not repeat an article in the same edition", () => {
  const result = select({
    articles: [...articles, articles[0]]
  });

  const ids = result.articles.map(article => article.id);

  assert.equal(new Set(ids).size, ids.length);
});

test("excludes articles already read", () => {
  const result = select({
    history: { readIds: ["s1", "h1"] }
  });

  assert.equal(
    result.articles.some(article => article.id === "s1"),
    false
  );

  assert.equal(
    result.articles.some(article => article.id === "h1"),
    false
  );
});

test("remembers an opened but unfinished article", () => {
  const history = recordInteraction(
    {},
    { id: "s1", category: "ספורט" },
    "open"
  );

  assert.ok(history.unreadIds.includes("s1"));
  assert.equal(history.readIds.includes("s1"), false);
});

test("marks completed articles as read", () => {
  let history = recordInteraction(
    {},
    { id: "s1", category: "ספורט" },
    "open"
  );

  history = recordInteraction(
    history,
    { id: "s1", category: "ספורט" },
    "complete"
  );

  assert.ok(history.readIds.includes("s1"));
  assert.equal(history.unreadIds.includes("s1"), false);
  assert.equal(history.scores["ספורט"], 4);
});

test("learns from saved articles", () => {
  const history = recordInteraction(
    {},
    { id: "s2", category: "כדורגל" },
    "save"
  );

  assert.ok(history.savedIds.includes("s2"));
  assert.equal(history.scores["ספורט"], 4);
});

test("normalizes categories consistently", () => {
  assert.equal(normalizeCategory("כדורגל"), "ספורט");
  assert.equal(normalizeCategory("חלל"), "מדע וחלל");
  assert.equal(normalizeCategory("אוקיינוסים"), "טבע ובעלי חיים");
});

test("returns fewer articles if the pool is too small", () => {
  const result = select({
    articles: articles.slice(0, 2)
  });

  assert.equal(result.selectedCount, 2);
  assert.equal(result.hasEnoughArticles, false);
});

test("returns an empty edition for an empty pool", () => {
  const result = select({ articles: [] });

  assert.equal(result.selectedCount, 0);
  assert.deepEqual(result.articles, []);
});
