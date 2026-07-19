# Gambit Fanz Voiceover Pitch

Meet Gambit Fanz, a Telegram mini app that turns live TxLINE sports data into an interactive fan experience.

Most sports fans already watch matches with Telegram open. Gambit Fanz brings live markets, AI match commentary, and fan-friendly signals into the same place, without forcing users to jump between a sportsbook, a stats site, and social media.

The app is powered by TxLINE. We use TxLINE fixtures, odds snapshots, scores, and live feed data as the core data source. As matches update, the system reads the latest odds movement, market prices, and match state, then turns that into a simple consumer experience.

On the Markets page, fans can browse active football fixtures grouped by match. Each match shows the available markets, including match winner, over or under, and both teams to score. Odds are displayed in a familiar mobile-first format, so users can quickly understand what the market is saying.

The same app also includes a betting flow. A user can connect a Solana wallet, select an outcome, review the stake, and place a position on devnet. The market engine handles the on-chain side, while the interface keeps the experience simple and familiar for everyday fans.

The new Feeds page is where the AI Pundit comes in.

The AI agent reads TxLINE data and creates social-style match posts. It looks at fixture data, live odds, implied probabilities, and available score context. Then it explains what is happening in plain language: who has momentum, which side the market currently favors, where the uncertainty is, and what kind of match story is developing.

We use OpenRouter for AI narration, with a deterministic fallback signal engine underneath. That means the product can still produce structured match reads even if the AI layer is unavailable. The AI does not invent match data. It works from TxLINE inputs and clearly frames its output as a live signal, not certainty.

For consumers, the benefit is simple: they do not need to understand raw odds feeds or complex market movement. Gambit Fanz explains it like a pundit. If the draw is becoming stronger, if one team is gaining market confidence, or if an odds shift changes the story of the match, the feed turns that into a short, readable update.

This creates a combined experience: fans can discover matches, read AI-powered live context, and interact with prediction markets from the same Telegram mini app.

Behind the scenes, the architecture has three parts.

First, the TxLINE data layer provides fixtures, odds, score data, and live updates.

Second, the AI Pundit agent normalizes that data, computes match signals, and generates feed posts using OpenRouter.

Third, the Telegram mini app displays both the market dashboard and the AI feed in a mobile-native interface.

We deployed the consumer mini app on AWS CloudFront, and the AI feed API runs as a public AWS Lambda endpoint. The market bot API is also live, so judges can test both the consumer app and the backend endpoints.

Gambit Fanz is not just another betting screen. It is a fan companion that makes real-time sports data understandable, social, and actionable inside Telegram.

TxLINE gives us the live data. Solana gives us the on-chain market layer. AI turns the raw feed into a story fans can actually follow.

That is Gambit Fanz: live markets, AI punditry, and fan engagement in one Telegram experience.
