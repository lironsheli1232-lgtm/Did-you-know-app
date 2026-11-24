name: DID YOU KNOW - Daily Content
on:
  workflow_dispatch:
  schedule:
    - cron: '15 3 * * *'
permissions:
  contents: write
  pages: write
  id-token: write
concurrency:
  group: dyk-pages
  cancel-in-progress: false
jobs:
  generate:
    runs-on: ubuntu-latest
    timeout-minutes: 12
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: Tests
        run: node --test tests/*.test.js
      - name: Generate articles
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
          DAILY_ARTICLE_COUNT: '5'
        run: node scripts/generate-content.mjs
      - name: Save archive
        run: |
          git config user.name 'github-actions[bot]'
          git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
          git add content/articles.json
          if ! git diff --cached --quiet; then
            git commit -m 'Publish daily articles'
            git push
          fi
      - name: Prepare public site
        run: |
          mkdir -p public/content
          cp index.html icon.svg personalization.js content-loader.js public/
          node -e 'const fs=require("fs");const d=JSON.parse(fs.readFileSync("content/articles.json"));delete d.reserve;fs.writeFileSync("public/content/articles.json",JSON.stringify(d));'
      - uses: actions/upload-pages-artifact@v3
        with:
          path: public
  deploy:
    needs: generate
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy
        id: deployment
        uses: actions/deploy-pages@v4
