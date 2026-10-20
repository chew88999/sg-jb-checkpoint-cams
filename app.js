// SG–JB Checkpoint Cams
// Data: data.gov.sg traffic images, OneMap search (SG addresses), OSRM routing.

const TRAFFIC_API = 'https://api.data.gov.sg/v1/transport/traffic-images';
const ONEMAP_SEARCH = 'https://www.onemap.gov.sg/api/common/elastic/search';
const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
const REFRESH_MS = 60_000;

// LTA camera names (the API only gives IDs and coordinates).
const CAMERA_NAMES = {
  '2701': 'Woodlands Causeway (towards Johor)',
  '2702': 'Woodlands Checkpoint (towards BKE)',
  '2703': 'BKE Sungei Kadut',
  '2704': 'BKE Woodlands Flyover (towards Checkpoint)',
  '2705': 'BKE Mandai Rd entrance',
  '4703': 'Tuas Second Link',
  '4712': 'AYE after Tuas West Rd',
  '4713': 'Tuas Checkpoint',
  '4714': 'AYE near West Coast Walk',
  '4798': 'Sentosa Gateway (towards Telok Blangah)',
  '4799': 'Sentosa Gateway (towards Sentosa)',
};

const CHECKPOINTS = {
  woodlands: {
    name: 'Woodlands Causeway',
    color: 'var(--woodlands)',
    cameras: ['2701', '2702', '2703', '2704', '2705'],
    // A point on the Causeway itself, so the route is forced across it.
    via: [1.4564, 103.7699],
  },
  tuas: {
    name: 'Tuas Second Link',
    color: 'var(--tuas)',
    cameras: ['4703', '4712', '4713', '4714'],
    // A point on the Second Link bridge.
    via: [1.3582, 103.6230],
  },
};

// Fixed destination: JB Sentral (Customs & Immigration Complex drop-off road).
const DEST = { name: 'JB Sentral', at: [1.4629, 103.7651] };

// ---------- Map ----------

const map = L.map('map', { zoomControl: true }).setView([1.40, 103.72], 11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors · Cameras: LTA via data.gov.sg · Routing: OSRM',
}).addTo(map);

const cameraLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);
let originMarker = null;
let destMarker = null;
let origin = null;          // [lat, lng]

const pin = (emoji) => L.divIcon({
  className: '',
  html: `<div style="font-size:26px;line-height:26px;transform:translate(-50%,-100%)">${emoji}</div>`,
  iconSize: [0, 0],
});

function setOrigin(latlng, label) {
  origin = latlng;
  if (originMarker) originMarker.remove();
  originMarker = L.marker(latlng, { icon: pin('🟢'), title: 'Start' })
    .bindTooltip(label || 'Start')
    .addTo(map);
  if (label) $('#originSearch').value = label;
}

function setDestMarker(latlng, label) {
  if (destMarker) destMarker.remove();
  destMarker = L.marker(latlng, { icon: pin('🏁'), title: 'Destination' })
    .bindTooltip(label)
    .addTo(map);
}

map.on('click', (e) => {
  const latlng = [e.latlng.lat, e.latlng.lng];
  setOrigin(latlng, `Map point (${latlng[0].toFixed(4)}, ${latlng[1].toFixed(4)})`);
});

// ---------- Helpers ----------

function $(sel) { return document.querySelector(sel); }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDuration(sec) {
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

function cameraName(id) { return CAMERA_NAMES[id] || `Camera ${id}`; }

function checkpointOf(id) {
  return Object.keys(CHECKPOINTS).find((k) => CHECKPOINTS[k].cameras.includes(id)) || 'other';
}

// ---------- Traffic cameras ----------

let cameras = [];

async function loadCameras() {
  $('#refresh').disabled = true;
  try {
    const res = await fetch(TRAFFIC_API);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const item = data.items && data.items[0];
    cameras = (item && item.cameras) || [];
    $('#updated').textContent = item
      ? `${cameras.length} cameras · updated ${fmtTime(item.timestamp)}`
      : 'No camera data returned';
    renderCameras();
  } catch (err) {
    $('#updated').textContent = `Could not load cameras (${err.message})`;
  } finally {
    $('#refresh').disabled = false;
  }
}

function renderCameras() {
  cameraLayer.clearLayers();

  const groups = { woodlands: [], tuas: [], other: [] };
  for (const cam of cameras) groups[checkpointOf(cam.camera_id)].push(cam);

  const titles = { woodlands: 'Woodlands Checkpoint', tuas: 'Tuas Checkpoint', other: 'Other cameras' };
  $('#groups').innerHTML = Object.entries(groups)
    .filter(([, list]) => list.length)
    .map(([key, list]) => `
      <div class="group">
        <h3>${key !== 'other' ? `<span class="swatch" style="width:10px;height:10px;border-radius:50%;background:${CHECKPOINTS[key].color}"></span>` : ''}${titles[key]}</h3>
        <div class="cams">${list.map(camFigure).join('')}</div>
      </div>`)
    .join('') || '<p class="muted">No cameras available.</p>';

  for (const cam of cameras) {
    const { latitude, longitude } = cam.location;
    const key = checkpointOf(cam.camera_id);
    const color = key === 'other' ? '#868e96' : getComputedStyle(document.documentElement)
      .getPropertyValue(key === 'woodlands' ? '--woodlands' : '--tuas').trim();
    L.circleMarker([latitude, longitude], {
      radius: 8, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1,
    })
      .bindPopup(`<div class="popup"><img src="${escapeHtml(cam.image)}" alt=""><p><b>${escapeHtml(cameraName(cam.camera_id))}</b><br>${fmtTime(cam.timestamp)}</p></div>`, { maxWidth: 300 })
      .bindTooltip(cameraName(cam.camera_id))
      .addTo(cameraLayer);
  }
}

function camFigure(cam) {
  return `
    <figure class="cam" data-src="${escapeHtml(cam.image)}" data-caption="${escapeHtml(cameraName(cam.camera_id))} · ${fmtTime(cam.timestamp)}">
      <img src="${escapeHtml(cam.image)}" alt="${escapeHtml(cameraName(cam.camera_id))}" loading="lazy">
      <figcaption><b>${escapeHtml(cameraName(cam.camera_id))}</b><br>${fmtTime(cam.timestamp)}</figcaption>
    </figure>`;
}

document.addEventListener('click', (e) => {
  const fig = e.target.closest('.cam');
  if (!fig) return;
  const box = $('#lightbox');
  box.querySelector('img').src = fig.dataset.src;
  box.querySelector('p').textContent = fig.dataset.caption;
  box.hidden = false;
});
$('#lightbox').addEventListener('click', () => { $('#lightbox').hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#lightbox').hidden = true; });

$('#refresh').addEventListener('click', loadCameras);

// ---------- Origin search (OneMap) ----------

let searchTimer = null;
$('#originSearch').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length < 2) { $('#suggestions').hidden = true; return; }
  searchTimer = setTimeout(() => searchOneMap(q), 300);
});

async function searchOneMap(q) {
  try {
    const url = `${ONEMAP_SEARCH}?searchVal=${encodeURIComponent(q)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
    const data = await (await fetch(url)).json();
    const results = (data.results || []).slice(0, 8);
    const ul = $('#suggestions');
    if (!results.length) { ul.hidden = true; return; }
    ul.innerHTML = results.map((r, i) =>
      `<li data-i="${i}"><b>${escapeHtml(r.SEARCHVAL)}</b><br><span class="muted">${escapeHtml(r.ADDRESS)}</span></li>`).join('');
    ul.hidden = false;
    ul.onclick = (ev) => {
      const li = ev.target.closest('li');
      if (!li) return;
      const r = results[li.dataset.i];
      const latlng = [parseFloat(r.LATITUDE), parseFloat(r.LONGITUDE)];
      setOrigin(latlng, r.SEARCHVAL);
      map.setView(latlng, 13);
      ul.hidden = true;
    };
  } catch {
    $('#suggestions').hidden = true;
  }
}

$('#locate').addEventListener('click', () => {
  if (!navigator.geolocation) { alert('Geolocation is not supported by this browser.'); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const latlng = [pos.coords.latitude, pos.coords.longitude];
      setOrigin(latlng, 'My location');
      map.setView(latlng, 13);
    },
    (err) => alert(`Could not get your location: ${err.message}`),
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

// ---------- Routing ----------

async function routeVia(key, from, to) {
  const pts = [from, CHECKPOINTS[key].via, to].map(([lat, lng]) => `${lng},${lat}`).join(';');
  const res = await fetch(`${OSRM}${pts}?overview=full&geometries=geojson`);
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes.length) throw new Error(data.message || data.code);
  const r = data.routes[0];
  return { key, distance: r.distance, duration: r.duration, coords: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]) };
}

$('#go').addEventListener('click', findRoute);

async function findRoute() {
  const out = $('#routeResult');
  const dest = DEST;
  if (!origin) { out.innerHTML = '<p class="error">Set a start point first: search, use 📍, or click the map.</p>'; return; }
  $('#go').disabled = true;
  out.innerHTML = '<p class="note">Comparing routes via Woodlands and Tuas…</p>';

  try {
    const results = await Promise.allSettled(Object.keys(CHECKPOINTS).map((k) => routeVia(k, origin, dest.at)));
    const routes = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    if (!routes.length) throw new Error('No route found');

    routes.sort((a, b) => a.distance - b.distance);
    const shortest = routes[0];
    const fastest = routes.reduce((a, b) => (b.duration < a.duration ? b : a));

    drawRoutes(routes, shortest.key);
    out.innerHTML = routes.map((r) => optionHtml(r, r === shortest, r === fastest)).join('')
      + (shortest !== fastest ? `<p class="note">Shortest distance is via ${CHECKPOINTS[shortest.key].name}, but ${CHECKPOINTS[fastest.key].name} is faster by road speed.</p>` : '')
      + '<p class="note">Times are free-flow driving estimates and exclude checkpoint queues. Check the live cameras below for jams before you go.</p>';

    out.querySelectorAll('.option').forEach((el) => {
      el.addEventListener('click', () => drawRoutes(routes, el.dataset.key));
    });
  } catch (err) {
    out.innerHTML = `<p class="error">Routing failed: ${escapeHtml(err.message)}</p>`;
  } finally {
    $('#go').disabled = false;
  }
}

function optionHtml(r, isShortest, isFastest) {
  const cp = CHECKPOINTS[r.key];
  const badges = [isShortest && 'Shortest', isFastest && 'Fastest'].filter(Boolean).join(' · ');
  return `
    <div class="option ${isShortest ? 'best' : ''}" data-key="${r.key}">
      <div class="title"><span class="swatch" style="background:${cp.color}"></span>Via ${cp.name}${badges ? `<span class="badge">${badges}</span>` : ''}</div>
      <div class="stats">${(r.distance / 1000).toFixed(1)} km · ~${fmtDuration(r.duration)}</div>
    </div>`;
}

function drawRoutes(routes, highlightKey) {
  routeLayer.clearLayers();
  const css = getComputedStyle(document.documentElement);
  // Draw the highlighted route last so it sits on top.
  const ordered = [...routes].sort((a, b) => (a.key === highlightKey) - (b.key === highlightKey));
  for (const r of ordered) {
    const on = r.key === highlightKey;
    L.polyline(r.coords, {
      color: css.getPropertyValue(r.key === 'woodlands' ? '--woodlands' : '--tuas').trim(),
      weight: on ? 6 : 4,
      opacity: on ? 0.95 : 0.45,
      dashArray: on ? null : '6 8',
    }).bindTooltip(`Via ${CHECKPOINTS[r.key].name}`).addTo(routeLayer);
  }
  map.fitBounds(L.latLngBounds(routes.flatMap((r) => r.coords)), { padding: [30, 30] });
  document.querySelectorAll('.option').forEach((el) => el.classList.toggle('best', el.dataset.key === highlightKey));
}

// ---------- Start ----------

setDestMarker(DEST.at, DEST.name);
loadCameras();
setInterval(loadCameras, REFRESH_MS);
