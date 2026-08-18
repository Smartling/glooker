# Glooker demo video — how it was made

Handover for whoever picks this up next (probably a future me with no memory of it).
Everything here was verified by doing it, not inferred.

**Final cut:** `glooker-demo-FINAL.mp4` — 1080×1920, 32.4s, H.264/AAC, ~3 MB
`https://pub-7d8033dde9294375a68da6fd9ac0be32.r2.dev/renders/cmsy2lk910003jm04xe0g8rls.mp4`

**Local working folder** (not in git): `~/Desktop/glooker-demo-footage/`
Superseded cuts are in its `iterations/` subfolder. Only the file named `…FINAL.mp4` is current.

---

## 1. What this is and why it looks the way it does

A ~32s vertical short for public distribution (LinkedIn / Shorts / TikTok), explaining what
Glooker is via one angle: **"you bought everyone Claude Code — did it do anything?"**

Four decisions were made deliberately and everything downstream follows from them. Don't
silently reverse them without re-reading this section.

| Decision | Choice | Why |
|---|---|---|
| Angle | AI spend vs. delivered work | Differentiated. Plenty of tools do dev analytics; almost none put per-developer AI spend next to shipped output. |
| Data | **Mock only** | No real developer names, Jira epics or spend figures. Safe in any venue, no confidentiality review, reusable. |
| Tone | Punchy short-form, self-aware | Chosen over a straight explainer for reach. |
| Visuals | Glooker UI only | **No gameplay.** See §6 — this was reversed mid-project after review. |

### The framing rule (most important thing in this document)

Glooker ranks developers by an impact score and tracks per-person AI spend. A careless video
about that reads as stack-ranking or surveillance — the opposite of the intended message.

So: **every joke targets the ritual, never a developer.** The spreadsheet, the four days, the
`#REF!` pivot. Beats 1–4 make the viewer the protagonist so the tool arrives as relief, not
judgement. And the spend shot always pairs spend *with* shipped output — never spend alone.

This is why the hero shot is the **org-level** numbers and the **Spend-vs-Impact scatter**
(dots, no names) rather than a ranked leaderboard of individuals. The scatter happens to place
one red dot alone in "High Spend / Low Impact", which makes the argument in a single frame
without naming anyone. That was a discovery in the product, not a thing we built.

---

## 2. The tool: brainrotshorts, driven over MCP

`https://www.brainrotshorts.com/api/mcp` — connected as an MCP server; all of this was done
through tool calls, no web UI.

- **Project id:** `cmsy0wctb0007l604x36nq7rt` — title "Glooker — Is AI actually helping?"
- **Voice/character:** `energic_male` — one of the **generic voice-only** entries
- **Captions:** `hormozi-style`, `captionGrouping: single-word`
- **Background colour:** `#0b0b12`
- **11 scenes**, one per script line
- **Cost:** 36 credits per render (30 base + 6 voice). Creator plan = 10,000/mo, so ~275 renders.
- **Render time:** ~25–80s for a base render; the one overlay render took ~2m15s.

### Why a generic voice, not a character

`character_list` is mostly celebrity and cartoon likenesses (Peter Griffin, Elon Musk, Goku,
Homer Simpson…). Those are an IP and brand problem in Smartling-branded marketing. The
voice-only entries have no `imageUrl`: `energic_male`, `ethan`, `jordan`, `sarah`, `laura`,
`selene`, `adrian`, `alle`, plus Spanish-language ones. Use those.

---

## 3. Pipeline, in order

1. **Get mock data running** (§4) and capture the app in a **portrait viewport** (§5).
2. Build background clips with ffmpeg (§5).
3. Push clips to the `media/demo-stills` branch (§7) — the renderer fetches them by URL.
4. `project_create` with background/character/caption settings.
5. `project_apply_script` — array of `{character, text}`, one entry per beat, max 40.
6. `project_scene_update` per scene with `backgroundVideoUrl` (§7).
7. `render_start` with `approved: true` (it defaults to false and won't render otherwise).
8. `render_status` until `DONE`, then download `outputUrl`.

### Script (11 beats, ~32s)

```
1  Your company bought every engineer Claude Code.
2  Six months later somebody asked if it did anything.
3  So you opened a spreadsheet. And git log.
4  It's day four. You have a pivot table and no answer.
5  This is Glooker. It reads every commit your org shipped.
6  Types, repos, what's still in flight. Automatically.
7  Then it shows what that cost you.
8  Which models. Which people. Dollars per commit.
9  Spend against impact. One chart.
10 And it's open source.
11 Glooker. Built by Smartling.
```

### Scene → background map

| scene | beat | background |
|---|---|---|
| 1 | calm setup | `demo-bg/bg_dark.mp4` |
| 2 | terminal chaos | `demo-bg2/bg_chaos_term.mp4` |
| 3 | spreadsheet chaos | `demo-bg2/bg_chaos_sheet.mp4` |
| 4 | broken pivot | `demo-bg2/bg_chaos_pivot.mp4` |
| 5 | Impact tab, stats | `demo-bg2/bg_impact_a.mp4` |
| 6 | Impact tab, charts | `demo-bg2/bg_impact_b.mp4` |
| 7 | Spend tiles | `demo-bg2/bg_spend_a.mp4` |
| 8 | Top spenders | `demo-bg2/bg_spend_c.mp4` |
| 9 | Spend-vs-Impact scatter | `demo-bg2/bg_spend_d.mp4` |
| 10–11 | close | `demo-bg/bg_dark.mp4` |

`demo-bg/` holds the first (abandoned) landscape-crop attempt; only `bg_dark.mp4` from it is
still used. `demo-bg2/` is the portrait set. `demo-stills/` holds PNGs from the abandoned
image-overlay approach — kept only because scene URLs are SHA-pinned and history matters.

---

## 4. Mock data setup (needed to re-capture anything)

```bash
DB_TYPE=sqlite SQLITE_PATH=/tmp/glooker-demo.db npm run seed

DB_TYPE=sqlite SQLITE_PATH=/tmp/glooker-demo.db \
  GITHUB_PROVIDER=mock LLM_PROVIDER=mock JIRA_ENABLED=true JIRA_PROVIDER=mock \
  JIRA_PROJECTS_JQL='project = MOCK AND issuetype = Epic' AUTH_ENABLED=false \
  npx next dev -p 3005
```

**You must force `DB_TYPE=sqlite` and a throwaway `SQLITE_PATH` explicitly.** `.env.local` sets
`DB_TYPE=mysql`, and `next dev` loads `.env.local` — without the override, "mock mode" reads the
**real** MySQL and puts real developer names on screen, which defeats the entire mock-data
decision. Port 3005 keeps the podman container on 3000 alive.

`npm run seed` does *not* read `.env.local` (no dotenv in `scripts/seed.ts`), so it defaults to
SQLite anyway — but pass the vars regardless, so the seed and the server agree on a DB.

Useful values:
- org: `mock-org`
- completed report id: `00000000-0000-4000-a000-000000000001` (14 days, 8 developers)
- Impact tab: `/report/<id>/org` · Spend tab: `/report/<id>/org?tab=spend` (`?tab=` works)
- 8 mock developers `alice-mock` … `hank-mock`; teams Platform / Frontend / Data / Research

**Dependency:** this needs the `DATE_ADD` SQLite fix (GLOOK-41 / PR #67). Without it,
`GET /api/report/<id>/org` returns 500 whenever the report has spend data — which `npm run seed`
always creates — so the Spend tab cannot be captured at all.

**Do not try to film the Projects boards in mock mode.** GLOOK-42: 11 epics total, no epic has a
goal parent, no commits linked to epics, so the boards render near-empty and undersell the
product. Both board shots were cut from the script for this reason. If GLOOK-42 lands, they
become filmable and the script could regain its "any Jira project, any team shape" beat.

---

## 5. Capturing and building clips

### Capture the app in a PORTRAIT viewport — this is the key trick

Glooker is a wide desktop layout. Cropping it for 9:16 gives ~10:1 slivers that float in a
mostly-black frame; the first Glooker-only cut looked terrible for exactly this reason.

At **760 px wide the app reflows into a genuine two-column layout** — stat tiles stack 2×2,
tables narrow — and fills a vertical frame natively.

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --force-device-scale-factor=2 --virtual-time-budget=22000 \
  --window-size=760,2600 \
  --screenshot=spend_tall.png "http://localhost:3005/report/<id>/org?tab=spend"
```

`--force-device-scale-factor=2` gives 2× pixels (1520 wide) so downscaling stays crisp.
`--window-size` height controls how much page you capture — go taller than one screen so
there's room to scroll.

### Turn a tall capture into a scrolling clip

```bash
ffmpeg -loop 1 -i spend_tall.png -t 8 -r 30 \
  -vf "scale=1080:-2,crop=1080:1920:0:'START+(END-START)*t/8',format=yuv420p" \
  -c:v libx264 -preset medium -crf 19 bg_out.mp4
```

Reads like someone actually scrolling the app. **Keep `START`/`END` inside the real content
height** or the clip pans into dead space — this bit me twice. Verify rather than eyeball:

```bash
ffmpeg -ss 7.5 -i bg_out.mp4 -frames:v 1 -vf "scale=100:-1,format=gray" -f rawvideo - 2>/dev/null \
 | python3 -c "
import sys; d=sys.stdin.buffer.read(); W=100; H=len(d)//W
busy=sum(1 for y in range(H) if max(d[y*W:(y+1)*W])-min(d[y*W:(y+1)*W])>18)
print(f'{busy/H:.0%} filled')"
```
Anything below ~75% means the pan ran off the end of the content.

### The animated dark background (narrative beats)

```bash
ffmpeg -f lavfi -i "gradients=s=1080x1920:c0=0x0d0d12:c1=0x151b2b:c2=0x0d0d12:speed=0.012:d=10" \
  -t 10 -r 30 -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p bg_dark.mp4
```

### The chaos props (beats 2–4)

Generated as HTML, screenshotted in the same portrait viewport, then scrolled. Generator script
is not committed — regenerate from this description if needed:

- **Terminal:** monospace on `#07070a`, opens with `$ git log … | wc -l` → `2417`, then ~170
  lines of `sha date author type(scope): subject`.
- **Spreadsheet:** titled `commit-audit-FINAL-v7-USE-THIS-ONE.xlsx · last edited 4 days ago`
  (the filename is the joke). Columns `sha | author | date | repo | +lines | -lines | ai? |
  impact??`, ~110 rows salted with `#REF!`, `#DIV/0!`, `maybe`, `?`, `=B84*0.4`, blanks.
- **Pivot:** `PivotTable3 — Sum of impact?? by author`, every value `#DIV/0!` or `#REF!`, a
  `(blank)` row, Grand Total `#REF!`. Crop this one at `x=0` — its labels start at the page
  edge and a centred crop clips them.

Props use **real conventional-commit shapes with mock authors.** Real `git log` was pulled from
this repo first (public + MIT, so not a confidentiality issue) but the author names were swapped
to the mock cast — real names would put a real person on screen and clash with `mock-org`
everywhere else. Authenticity that matters is the *format*, not whose name it is; fake-looking
props get spotted instantly by an engineering audience.

---

## 6. Things that cost time — read before repeating them

**Their fetcher 404s on `raw.githubusercontent.com` URLs whose branch name contains a slash.**
`media/demo-stills/…` returned 404 to brainrotshorts while returning 200 to curl. **Pin the URL
to a commit SHA instead** — that fixed it instantly. Applies to both `overlay_image_upload` and
`project_scene_update`.

**`gh api -f content=<base64>` blows the shell arg limit past ~1 MB** ("Argument list too
long"). Build the JSON and pipe it:

```bash
python3 -c "
import base64,json,sys
json.dump({'message':'…','branch':'media/demo-stills',
           'content':base64.b64encode(open(sys.argv[1],'rb').read()).decode()}, sys.stdout)
" file.mp4 > /tmp/p.json
gh api -X PUT repos/Smartling/glooker/contents/path/file.mp4 --input /tmp/p.json
```

**Scene durations are voice-driven, not what the project metadata says.** Every scene reports
`durationInSeconds: 4` (44s total) but the render came out **32.4s**. If you need real timings
(for overlays), derive them from the audio:

```bash
ffmpeg -i cut.mp4 -af "silencedetect=noise=-35dB:d=0.25" -f null - 2>&1 | grep silence_
```
Long gaps (~0.6–0.8s) are scene boundaries; short ones (~0.25–0.5s) are intra-sentence pauses.
Don't assume every silence is a boundary.

**There is no `background_upload` tool.** `background_list` mentions user-uploaded backgrounds,
but the way to use your own via MCP is `project_scene_update` with `backgroundVideoUrl`.

**Image overlays are anchored top-left and default to `x: 0.1, y: 0.1`.** With `width: 0.92`
that overflows 2% off the right edge; centre with `x: 0.04`. Overlays also require an
**already-rendered base video**, so they're a second pass.

**`render_start` / `overlay_render` need `approved: true`.** Deliberate safety gate.

**Different scenes legitimately point at different commit SHAs** of the same branch, because
assets were added across several pushes. SHA-pinned URLs are immutable, so this is fine — but
**don't delete the `media/demo-stills` branch while you might re-render**: the renderer fetches
these at render time, not at scene-update time.

**macOS lost filesystem access to the repo mid-session** (`Operation not permitted` on every
read, including through tooling, while `git --version` worked fine). It's the Desktop TCC grant.
Fix: System Settings → Privacy & Security → Files and Folders for the terminal app. An rsync'd
copy under `/private/tmp/` was a usable read-only fallback.

---

## 7. Iterating

Change a background: rebuild the clip → push to `media/demo-stills` → get the new head SHA →
`project_scene_update` with the SHA-pinned URL → `render_start(approved: true)`.

Change wording: `project_apply_script` **replaces all scenes**, so scene backgrounds must be
re-assigned afterwards. Cheaper to edit one line via the scene tools if you can.

Render history, oldest → newest:

| render id | what |
|---|---|
| `cmsy0wx2f000bl604krwdeohh` | v1 base, Subway Surfers, no product |
| `cmsy1e2x0000fjq04bph3kyqp` | v2 image overlays over gameplay |
| `cmsy1zuud0003ld04o8q8zcj0` | v3 gameplay removed — but landscape crops, mostly black |
| `cmsy26vvu0007ld04swe8z8gl` | v4 portrait capture, frame-filling UI |
| `cmsy2lk910003jm04xe0g8rls` | **v5 FINAL** — chaos cold open added |

The path from v1 to v5 is the actual lesson: gameplay background was rejected as wrong for a
product video; image overlays over gameplay were still "mostly gameplay"; landscape crops in a
9:16 frame were mostly black. **Portrait capture is what made it work.**

---

## 8. Known gaps

- **No URL on the end card.** Beat 11 says "Glooker. Built by Smartling." but nothing shows
  `github.com/Smartling/glooker`. The CTA is a repo visit, so this is the most valuable single
  fix — one text overlay over the last ~2s, one render.
- **Beat 1 is still a quiet dark frame.** Deliberate (it makes the chaos land), but it's the
  weakest 2.5s and worth A/B-ing.
- **The `$/COMMIT` column isn't readable at phone size** in the spenders shot. Reads as "a real
  dashboard with real numbers", which may be enough. A tighter crop would make the number
  legible if it matters.
- **The README is what converts** anyone the video sends to the repo, and it currently opens with
  implementation detail ("pulls commit history, runs LLM-based analysis") rather than the
  spend-vs-output hook the video sells.
- **No board footage** until GLOOK-42 lands (see §4).

## 9. Related tickets

- **GLOOK-41** — org report 500s on SQLite (`DATE_ADD` untranslated). **Blocks capturing the
  Spend tab.** PR #67.
- **GLOOK-42** — mock dataset too thin to demo the Projects boards. Blocks board footage.
- **GLOOK-38** — the per-project boards feature the boards would show. Merged (PR #66).
