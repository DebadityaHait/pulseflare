# Screenshots

Captured from [pulseflare.zlv.uk](https://pulseflare.zlv.uk) with Chrome and Playwright. Workspace images show Orbit, the read-only sample workspace.

| Image | Route | Theme | Viewport |
| --- | --- | --- | --- |
| `homepage.png` | `/` | Dark | 1440 × 880 |
| `workspace.png` | `/demo` | Dark | 1440 × 960, full page |
| `monitor.png` | `/demo/monitors/website` | Light | 1440 × 960, full page |
| `incident.png` | `/demo/incidents/inc-search` | Dark | 1440 × 1050, full page |
| `status-page.png` | `/status/demo` | Light | 1440 × 1050, full page |
| `mobile.png` | `/demo` | Dark | 390 × 844 |

To refresh the images, install Playwright CLI and Chrome, then run from the repository root:

```bash
playwright-cli -s=showcase open https://pulseflare.zlv.uk --browser=chrome
playwright-cli -s=showcase run-code --filename=scripts/capture-readme.js
playwright-cli -s=showcase close
```

The [capture script](../../scripts/capture-readme.js) sets the theme, waits for fonts and charts, and checks horizontal overflow. It uses reduced motion and does not modify server data.
