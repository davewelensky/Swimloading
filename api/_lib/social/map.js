// Licensed map layer: CARTO "dark_all" raster tiles (SwimLoading's own free commercial key, the one
// /explore already ships; its terms require the attribution below to stay visible) built on
// OpenStreetMap data (ODbL, attribution required). A post uses a handful of tiles, so volume is trivial
// against the 1M/month allowance. Pure projection maths: no map library.
import { readFileSync } from 'node:fs';

const CARTO_KEY = process.env.CARTO_KEY || (() => {
  try { return /CARTO_KEY\s*=\s*'([^']+)'/.exec(readFileSync(new URL('../../../explore.html', import.meta.url), 'utf8'))?.[1]; } catch { return null; }
})();
export const MAP_ATTRIBUTION = '© OpenStreetMap contributors © CARTO';
const TILE = 256;
const px = (lat, lng, z) => {
  const s = TILE * 2 ** z, r = (lat * Math.PI) / 180;
  return { x: ((lng + 180) / 360) * s, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * s };
};

/**
 * @param points [{lat,lng}] that must all be visible
 * @param rect   {x0,y0,x1,y1} area of the 1080x1350 canvas the points must fit inside (the rest shows more map)
 * @returns { z, project(lat,lng)->{x,y}, tilesHtml }
 */
export function mapView(points, rect, { W = 1080, H = 1350, maxZoom = 13, minZoom = 3 } = {}) {
  if (!CARTO_KEY) throw new Error('CARTO key not found: set CARTO_KEY');
  const rw = rect.x1 - rect.x0, rh = rect.y1 - rect.y0;
  let z = maxZoom;
  for (; z > minZoom; z--) {
    const p = points.map((q) => px(q.lat, q.lng, z));
    const w = Math.max(...p.map((a) => a.x)) - Math.min(...p.map((a) => a.x));
    const h = Math.max(...p.map((a) => a.y)) - Math.min(...p.map((a) => a.y));
    if (w <= rw && h <= rh) break;
  }
  const p = points.map((q) => px(q.lat, q.lng, z));
  const cx = (Math.min(...p.map((a) => a.x)) + Math.max(...p.map((a) => a.x))) / 2;
  const cy = (Math.min(...p.map((a) => a.y)) + Math.max(...p.map((a) => a.y))) / 2;
  const left = cx - (rect.x0 + rw / 2), top = cy - (rect.y0 + rh / 2);
  const project = (lat, lng) => { const a = px(lat, lng, z); return { x: a.x - left, y: a.y - top }; };
  const n = 2 ** z, tiles = [];
  for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + W) / TILE); tx++) {
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + H) / TILE); ty++) {
      if (ty < 0 || ty >= n) continue;
      const wx = ((tx % n) + n) % n, sub = 'abcd'[(wx + ty) % 4];
      tiles.push(`<img src="https://${sub}.basemaps.cartocdn.com/dark_all/${z}/${wx}/${ty}@2x.png?key=${CARTO_KEY}" style="position:absolute;left:${Math.round(tx * TILE - left)}px;top:${Math.round(ty * TILE - top)}px;width:${TILE}px;height:${TILE}px" alt="">`);
    }
  }
  return { z, project, tilesHtml: `<div class="mapbg" data-map-z="${z}">${tiles.join('')}</div>` };
}
