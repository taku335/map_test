async function initMap() {
  const map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 34.9896, lng: 137.0025 },
    zoom: 13,
  });

  // Latest GTFS data for Kariya City community bus is available via the API.
  // Fetch the zip directly from the remote server instead of requiring a local file.
  const GTFS_ZIP_URL =
    'https://api.gtfs-data.jp/v2/organizations/kariyacity/feeds/communitybus/files/feed.zip?rid=next';
  try {
    const response = await fetch(GTFS_ZIP_URL);
    const blob = await response.blob();
    const zip = await JSZip.loadAsync(blob);
    // stops.txt is encoded in Shift_JIS, so decode it on the client
    const stopsBuffer = await zip.file('stops.txt').async('arraybuffer');
    const stopsTxt = new TextDecoder('shift_jis').decode(stopsBuffer);
    Papa.parse(stopsTxt, {
      header: true,
      skipEmptyLines: true,
      complete: function (results) {
        results.data.forEach((stop) => {
          if (stop.stop_lat && stop.stop_lon) {
            new google.maps.Marker({
              position: {
                lat: parseFloat(stop.stop_lat),
                lng: parseFloat(stop.stop_lon),
              },
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
