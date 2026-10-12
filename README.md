# Elpris Mini Card

Et lille read-only Lovelace-kort til Home Assistant, beregnet til et kompakt dashboard på en svag tablet. Ingen ApexCharts, Python, billedfiler eller eksterne afhængigheder.

Version **0.2.2**. Kortet anvender Home Assistants eget `ha-card` og arver automatisk baggrund, tekst, kanter og skygger fra det aktive tema. Den midlertidige WebView/CSS-diagnose er fjernet.

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

## Anbefalet: de seneste 2 timer og alle kendte fremtidige priser

```yaml
type: custom:elpris-mini-card
entity: sensor.ev_smart_charging_charging
attribute: raw_two_days
mode: rolling
hours_back: 2
hours_forward: auto
height: 110
cheap_count: 2
show_now: true
show_cheap: true
show_header: true
unit: kr/kWh
line_width: 5
```

Med `hours_forward: auto` slutter grafen ved den sidst kendte prisperiodes afslutning. Når sensoren modtager morgendagens priser, udvides grafen automatisk uden ændringer i YAML. Hvis sensoren ikke har brugbare fremtidige priser, vises mindst én time frem (uden at opfinde prisdata). Når grafen krydser midnat, markeres datoen diskret på tidsaksen. Visningen opdateres løbende med klokkeslættet.

Den gamle `mode: day` er stadig understøttet og viser et helt lokalt døgn.

Der kræves ingen ændring i integrationen eller Pyscript. Kortet læser attributten `raw_two_days` direkte. Dataformatet er en liste med `start` (ISO-dato med tidszone), `value` (tal), og valgfrit `end`.

**Enheder:** Kortet omregner ikke priser som standard. Det bruger sensorens `unit_of_measurement`. Kontrollér, at denne enhed også gælder attributtens `value`: din oprindelige YAML skrev øre/kWh, men tærsklerne 1–6 kan være kr/kWh. Hvis råværdierne er kroner, kan du skrive `unit: kr/kWh`. At skrive `unit` ændrer kun teksten. Ønsker du øre, brug `value_multiplier: 100`, `unit: øre/kWh`, og tilsvarende tærskler 100–600.

## Planlæg hvidevarer og se ladeplaner — uden ApexCharts eller Pyscript

Du kan konfigurere dette direkte i **kortets visuelle Lovelace-editor** (Rediger kort → Elpris Mini Card). Tilføj apparater med navn, ikon, farve og køretid i minutter. Tilføj en bil med navn, ikon, farve og en sensor med attributten `charging_schedule`. Alle indstillinger kan også ændres i YAML.

```yaml
type: custom:elpris-mini-card
entity: sensor.ev_smart_charging_charging
attribute: raw_two_days
mode: rolling
hours_back: 2
hours_forward: auto
height: 110
unit: kr/kWh
show_appliances: true
show_charging: true
show_legend: true
appliances:
  - name: Opvaskemaskine
    icon: mdi:dishwasher
    duration: 120
    color: "#008577"
  - name: Tørretumbler
    icon: mdi:tumble-dryer
    duration: 90
    color: "#d07a27"
ev_schedules:
  - name: Citroën
    icon: mdi:car-electric
    color: "#306fd1"
    entity: sensor.ev_smart_charging_charging
    attribute: charging_schedule
  - name: MG
    icon: mdi:car-electric-outline
    color: "#9454b8"
    entity: sensor.ev_smart_charging_charging_2
    attribute: charging_schedule
grid_options:
  columns: 12
  rows: auto
```

**Vigtigt:** Kontrollér, at bilernes sensorer faktisk repræsenterer hver sin bil. Navnene ovenfor er eksempler fra opsætningen og kan byttes. De skal have `charging_schedule`-attributten. Kortet behandler intervaller med `value > 0` som aktiv opladning og `value = 0` som inaktiv. `end` anvendes, hvis den er angivet; ellers bruges næste tidsstempel, eller én time for det sidste interval.

**Billigste kørselsvindue:** Kortet beregner lavest tidsvægtet gennemsnitspris for en *sammenhængende* periode af den valgte varighed. Det prøver starttidspunkter hvert kvarter plus kendte tarifskift. Tidsrummet starter tidligst nu og skal have kendte priser for hele perioden. Det viser vinduet på grafen med en diskret farvet markering og angiver klokkeslæt, navn og ikon i oversigten. Hvis ikke nok sammenhængende fremtidsdata findes, skriver det "Ingen sammenhængende periode". Det starter ikke selv apparater og reserverer ikke strømkapacitet, så flere apparater kan godt få samme billigste tidsrum.

**EV-ladeplaner:** De to bilers sensorer læses separat. Den farvede markering viser *allerede planlagt* opladning, ikke et nyt optimeringsforslag til bilen. Opdateringer af ladeplaner gentegner kortet. Ingen nye WebSocket-abonnementer bruges.

**Performance og layout:** Alle beregninger foregår lokalt ud fra de data, der allerede findes i Home Assistant. Der laves ingen historikforespørgsler eller Pyscript-kørsler. Maks. 8 apparater og 8 ladeplaner indlæses. Oversigten udvider automatisk kortets højde (ét kompakt tekstfelt pr. enhed); slå `show_legend: false` fra for samme højde som tidligere.

Du kan skjule markeringerne separat med `show_appliances: false` og `show_charging: false`. `show_cheap: false` skjuler de tidligere blå "billigste enkeltintervaller", hvis du kun ønsker de nye sammenhængende perioder.

## Placering af forklaring (legend)

Fra **v0.2.2** er der fire valgmuligheder i den visuelle Lovelace-editor under *Elprisgraf → Placering af forklaring*, eller i YAML:

```yaml
show_legend: true
legend_position: header   # bottom | top | header | inline
```

- **`bottom`** (standard): Den eksisterende oversigt under grafen med farve, ikon, navn og fulde tider. Ændrer ikke ældre kort.
- **`top`**: Egen, kompakt række **over grafen, højrestillet**, med farvet ikon og kort tidsrum, uden synligt navn. Den samlede korthøjde vokser cirka 29 px.
- **`header`**: Samme kompakte, højrestillede ikoner/tider **på linje med den aktuelle pris og enheden**, så der ikke bruges en ekstra række. Pris/enhed får reserveret plads til venstre. Hvis der er mange elementer, kan ikonrækken scrolles vandret.
- **`inline`**: Labels er **over selve prisplotområdet**, i en særskilt 22 px høj stribe *mellem prisoverskrift og kurve*, vandret centreret omkring de valgte perioder. Labels vises ikke længere oven på prislinjen. Overlap forsøges undgået, ved pladsmangel forkortes en label til kun ikonet, og enkelte labels kan udelades. Det giver kortet 22 px ekstra højde, så kurvens eksisterende højde bibeholdes.

Navn og fuldt tidsrum gemmes i tooltip og tilgængelighedstekst for de kompakte visninger. Eksempelvis vises `04–08` for hele timer, og `04:30–06` hvis minutter er nødvendige. Tidspunkter i morgen får datopræfiks, eksempelvis `13/04–08`.

`show_legend: false` skjuler alle forklaringer, men ikke selve farvemarkeringerne. `show_appliances` og `show_charging` fungerer fortsat uafhængigt af legend-placeringen. Der er ingen nye eksterne filer, WebSocket-abonnementer eller historikforespørgsler.

## Alternativ: fast antal timer frem

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
| `hours_back` / `hours_forward` | `1` / `6` | Rullende vindue: timer bagud / timer frem, eller `hours_forward: auto` for alle kendte fremtidige priser |
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
| `appliances` | `[]` | Liste over apparater med `name`, `duration` (min), `icon`, `color` |
| `ev_schedules` | `[]` | Liste over biler med `name`, `entity`, `attribute`, `icon`, `color` |
| `show_appliances` / `show_charging` | `true` / `true` | Aktiver/deaktiver apparat- og ladetidsmarkeringer |
| `show_legend` | `true` | Slå forklaring/labels til eller fra i alle visninger |
| `legend_position` | `bottom` | `bottom` (nederst), `top` (øverst/højre), `header` (ved prisen/højre), `inline` (over kurven ved markeringen) |

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

I døgnvisning og ved et fast fremadrettet vindue efterlader manglende fremtidige priser resten af grafen tom. I automatisk rolling-visning tilpasses højre kant seneste kendte prisperiode. Mangler det aktuelle interval, viser overskriften en streg. Grafen forbinder ikke perioder med kendte huller. I døgnvisning følges browserens lokale tidszone, inklusive 23/25-timers døgn. Brug dansk tidszone på tabletten.

**Tema:** Kortet angiver ikke selv baggrundsfarve eller gradient. Grafens kurve, nu-markør og billigste timer har egne funktionsfarver. Hvis et tema ikke virker i Kiosk Satellite, skal proxy-/WebSocket-filtrering af Home Assistants temaer undersøges. `debug: true` blev fjernet i v0.1.6.

## Opdateringer og udvikling

Udgivelse sker automatisk, når versionsnummeret i `package.json` opdateres på `main`. GitHub Actions kører syntakscheck og tests før udgivelse som GitHub Release. HACS kan derefter installere den nye version.

Kortet gentegner ved nye prisdata, ændrede EV-ladeplaner, ændret bredde og en gang i minuttet for Nu-markøren. Timere og størrelsesobserver fjernes, når kortet forlader siden. Det opretter ingen ekstra abonnementer eller historikforespørgsler; det reducerer ikke Home Assistants almindelige WebSocket-trafik.

```sh
npm run check
npm test
```

Der er ingen pakker at installere. Testene kontrollerer datahuller, negative priser, dubletter, ugyldige data, opdateringsfiltrering og oprydning. Kortet er testet i brugerens Home Assistant-installation; visning og temaarv afhænger af de temaer, som klienten faktisk modtager.
