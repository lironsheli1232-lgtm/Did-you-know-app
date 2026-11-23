
(function (root, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.DYKContentLoader = api;
  }
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function () {
    "use strict";

    function validateArticle(article) {
      return Boolean(
        article &&
        typeof article.id === "string" &&
        article.id.trim() &&
        typeof article.title === "string" &&
        article.title.trim() &&
        typeof article.category === "string" &&
        article.category.trim() &&
        typeof article.teaser === "string" &&
        article.teaser.trim() &&
        typeof article.image === "string" &&
        /^https:\/\//.test(article.image) &&
        Array.isArray(article.body) &&
        article.body.length > 0 &&
        article.body.every(
          paragraph => typeof paragraph === "string"
        )
      );
    }

    function normalizeDatabase(data) {
      if (
        !data ||
        typeof data !== "object" ||
        !Array.isArray(data.articles)
      ) {
        throw new Error("Invalid article database");
      }

      const seen = new Set();

      return {
        version: data.version || 1,
        settings: data.settings || {},
        articles: data.articles.filter(article => {
          if (!validateArticle(article)) return false;
          if (seen.has(article.id)) return false;

          seen.add(article.id);
          return true;
        })
      };
    }

    async function loadDatabase(url, fetcher) {
      const request = fetcher ||
        (typeof fetch !== "undefined" ? fetch : null);

      if (!request) {
        throw new Error("Fetch is unavailable");
      }

      const response = await request(
        url || "./content/articles.json",
        { cache: "no-store" }
      );

      if (!response.ok) {
        throw new Error(
          "Could not load articles: " + response.status
        );
      }

      return normalizeDatabase(await response.json());
    }

    function prepareDailyFeed(options) {
      const input = options || {};
      const engine = input.engine;

      if (
        !engine ||
        typeof engine.selectDailyArticles !== "function"
      ) {
        throw new Error("Personalization engine is missing");
      }

      const database = normalizeDatabase(
        input.database || { articles: [] }
      );

      const result = engine.selectDailyArticles({
        articles: database.articles,
        interests: input.interests || [],
        history: input.history || {},
        date: input.date,
        settings: database.settings
      });

      return {
        ...result,
        source: "shared-database",
        isDemo: false,
        databaseVersion: database.version
      };
    }

    return {
      validateArticle,
      normalizeDatabase,
      loadDatabase,
      prepareDailyFeed
    };
  }
);
