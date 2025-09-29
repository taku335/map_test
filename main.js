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

  const GTFS_ZIP_URL =
    'https://api.gtfs-data.jp/v2/organizations/kariyacity/feeds/communitybus/files/feed.zip?rid=next';
  try {
    const response = await fetch(GTFS_ZIP_URL);
    const blob = await response.blob();
    const zip = await JSZip.loadAsync(blob);
    // ----------------------
    //   Parse stops.txt
    // ----------------------
    const stopsBuffer = await zip.file('stops.txt').async('arraybuffer');
    const stopsTxt = new TextDecoder('shift_jis').decode(stopsBuffer);
    await new Promise((resolve) => {
      Papa.parse(stopsTxt, {
        header: true,
        skipEmptyLines: true,
        complete: ({ data }) => {
          data.forEach((stop) => {
            if (stop.stop_lat && stop.stop_lon) {
              const lat = parseFloat(stop.stop_lat);
              const lon = parseFloat(stop.stop_lon);
              L.marker([lat, lon], { icon: busIcon })
                .addTo(map)
                .bindPopup(stop.stop_name);
            }
          });
          resolve();
        },
      });
    });

    // ----------------------
    //   Parse trips.txt
    // ----------------------
    const shapeToRoute = new Map();
    const tripsBuffer = await zip.file('trips.txt').async('arraybuffer');
    const tripsTxt = new TextDecoder('shift_jis').decode(tripsBuffer);
    await new Promise((resolve) => {
      Papa.parse(tripsTxt, {
        header: true,
        skipEmptyLines: true,
        complete: ({ data }) => {
          data.forEach((trip) => {
            if (trip.shape_id) {
              shapeToRoute.set(trip.shape_id, trip.route_id);
            }
          });
          resolve();
        },
      });
    });

    // ----------------------
    //   Parse routes.txt
    // ----------------------
    const routeDetails = new Map();
    const routesBuffer = await zip.file('routes.txt').async('arraybuffer');
    const routesTxt = new TextDecoder('shift_jis').decode(routesBuffer);
    await new Promise((resolve) => {
      Papa.parse(routesTxt, {
        header: true,
        skipEmptyLines: true,
        complete: ({ data }) => {
          data.forEach((route) => {
            const color = route.route_color
              ? `#${route.route_color}`
              : 'blue';
            const shortName = (route.route_short_name || '').trim();
            const longName = (route.route_long_name || '').trim();
            const description = (route.route_desc || '').trim();
            const displayLabel =
              longName || shortName || description || route.route_id;
            routeDetails.set(route.route_id, {
              color,
              shortName,
              longName,
              description,
              displayLabel,
            });
          });
          resolve();
        },
      });
    });

    // ----------------------
    //   Parse shapes.txt
    // ----------------------
    const shapesBuffer = await zip.file('shapes.txt').async('arraybuffer');
    const shapesTxt = new TextDecoder('shift_jis').decode(shapesBuffer);
    const shapePoints = new Map();
    const activeRoutes = new Set();
    await new Promise((resolve) => {
      Papa.parse(shapesTxt, {
        header: true,
        skipEmptyLines: true,
        complete: ({ data }) => {
          data.forEach((s) => {
            const arr = shapePoints.get(s.shape_id) || [];
            arr.push({
              seq: parseInt(s.shape_pt_sequence, 10),
              lat: parseFloat(s.shape_pt_lat),
              lon: parseFloat(s.shape_pt_lon),
            });
            shapePoints.set(s.shape_id, arr);
          });
          resolve();
        },
      });
    });

    shapePoints.forEach((points, shapeId) => {
      const latlngs = points
        .sort((a, b) => a.seq - b.seq)
        .map((p) => [p.lat, p.lon]);
      if (latlngs.length > 1) {
        const routeId = shapeToRoute.get(shapeId);
        const details = routeDetails.get(routeId);
        if (routeId) {
          activeRoutes.add(routeId);
        }
        const color = details?.color || 'blue';
        const polyline = L.polyline(latlngs, {
          color,
          weight: 3,
          opacity: 0.7,
        }).addTo(map);

        const nameParts = [];
        if (details?.shortName) {
          nameParts.push(details.shortName);
        }
        if (details?.longName && details.longName !== details.shortName) {
          nameParts.push(details.longName);
        }
        const popupLabel =
          nameParts.length > 0
            ? nameParts.join(' / ')
            : details?.displayLabel || `路線ID: ${routeId || '不明'}`;
        polyline.bindPopup(`<strong>${popupLabel}</strong>`);
      }
    });

    renderRouteInfo(routeDetails, activeRoutes);
  } catch (err) {
    console.error('Failed to load GTFS data:', err);
    if (routeInfoContainer) {
      routeInfoContainer.textContent = 'GTFSデータの読み込みに失敗しました。';
    }
  }
}

document.addEventListener('DOMContentLoaded', initMap);

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

