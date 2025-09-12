async function initMap() {
  const map = L.map('map').setView([34.9896, 137.0025], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);

  const GTFS_ZIP_URL =
    'https://api.gtfs-data.jp/v2/organizations/kariyacity/feeds/communitybus/files/feed.zip?rid=next';
  try {
    const response = await fetch(GTFS_ZIP_URL);
    const blob = await response.blob();
    const zip = await JSZip.loadAsync(blob);
    const stopsBuffer = await zip.file('stops.txt').async('arraybuffer');
    const stopsTxt = new TextDecoder('shift_jis').decode(stopsBuffer);
    Papa.parse(stopsTxt, {
      header: true,
      skipEmptyLines: true,
      complete: function (results) {
        results.data.forEach((stop) => {
          if (stop.stop_lat && stop.stop_lon) {
            L.marker([parseFloat(stop.stop_lat), parseFloat(stop.stop_lon)])
              .addTo(map)
              .bindPopup(stop.stop_name);
          }
        });
      },
    });
  } catch (err) {
    console.error('Failed to load GTFS data:', err);
  }
}

document.addEventListener('DOMContentLoaded', initMap);

