# security-alerts fixture

[`cleissonbarbosa/telegram-security-bot`](https://github.com/cleissonbarbosa/telegram-security-bot)
exposes no service of its own. Its handlers
(`src/commands/handlers/recent_vulnerabilities.py`) consume the public NVD
CVE API 2.0 and read these fields of each entry:

- `cve.id`
- `cve.descriptions[]` (`lang`, `value`)
- `cve.metrics.cvssMetricV31[0].cvssData.baseScore`

`nvd-recent.json` is a **hand-authored** document in that response shape.
Every advisory in it is fictional (`CVE-2099-*`, fictional products,
`*.invalid` URLs). AEGIS parses the same fields the bot parses and never
contacts NVD or Telegram.

`affected-services.json` is AEGIS-specific: it maps each fictional advisory to
nodes of the synthetic Helios Commerce topology so the alert can be shown in
place.
