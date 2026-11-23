
/*
 * DID YOU KNOW? — Personalization Engine v1
 *
 * Selects daily articles based on interests,
 * reading history and discovery.
 *
 * No external libraries or paid services required.
 */

(function (root, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.DYKPersonalization = api;
  }
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function () {
    "use strict";

    const DEFAULT_SETTINGS = {
      dailyArticleCount: 5,
      personalizedArticleCount: 3,
      discoveryArticleCount: 2,
      allowPreviouslyReadArticles: false,
      carryOverUnreadArticles: true
    };

    const CATEGORY_MAP = {
      "ספורט": "ספורט",
      "כדורגל": "ספורט",
      "כדורסל": "ספורט",
      "טניס": "ספורט",
      "אולימפיאדה": "ספורט",

      "מדע": "מדע וחלל",
      "חלל": "מדע וחלל",
      "אסטרונומיה": "מדע וחלל",
      "פיזיקה": "מדע וחלל",

      "היסטוריה": "היסטוריה",
      "פסיכולוגיה": "פסיכולוגיה",
      "פילוסופיה": "פילוסופיה",

      "טבע": "טבע ובעלי חיים",
      "בעלי חיים": "טבע ובעלי חיים",
      "ים וטבע": "טבע ובעלי חיים",
      "אוקיינוסים": "טבע ובעלי חיים",
      "גאוגרפיה": "טבע ובעלי חיים",

      "טכנולוגיה": "טכנולוגיה",
      "המצאות": "טכנולוגיה",

      "תרבות": "תרבות ואמנות",
      "אמנות": "תרבות ואמנות",
      "מוזיקה": "תרבות ואמנות",

      "גוף האדם": "גוף האדם",
      "בריאות": "גוף האדם",

      "תעלומות": "תעלומות"
    };

    function normalizeCategory(category) {
      const value = String(category || "").trim();
      return CATEGORY_MAP[value] || value || "תעלומות";
    }

    function uniqueStrings(values) {
      if (!Array.isArray(values)) return [];

      return [...new Set(
        values
          .filter(value => typeof value === "string")
          .map(value => value.trim())
          .filter(Boolean)
      )];
    }

    function normalizeHistory(history) {
      if (!history || typeof history !== "object") {
        return {
          readIds: [],
          savedIds: [],
          unreadIds: [],
          scores: {}
        };
      }

      return {
        readIds: uniqueStrings(history.readIds),
        savedIds: uniqueStrings(history.savedIds),
        unreadIds: uniqueStrings(history.unreadIds),
        scores:
          history.scores &&
          typeof history.scores === "object" &&
          !Array.isArray(history.scores)
            ? history.scores
            : {}
      };
    }

    function articleScore(article, interests, history) {
      const category = normalizeCategory(article.category);

      const interestScore = interests.includes(category) ? 100 : 0;

      const learnedScore = Math.max(
        -30,
        Math.min(30, Number(history.scores[category]) || 0)
      );

      const savedScore = history.savedIds.includes(article.id) ? 15 : 0;

      const unreadScore = history.unreadIds.includes(article.id) ? 20 : 0;

      return interestScore + learnedScore + savedScore + unreadScore;
    }

    function selectDailyArticles(input) {
      const data = input || {};

      const articles = Array.isArray(data.articles)
        ? data.articles.filter(
            article =>
              article &&
              typeof article.id === "string" &&
              article.id.trim() &&
              typeof article.category === "string"
          )
        : [];

      const interests = uniqueStrings(data.interests)
        .map(normalizeCategory);

      const history = normalizeHistory(data.history);

      const settings = {
        ...DEFAULT_SETTINGS,
        ...(data.settings || {})
      };

      const total = Math.max(
        0,
        Math.floor(Number(settings.dailyArticleCount) || 0)
      );

      const personalizedLimit = Math.min(
        total,
        Math.max(
          0,
          Math.floor(Number(settings.personalizedArticleCount) || 0)
        )
      );

      const discoveryLimit = Math.min(
        total - personalizedLimit,
        Math.max(
          0,
          Math.floor(Number(settings.discoveryArticleCount) || 0)
        )
      );

      const readSet = new Set(history.readIds);
      const seenIds = new Set();

      const eligible = articles.filter(article => {
        if (seenIds.has(article.id)) return false;
        seenIds.add(article.id);

        if (
          !settings.allowPreviouslyReadArticles &&
          readSet.has(article.id)
        ) {
          return false;
        }

        return true;
      });

      const rank = list =>
        [...list].sort(
          (a, b) =>
            articleScore(b, interests, history) -
            articleScore(a, interests, history)
        );

      const preferred = rank(
        eligible.filter(article =>
          interests.includes(normalizeCategory(article.category))
        )
      );

      const discovery = rank(
        eligible.filter(article =>
          !interests.includes(normalizeCategory(article.category))
        )
      );

      const selected = [];
      const selectedIds = new Set();

      function addFrom(list, limit) {
        let added = 0;

        for (const article of list) {
          if (selected.length >= total || added >= limit) break;
          if (selectedIds.has(article.id)) continue;

          selected.push(article);
          selectedIds.add(article.id);
          added++;
        }
      }

      addFrom(preferred, personalizedLimit);
      addFrom(discovery, discoveryLimit);

      // Fill any remaining places with available unread articles.
      const remaining = rank(
        eligible.filter(article => !selectedIds.has(article.id))
      );

      addFrom(remaining, total - selected.length);

      return {
        date: data.date || new Date().toISOString().slice(0, 10),
        articles: selected,
        requestedCount: total,
        selectedCount: selected.length,
        personalizedCount: selected.filter(article =>
          interests.includes(normalizeCategory(article.category))
        ).length,
        discoveryCount: selected.filter(article =>
          !interests.includes(normalizeCategory(article.category))
        ).length,
        hasEnoughArticles: selected.length === total
      };
    }

    function recordInteraction(history, article, action) {
      const next = normalizeHistory(history);

      if (!article || !article.id) return next;

      const category = normalizeCategory(article.category);
      const current = Number(next.scores[category]) || 0;

      const weights = {
        open: 1,
        complete: 3,
        save: 4,
        skip: -1
      };

      const change = weights[action] || 0;

      next.scores = {
        ...next.scores,
        [category]: Math.max(-30, Math.min(30, current + change))
      };

      if (action === "complete") {
        next.readIds = uniqueStrings([...next.readIds, article.id]);
        next.unreadIds = next.unreadIds.filter(id => id !== article.id);
      }

      if (action === "save") {
        next.savedIds = uniqueStrings([...next.savedIds, article.id]);
      }

      if (action === "open") {
        if (
          !next.readIds.includes(article.id) &&
          !next.unreadIds.includes(article.id)
        ) {
          next.unreadIds.push(article.id);
        }
      }

      return next;
    }

    return {
      DEFAULT_SETTINGS,
      normalizeCategory,
      normalizeHistory,
      articleScore,
      selectDailyArticles,
      recordInteraction
    };
  }
);
