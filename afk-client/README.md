# AFK Client

Mineflayer AFK bots with a web dashboard (accounts, proxies, live inventory, console).

## Railway
1. Push this folder to a GitHub repo, then Railway > New Project > Deploy from GitHub.
2. Variables: `DASHBOARD_PASSWORD` (required, any username works at the login prompt), `DATA_DIR=/data`.
3. Add a Volume mounted at `/data` so accounts, proxies and Microsoft logins survive redeploys.
4. Generate a public domain, open it, log in.

## Local
`npm install && DASHBOARD_PASSWORD=secret npm start` then open http://localhost:3000

## Notes
- Microsoft accounts: on first start the dashboard shows a code and link, sign in once, the token is cached.
- Set the MC version on each account when using a proxy.
- Sell axe: tune "item name to match", "buy command" and "confirm button keywords" to your server's AH GUI.
