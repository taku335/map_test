const GTFS_ZIP_URL =
  'https://api.gtfs-data.jp/v2/organizations/kariyacity/feeds/communitybus/files/feed.zip?rid=next';

document.addEventListener('DOMContentLoaded', initMap);

async function initMap() {
  const map = L.map('map').setView([34.9896, 137.0025], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);

  const routeInfoContainer = document.getElementById('route-info');
  if (routeInfoContainer) {
    routeInfoContainer.textContent = '路線情報を読み込み中…';
  }

  const busIcon = L.icon({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [50, 82],
    iconAnchor: [25, 82],
    popupAnchor: [1, -76],
    shadowSize: [82, 82],
    shadowAnchor: [25, 82],
  });

  try {
    const { stops, trips, routes, shapes } = await loadGtfsData(GTFS_ZIP_URL);
    plotStops(map, stops, busIcon);
    const shapeToRoute = buildShapeToRoute(trips);
    const routeDetails = buildRouteDetails(routes);
    const activeRoutes = drawRoutes(map, shapes, shapeToRoute, routeDetails);
    renderRouteInfo(routeDetails, activeRoutes);
  } catch (err) {
    console.error('Failed to load GTFS data:', err);
    if (routeInfoContainer) {
      routeInfoContainer.textContent = 'GTFSデータの読み込みに失敗しました。';
    }
  }
}

async function loadGtfsData(url) {
  const zip = await fetchGtfsZip(url);
  const [stops, trips, routes, shapes] = await Promise.all([
    parseShiftJisCsv(zip, 'stops.txt'),
    parseShiftJisCsv(zip, 'trips.txt'),
    parseShiftJisCsv(zip, 'routes.txt'),
    parseShiftJisCsv(zip, 'shapes.txt'),
  ]);
  return { stops, trips, routes, shapes };
}

async function fetchGtfsZip(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download GTFS feed: ${response.status}`);
  }
  const blob = await response.blob();
  return JSZip.loadAsync(blob);
}

async function parseShiftJisCsv(zip, filename) {
  const file = zip.file(filename);
  if (!file) {
    throw new Error(`${filename} がGTFSフィードに含まれていません`);
  }
  const buffer = await file.async('arraybuffer');
  const text = new TextDecoder('shift_jis').decode(buffer);
  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      complete: ({ data }) => resolve(data),
      error: reject,
    });
  });
}

function plotStops(map, stops, icon) {
  stops.forEach((stop) => {
    if (!stop.stop_lat || !stop.stop_lon) {
      return;
    }
    const lat = parseFloat(stop.stop_lat);
    const lon = parseFloat(stop.stop_lon);
    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      return;
    }
    L.marker([lat, lon], { icon })
      .addTo(map)
      .bindPopup(stop.stop_name || '停留所名未設定');
  });
}

function buildShapeToRoute(trips) {
  const mapping = new Map();
  trips.forEach((trip) => {
    if (trip.shape_id && trip.route_id && !mapping.has(trip.shape_id)) {
      mapping.set(trip.shape_id, trip.route_id);
    }
  });
  return mapping;
}

function buildRouteDetails(routes) {
  const details = new Map();
  routes.forEach((route) => {
    const color = route.route_color ? `#${route.route_color}` : '#0066cc';
    const shortName = (route.route_short_name || '').trim();
    const longName = (route.route_long_name || '').trim();
    const description = (route.route_desc || '').trim();
    const displayLabel =
      longName || shortName || description || route.route_id || '不明な路線';
    details.set(route.route_id, {
      color,
      shortName,
      longName,
      description,
      displayLabel,
    });
  });
  return details;
}

function drawRoutes(map, shapes, shapeToRoute, routeDetails) {
  const pointsByShapeId = groupShapePointsById(shapes);
  const activeRoutes = new Set();

  pointsByShapeId.forEach((points, shapeId) => {
    const routeId = shapeToRoute.get(shapeId);
    if (!routeId) {
      return;
    }

    const details = routeDetails.get(routeId);
    if (points.length < 2) {
      return;
    }

    const latlngs = points
      .sort((a, b) => a.sequence - b.sequence)
      .map(({ lat, lon }) => [lat, lon]);

    const color = details?.color || '#0066cc';
    const polyline = L.polyline(latlngs, {
      color,
      weight: 3,
      opacity: 0.75,
    }).addTo(map);

    const labelParts = [];
    if (details?.shortName) {
      labelParts.push(details.shortName);
    }
    if (details?.longName && details.longName !== details.shortName) {
      labelParts.push(details.longName);
    }

    const popupLabel =
      labelParts.length > 0
        ? labelParts.join(' / ')
        : details?.displayLabel || `路線ID: ${routeId}`;
    polyline.bindPopup(`<strong>${popupLabel}</strong>`);
    activeRoutes.add(routeId);
  });

  return activeRoutes;
}

function groupShapePointsById(shapes) {
  const grouped = new Map();
  shapes.forEach((shape) => {
    const shapeId = shape.shape_id;
    if (!shapeId) {
      return;
    }

    const lat = parseFloat(shape.shape_pt_lat);
    const lon = parseFloat(shape.shape_pt_lon);
    const sequence = parseInt(shape.shape_pt_sequence, 10);

    if (
      Number.isNaN(lat) ||
      Number.isNaN(lon) ||
      Number.isNaN(sequence)
    ) {
      return;
    }

    const points = grouped.get(shapeId) || [];
    points.push({ lat, lon, sequence });
    grouped.set(shapeId, points);
  });
  return grouped;
}

function renderRouteInfo(routeDetails, activeRoutes = new Set()) {
  const container = document.getElementById('route-info');
  if (!container) {
    return;
  }

  const entries = Array.from(routeDetails.entries()).filter(([routeId]) =>
    activeRoutes.size === 0 ? true : activeRoutes.has(routeId)
  );

  if (entries.length === 0) {
    container.textContent = '路線情報を取得できませんでした。';
    return;
  }

  entries.sort((a, b) =>
    a[1].displayLabel.localeCompare(b[1].displayLabel, 'ja')
  );

  container.innerHTML = '';

  const heading = document.createElement('h2');
  heading.textContent = '運行中のコミュニティバス路線';
  container.appendChild(heading);

  const list = document.createElement('ul');

  entries.forEach(([, details]) => {
    const item = document.createElement('li');

    const colorBox = document.createElement('span');
    colorBox.className = 'route-color';
    colorBox.style.backgroundColor = details.color;

    const namesWrapper = document.createElement('span');
    namesWrapper.className = 'route-names';

    if (details.shortName) {
      const shortEl = document.createElement('span');
      shortEl.className = 'route-short';
      shortEl.textContent = details.shortName;
      namesWrapper.appendChild(shortEl);
    }

    const longLabel =
      details.longName && details.longName !== details.shortName
        ? details.longName
        : details.description && !details.shortName
        ? details.description
        : '';

    if (longLabel) {
      const longEl = document.createElement('span');
      longEl.className = 'route-long';
      longEl.textContent = longLabel;
      namesWrapper.appendChild(longEl);
    }

    if (namesWrapper.childElementCount === 0) {
      const fallback = document.createElement('span');
      fallback.className = 'route-long';
      fallback.textContent = details.displayLabel;
      namesWrapper.appendChild(fallback);
    }

    item.appendChild(colorBox);
    item.appendChild(namesWrapper);
    list.appendChild(item);
  });

  container.appendChild(list);
}

