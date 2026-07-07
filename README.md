<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Grandmaster Text Chess 👑

A sophisticated chess application featuring textual move entry with real-time destination previews, full rule enforcement, and robust peer-to-peer online play.

<div align="center">
  <img src="chess_screenshot.jpg" width="800" alt="Grandmaster Text Chess Screenshot" />
</div>

## Features
- **P2P Multiplayer**: Real-time online pairing and play directly in the browser via PeerJS without any central database dependency.
- **Interactive Move Preview**: Enter algebraic chess notation text commands with interactive previews and valid move guidance.
- **Premium Audio Synth**: Custom synthesized sound effects for landing, captures, and check alerts.

---

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/e8e9efb9-259b-4151-a942-11899ee530a9

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
