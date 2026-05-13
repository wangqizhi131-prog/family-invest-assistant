# Claude research brief: family A-share and fund assistant

You are supporting a Codex-led implementation. Treat the tool as a private family decision aid, not a public investment advisory product. Do not promise returns.

## Goal

Improve the rules behind a mobile-first A-share and Chinese mutual fund assistant. The first version tracks manually entered Alipay fund positions plus A-share watch holdings, refreshes market data, and generates specific but conditional action suggestions.

## Research tasks

1. Propose a rule set for Chinese mutual funds, especially broad index funds, consumption, liquor, medicine, semiconductor, and new-energy themes.
2. Propose A-share trading rules suitable for retail investors using end-of-day or near-close data.
3. Define risk controls for family accounts: max single-theme weight, max single-stock weight, drawdown response, profit-taking, and paused-investment states.
4. Suggest wording for action cards that remains concrete but avoids false certainty.
5. List data fields needed from a more reliable paid data provider if the public source is replaced.

## Output format

Return:

- A compact strategy table.
- Exact rule thresholds.
- Example action-card wording in Chinese.
- Compliance and safety cautions.
- Things Codex should change in `src/App.tsx` or `server.mjs`.

Keep it practical. Avoid broad textbook explanations.
