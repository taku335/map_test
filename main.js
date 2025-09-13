async function initMap() {
  const map = L.map('map').setView([34.9896, 137.0025], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);

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
    const routeColors = new Map();
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
            routeColors.set(route.route_id, color);
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
        const color = routeColors.get(routeId) || 'blue';
        L.polyline(latlngs, { color, weight: 3, opacity: 0.7 }).addTo(map);
      }
    });
  } catch (err) {
    console.error('Failed to load GTFS data:', err);
  }
}

document.addEventListener('DOMContentLoaded', initMap);

