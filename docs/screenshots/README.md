# Screenshot provenance

Captured from `https://pulseflare.zlv.uk` on September 30, 2026 using Chrome and Playwright. These are actual page screenshots, not generated mockups or edited metrics.

| File | Route | Theme | Viewport |
| --- | --- | --- | --- |
| `homepage.png` | `/` | Dark | 1440 × 880 |
| `workspace.png` | `/demo` | Dark | 1440 × 960, full page |
| `monitor.png` | `/demo/monitors/website` | Light | 1440 × 960, full page |
| `incident.png` | `/demo/incidents/inc-search` | Dark | 1440 × 1050, full page |
| `status-page.png` | `/status/demo` | Light | 1440 × 1050, full page |
| `mobile.png` | `/demo` | Dark | 390 × 844 |

Orbit is the explicitly fictional, read-only sample workspace. Its history, AI text, deliveries, and postmortems are not production telemetry or proof of customer usage. Real signed-in monitoring is verified separately in the [release record](../MVP_RELEASE.md).

To refresh these assets from the repository root, install the Playwright CLI and Chrome, then run:

```bash
playwright-cli -s=showcase open https://pulseflare.zlv.uk --browser=chrome
playwright-cli -s=showcase run-code --filename=scripts/capture-readme.js
playwright-cli -s=showcase close
```

The [capture script](../../scripts/capture-readme.js) uses actual routes and the theme preference, waits for fonts/charts, checks horizontal overflow, and does not sign in or mutate server data. Reduced-motion preferences make captures repeatable.
