# Media library and visual selection

Photography first. Maps for places. Approved product images for partners. A designed graphic only when nothing else is honest.

## 1. What already existed (reused, nothing new added)

| Need | Reused |
|---|---|
| Rendering | HTML/CSS through headless Chromium (`api/_lib/social/render.js`, same launcher as the lab PDF) |
| Brand | `icons/logo-wave.png`, Bebas Neue + DM Sans, navy/blue/orange |
| Maps | The CARTO key and OpenStreetMap attribution already used on `/explore` (SwimLoading's own free commercial key, 1M tiles/month; its terms require the attribution to stay visible, and it is drawn on every map image) |
| Photos | Three founder photographs on `/partner-kit` (underwater swimmer, swimmer with whale, Table Mountain in mist), the `/spots` curated venue facts, partner logos |
| Storage | No existing media storage in the repo (Supabase Storage is only used for avatars). Originals go to a **private** bucket when the migration is approved; until then files sit in `media-library/files/` |

Gaps found: **no approved product photography** for any partner (Maurten has only a 113x83 px logo); no photographs of specific spots except two verified Wikimedia Commons images; photographer, consent and licence were never recorded for the existing photos.

## 2. Google Photos: how to bring the three albums in

Shared album links cannot be imported programmatically, and I did not try to scrape them. As I understand Google's current policy (re-verify before relying on it): the Photos Library API only reads items an app uploaded itself, and its replacement, the Photos Picker API, needs an interactive person-picks-photos session that returns links which expire within about an hour. Neither suits unattended publishing, and temporary Google URLs must not be stored.

Supported route (about ten minutes per album, then never again):

1. Open each album in Google Photos, choose the three-dot menu, **Download all**. Unzip.
2. Dry-run, then import:

```bash
node scripts/import-media.mjs ~/Downloads/Bakoven --album "K8 Bakoven" --owner "Dave Welensky" --approve --people none --dry-run
node scripts/import-media.mjs ~/Downloads/Bakoven --album "K8 Bakoven" --owner "Dave Welensky" --approve --people none --manifest bakoven.csv
```

* Without `--approve`, photos import **unapproved** and are never selected.
* `--people none|some` is required with `--approve` (identifiable swimmers need recorded consent, otherwise posts using them go to review).
* Optional `manifest.csv`: `filename,location,country,spot,region,subject,tags,photographer,session`. Set `spot` only when the photo documents exactly that SwimLoading spot (for example `Bakoven`); set `region` (for example `Cape Town`) when the beach is unknown; leave both empty for generic open-water imagery.
* Near-duplicates of photos already in the catalogue are skipped automatically. Photos from one album within the same three-hour block share a session.
* Run `node --test` afterwards; the catalogue test checks every file loads and has a hash.

Founder effort afterwards: drop new photos in occasionally and run one command. No per-post choosing.

## 3. Catalogue

`media-library/catalogue.json` (table design in `sql/proposed/2026-10-18_media-assets_PROPOSED.sql`, **not applied**). Per image: id, file, original filename, owner, photographer, source album, location, country, related spot / region / crossing / partner, tags, orientation and size, permission (`owned`, `cc-by`, `cc-by-sa`, `partner-supplied`), attribution, `approvedForSocial`, `provenanceConfirmed`, identifiable-people and consent, `subject`, `sessionId`, `dhash`, crop focus.

**`subject` is the key honesty field.** `location` means the photo documents a real place (linked to a spot, or to a region such as Cape Town). `generic` means open-water imagery that may only illustrate, and is labelled "Illustrative photo" on the image.

## 4. Selection (deterministic, `api/_lib/social/media.js`)

1. A photograph documenting the exact spot or crossing (the spot id must match; a Bakoven photo can never stand in for Tooting Bec Lido).
2. An approved partner product image.
3. A licensed map of the real coordinates (for geographically specific posts).
4. An approved thematic photograph (regional photos only for their region; generic photos for anything, labelled illustrative).
5. A designed branded graphic.

Photography first: a post with no specific place (general swimming, community, events from many countries) tries founder photography before any map. Excluded outright: unapproved, missing, or too low resolution (a full-bleed crop may enlarge a source at most 1.6x).

**Rotation and near-duplicates:** a photograph is skipped if it is the same session as, or visually near-identical (dHash distance <= 10 of 64) to, any of the last 3 photographs used, or if it was itself used in the last 21 days. If no alternative exists the least recently used is reused and the stored reason says so. The chosen asset, tier and reason are stored with each post.

## 5. Visual approaches

* **Photography-led:** edge-to-edge photograph, no tint, a gradient only behind the text, headline, one line, one chip, small credit.
* **Map-led:** CARTO dark map of real coordinates with labelled pins, "Indicative route" on crossings, attribution on the image.
* **Product-led:** large approved product photograph with partner logo. With none available it uses an illustrative swimming photograph and says "not a product image".
* **Branded graphic:** the v1 designed card, only as a fallback.

Quality gate before a post is eligible: image exists and is approved; resolution; location accuracy; attribution present where licensed; **no clipping; headline contrast >= 3:1 measured on the actual pixels behind the text; images and map tiles loaded; rendered template matches the intended one**. Face-cropping cannot be detected automatically, so each photo carries a crop focus set at import (default centre).

## 6. Findings that need you

1. **Photo provenance.** The three founder photographs have no recorded photographer, album or consent. They are marked approved but `provenanceConfirmed: false`, so any post using one routes to review until you confirm once (flip the flag in the catalogue, or import the originals from your albums).
2. **Share-alike photographs.** Both exact-location photos are CC BY-SA. One policy decision (`media.acceptShareAlike`, default off) covers all current and future ones.
3. **Only one generic photograph** (underwater) exists, so rotation cannot work yet: Maurten and the events cover both use it. Importing the albums fixes this; roughly 15 to 20 varied photographs from separate swims is a comfortable minimum for three posts a week.
4. **No product photography** for Maurten (or any partner). Ask the partner or its distributor for approved pack shots; the product-led template and selector will use them automatically once added with `kind: "product"`.
5. Some Explore events have no venue coordinates, so those carousel slides fall back to a designed graphic.
