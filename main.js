async function initMap() {
  const map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 34.9896, lng: 137.0025 },
    zoom: 13,
  });

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
            new google.maps.Marker({
              position: { lat: parseFloat(stop.stop_lat), lng: parseFloat(stop.stop_lon) },
              map,
              title: stop.stop_name,
            });
          }
        });
      },
    });
  } catch (err) {
    console.error('Failed to load GTFS data:', err);
  }
}

window.initMap = initMap;
