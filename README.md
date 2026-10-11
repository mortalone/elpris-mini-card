# Elpris Mini Card

Et lille read-only Lovelace-kort til Home Assistant, beregnet til et kompakt dashboard på en svag tablet. Ingen ApexCharts, Python, billedfiler eller eksterne afhængigheder.

Version **0.1.2**. Baggrundsreglen prioriteres eksplicit på kortets `ha-card` for at teste forskelle mellem browser og Kiosk Satellite. Kiosk Satellite/WebView er endnu ikke verificeret.

## Installation gennem HACS

1. Åbn HACS → menuen med tre prikker → **Brugerdefinerede repositories / Custom repositories**.
2. Tilføj `https://github.com/mortalone/elpris-mini-card`, og vælg **Dashboard** (ældre HACS: **Lovelace**).
3. Find **Elpris Mini Card** i HACS, og download kortet.
4. Genindlæs browseren på tabletten.

[Åbn repositoryet i HACS](https://my.home-assistant.io/redirect/hacs_repository/?owner=mortalone&repository=elpris-mini-card&category=plugin)

Hvis ressourcen ikke er tilføjet automatisk, tilføj under **Indstillinger → Dashboards → Ressourcer** (aktivér avanceret tilstand på din profil, hvis menuen mangler):

```yaml
url: /hacsfiles/elpris-mini-card/elpris-mini-card.js
type: module
```

Fjern en eventuel gammel `/local/elpris-mini-card.js`-ressource, så browseren kun indlæser én udgave. De eksisterende Apex- og Pyscript-kort kan blive stående under testen.

## Dit kort — samme døgn som den originale Apex-graf

```yaml
type: custom:elpris-mini-card
entity: sensor.ev_smart_charging_charging
attribute: raw_two_days
mode: day
height: 110
cheap_count: 2
show_now: true
show_cheap: true
show_header: true
decimals: 2
line_width: 3
```

Der kræves ingen ændring i integrationen eller Pyscript. Kortet læser attributten `raw_two_days` direkte. Dataformatet er en liste med `start` (ISO-dato med tidszone), `value` (tal), og valgfrit `end`.

**Enheder:** Kortet omregner ikke priser som standard. Det bruger sensorens `unit_of_measurement`. Kontrollér, at denne enhed også gælder attributtens `value`: din oprindelige YAML skrev øre/kWh, men tærsklerne 1–6 kan være kr/kWh. Hvis råværdierne er kroner, kan du skrive `unit: kr/kWh`. At skrive `unit` ændrer kun teksten. Ønsker du øre, brug `value_multiplier: 100`, `unit: øre/kWh`, og tilsvarende tærskler 100–600.

## Kort vindue omkring nu

```yaml
type: custom:elpris-mini-card
entity: sensor.ev_smart_charging_charging
mode: rolling
hours_back: 1
hours_forward: 6
height: 110
```

## Indstillinger

| Indstilling | Standard | Betydning |
| --- | --- | --- |
| `entity` | krævet | Sensor med prisdata |
| `attribute` | `raw_two_days` | Attribut med priser |
| `mode` | `day` | Lokalt døgn eller `rolling` |
| `height` | `110` | Hele kortets højde i px, inklusive akser |
| `hours_back` / `hours_forward` | `1` / `6` | Kun i rolling-visning |
| `cheap_count` | `2` | Antal billigste tilgængelige prisintervaller |
| `show_now` / `show_cheap` | `true` | Markører |
| `show_header` / `show_yaxis` | `true` | Aktuel pris og prisakse |
| `unit` | sensorens enhed | Visningstekst, uden omregning |
| `value_multiplier` | `1` | Omregning af råværdier |
| `decimals` | `2` | Decimaler på aktuel pris |
| `line_width` | `3` | Kurvetykkelse i px |
| `now_color` | `#ff80ab` | Nu-markør |
| `cheap_color` | `#64b5f6` | Billige intervaller |
| `color_threshold` | nedenfor | Farvegrænser i den viste prisenhed |

```yaml
color_threshold:
  - value: 1
    color: cyan
  - value: 2
    color: green
  - value: 3
    color: orange
  - value: 4
    color: red
  - value: 5
    color: magenta
  - value: 6
    color: black
```

Farverne interpoleres mellem prisgrænserne. Kurven er afrundet uden at opfinde ekstra toppe eller dale. Den er en oversigtsgraf; den eksakte intervalpris vises i overskriften.

Blå felter og streger langs tidsaksen markerer de billigste individuelle prisintervaller, som stadig kan bruges, inden for det viste vindue. Det aktuelle intervals resterende tid kan indgå. `cheap_count: 2` betyder to dataintervaller, ikke nødvendigvis to timer eller to sammenhængende perioder. En optimering af en hel vaskecyklus er ikke inkluderet.

Manglende fremtidige priser efterlader resten af grafen tom. Mangler det aktuelle interval, viser overskriften en streg. Grafen forbinder ikke perioder med kendte huller. I døgnvisning følges browserens lokale tidszone, inklusive 23/25-timers døgn. Brug dansk tidszone på tabletten.

## Opdateringer og udvikling

HACS kan installere direkte fra `main`; GitHub Releases er ikke nødvendige til første installation. Uden releases bruger HACS commit-versioner. Workflowet **Publish release** kan køres manuelt under GitHub Actions og udgiver versionen fra `package.json` med JS-filen som releasebilag. HACS-opdateringer installeres gennem HACS som for andre kort.

Kortet gentegner kun ved nye prisdata/enhed, ændret bredde og en gang i minuttet for Nu-markøren. Timere og størrelsesobserver fjernes, når kortet forlader siden. Det opretter ingen ekstra abonnementer eller historikforespørgsler; det reducerer ikke Home Assistants almindelige WebSocket-trafik.

```sh
npm run check
npm test
```

Der er ingen pakker at installere. Testene kontrollerer datahuller, negative priser, dubletter, ugyldige data, opdateringsfiltrering og oprydning. Første version er ikke endnu verificeret i en rigtig Home Assistant-installation.
