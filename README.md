# Pooza: Run for Love

A dark, ghostly temple-run game. Dodge barriers, slide under beams, jump gaps,
and dodge jumbies (ghostly spirits) — you have 3 lives. Reach the end of the
ruins to find Princess Pooza.

## Files
- `index.html` — page structure
- `style.css` — all styling
- `game.js` — game logic (Three.js)

## Run it locally
Just open `index.html` in a browser. For the most reliable experience
(especially on mobile), serve the folder instead of using a `file://` URL:

```bash
npx serve .
```

Then open the printed `http://localhost:...` address.

## Deploy for free with GitHub Pages
1. Create a new GitHub repository (e.g. `pooza-run`).
2. In VS Code, open this folder, then in the terminal:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Pooza: Run for Love"
   git branch -M main
   git remote add origin https://github.com/<your-username>/pooza-run.git
   git push -u origin main
   ```
3. On GitHub: go to your repo → **Settings** → **Pages**.
4. Under "Build and deployment", set **Source** to "Deploy from a branch",
   branch `main`, folder `/ (root)`. Save.
5. GitHub gives you a live URL within a minute or two, typically:
   `https://<your-username>.github.io/pooza-run/`
6. Share that link — it works on desktop and mobile browsers.

## Notes
- High scores and the last-used name are stored in the browser's
  `localStorage`, so they're per-device, not shared between players.
- No backend or build step required — it's plain HTML/CSS/JS plus Three.js
  loaded from a CDN.
