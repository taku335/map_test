async function initMap() {
  const map = L.map('map').setView([34.9896, 137.0025], 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const GTFS_ZIP_URL = './kariya_gtfs.zip'; // Replace with actual URL or local path
  try {
    const response = await fetch(GTFS_ZIP_URL);
    const blob = await response.blob();
    const zip = await JSZip.loadAsync(blob);
    const stopsTxt = await zip.file('stops.txt').async('string');
    Papa.parse(stopsTxt, {
      header: true,
      skipEmptyLines: true,
      complete: function (results) {
        results.data.forEach((stop) => {
          if (stop.stop_lat && stop.stop_lon) {
            L.marker(
              [parseFloat(stop.stop_lat), parseFloat(stop.stop_lon)],
              { title: stop.stop_name }
            ).addTo(map);
          }
        });
      },
    });
  } catch (err) {
    console.error('Failed to load GTFS data:', err);
  }
}

document.addEventListener('DOMContentLoaded', initMap);
