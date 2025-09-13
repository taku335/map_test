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
    const stopsBuffer = await zip.file('stops.txt').async('arraybuffer');
    const stopsTxt = new TextDecoder('shift_jis').decode(stopsBuffer);
    const stopMap = new Map();

    await new Promise((resolve) => {
      Papa.parse(stopsTxt, {
        header: true,
        skipEmptyLines: true,
        complete: function (results) {
          results.data.forEach((stop) => {
            if (stop.stop_lat && stop.stop_lon) {
                const lat = parseFloat(stop.stop_lat);
                const lon = parseFloat(stop.stop_lon);
                L.marker([lat, lon], { icon: busIcon })
                  .addTo(map)
                  .bindPopup(stop.stop_name);
                stopMap.set(stop.stop_id, [lat, lon]);
              }
            });
          resolve();
        },
      });
    });

    const stopTimesBuffer = await zip.file('stop_times.txt').async('arraybuffer');
    const stopTimesTxt = new TextDecoder('shift_jis').decode(stopTimesBuffer);
    await new Promise((resolve) => {
      Papa.parse(stopTimesTxt, {
        header: true,
        skipEmptyLines: true,
        complete: function (results) {
          const trips = {};
          results.data.forEach((st) => {
            const trip = trips[st.trip_id] || [];
            trip.push(st);
            trips[st.trip_id] = trip;
          });

          Object.values(trips).forEach((times) => {
            times.sort(
              (a, b) => parseInt(a.stop_sequence, 10) - parseInt(b.stop_sequence, 10)
            );
            const latlngs = times
              .map((t) => stopMap.get(t.stop_id))
              .filter(Boolean);
            if (latlngs.length > 1) {
              L.polyline(latlngs, { color: 'blue', weight: 2, opacity: 0.5 }).addTo(
                map
              );
            }
          });
          resolve();
        },
      });
    });
  } catch (err) {
    console.error('Failed to load GTFS data:', err);
  }
}

document.addEventListener('DOMContentLoaded', initMap);

