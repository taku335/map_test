const CKAN_BASE_URL = 'https://data.bodik.jp';
const CKAN_PACKAGE_SHOW_URL =
  `${CKAN_BASE_URL}/api/3/action/package_show?id=231002_7109030000_bus-gtfs-jp`;
const FALLBACK_GTFS_ZIP_URLS = [
  `${CKAN_BASE_URL}/dataset/c5794008-8053-42ab-99b9-ee7f6fdf9a9e/resource/90ceab55-f14f-4376-8c7a-088fcb49115e/download/20250329_bus-gtfs-jp.zip`,
];

const KANAYAMA_STATION = {
  lat: 35.1432528,
  lon: 136.9009513,
};

const TARGET_RADIUS_METERS = 5000;
const BUS_ROUTE_TYPE = '3';
const NEXT_DEPARTURES_LIMIT = 10;
const GTFS_FETCH_TIMEOUT_MS = 30000;

let appContext = null;

document.addEventListener('DOMContentLoaded', initMap);

async function initMap() {
  const map = L.map('map').setView([KANAYAMA_STATION.lat, KANAYAMA_STATION.lon], 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);

  L.circle([KANAYAMA_STATION.lat, KANAYAMA_STATION.lon], {
    radius: TARGET_RADIUS_METERS,
    color: '#2b7de9',
    fillColor: '#2b7de9',
    fillOpacity: 0.08,
    weight: 2,
  }).addTo(map);

  const ui = getUiElements();
  ui.timetableDate.value = formatDateInput(new Date());
  setGlobalStatus(ui, 'GTFSデータを読み込み中…');

  const busIcon = L.icon({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [30, 49],
    iconAnchor: [15, 49],
    popupAnchor: [1, -45],
    shadowSize: [49, 49],
    shadowAnchor: [15, 49],
  });

  try {
    const { gtfsData, sourceUrl } = await loadGtfsDataWithFallback();
    const busData = filterBusData(gtfsData);

    const routeById = buildRouteDetails(busData.routes);
    const tripById = buildTripIndex(busData.trips);
    const timetableByStopId = buildStopTimetableIndex(busData.stopTimes, tripById);
    const serviceCalendar = buildServiceCalendar(busData.calendar, busData.calendarDates);

    const stopsInRadius = filterStopsByRadius(
      busData.stops,
      KANAYAMA_STATION,
      TARGET_RADIUS_METERS
    ).filter((stop) => timetableByStopId.has(stop.stop_id));

    const markerByStopId = plotStops(
      map,
      stopsInRadius,
      busIcon,
      (stopId) => selectStop(stopId, { focusMap: false, openPopup: false })
    );

    const shapeToRoute = buildShapeToRoute(busData.trips);
    const activeRoutes =
      busData.shapes.length > 0
        ? drawRoutes(map, busData.shapes, shapeToRoute, routeById)
        : new Set();
    renderRouteInfo(ui.routeInfoList, routeById, activeRoutes);

    appContext = {
      map,
      ui,
      markerByStopId,
      stopById: buildStopIndex(stopsInRadius),
      routeById,
      tripById,
      timetableByStopId,
      serviceCalendar,
      selectedStopId: null,
      activeTab: 'next',
    };

    initializeSearch(ui, stopsInRadius, (stopId) =>
      selectStop(stopId, { focusMap: true, openPopup: true })
    );

    initializeTabEvents(ui);
    initializeDateEvent(ui);

    const routeSuffix =
      busData.shapes.length > 0
        ? `路線 ${activeRoutes.size}件`
        : `路線ポリラインなし（shapes.txt未提供）`;
    setGlobalStatus(ui, `読込完了: 停留所 ${stopsInRadius.length}件 / ${routeSuffix}`);
    console.info('GTFS source URL:', sourceUrl);
  } catch (error) {
    console.error('Failed to initialize app:', error);
    const details = summarizeError(error);
    setGlobalStatus(ui, `GTFSデータの読み込みに失敗しました: ${details}`, true);
    setPanelStatus(ui, `時刻表を表示できません。${details}`, true);
  }
}

function getUiElements() {
  return {
    globalStatus: document.getElementById('global-status'),
    searchForm: document.getElementById('search-form'),
    searchInput: document.getElementById('stop-search'),
    searchSuggestions: document.getElementById('stop-suggestions'),
    selectedStopName: document.getElementById('selected-stop-name'),
    timetableDate: document.getElementById('timetable-date'),
    tabNext: document.getElementById('tab-next'),
    tabAll: document.getElementById('tab-all'),
    panelStatus: document.getElementById('panel-status'),
    timetableList: document.getElementById('timetable-list'),
    routeInfoList: document.getElementById('route-info-list'),
  };
}

function setGlobalStatus(ui, message, isError = false) {
  if (!ui.globalStatus) {
    return;
  }
  ui.globalStatus.textContent = message;
  ui.globalStatus.style.color = isError ? '#b42318' : '#617083';
}

function setPanelStatus(ui, message, isError = false) {
  if (!ui.panelStatus) {
    return;
  }
  ui.panelStatus.textContent = message;
  ui.panelStatus.classList.toggle('error', isError);
}

function initializeTabEvents(ui) {
  ui.tabNext.addEventListener('click', () => {
    updateTab('next', ui);
  });

  ui.tabAll.addEventListener('click', () => {
    updateTab('all', ui);
  });
}

function updateTab(tab, ui) {
  if (!appContext) {
    return;
  }

  appContext.activeTab = tab;
  const isNext = tab === 'next';

  ui.tabNext.classList.toggle('active', isNext);
  ui.tabAll.classList.toggle('active', !isNext);
  ui.tabNext.setAttribute('aria-selected', isNext ? 'true' : 'false');
  ui.tabAll.setAttribute('aria-selected', isNext ? 'false' : 'true');

  renderSelectedStopTimetable();
}

function initializeDateEvent(ui) {
  ui.timetableDate.addEventListener('change', () => {
    renderSelectedStopTimetable();
  });
}

function initializeSearch(ui, stops, onSelectStop) {
  const searchEntries = [];
  const exactLookup = new Map();

  const sortedStops = [...stops].sort((a, b) => {
    const aName = (a.stop_name || a.stop_id || '').trim();
    const bName = (b.stop_name || b.stop_id || '').trim();
    return aName.localeCompare(bName, 'ja');
  });

  ui.searchSuggestions.innerHTML = '';

  sortedStops.forEach((stop) => {
    const optionValue = formatStopSearchLabel(stop);
    const option = document.createElement('option');
    option.value = optionValue;
    ui.searchSuggestions.appendChild(option);

    exactLookup.set(optionValue, stop.stop_id);
    exactLookup.set((stop.stop_id || '').trim(), stop.stop_id);

    const normalizedText = `${stop.stop_name || ''} ${stop.stop_id || ''}`
      .toLowerCase()
      .trim();

    searchEntries.push({
      stopId: stop.stop_id,
      normalizedText,
    });
  });

  ui.searchForm.addEventListener('submit', (event) => {
    event.preventDefault();

    const query = (ui.searchInput.value || '').trim();
    if (!query) {
      return;
    }

    const exactMatch = exactLookup.get(query);
    if (exactMatch) {
      onSelectStop(exactMatch);
      return;
    }

    const queryNormalized = query.toLowerCase();
    const matched = searchEntries.find((entry) =>
      entry.normalizedText.includes(queryNormalized)
    );

    if (!matched) {
      setPanelStatus(ui, `「${query}」に一致する停留所が見つかりませんでした。`);
      return;
    }

    onSelectStop(matched.stopId);
  });
}

function selectStop(stopId, options = {}) {
  if (!appContext) {
    return;
  }

  const stop = appContext.stopById.get(stopId);
  if (!stop) {
    return;
  }

  appContext.selectedStopId = stopId;
  appContext.ui.selectedStopName.textContent = stop.stop_name || stop.stop_id;

  const marker = appContext.markerByStopId.get(stopId);
  if (marker) {
    const shouldFocusMap = options.focusMap !== false;
    if (shouldFocusMap) {
      const targetZoom = Math.max(appContext.map.getZoom(), 15);
      appContext.map.flyTo(marker.getLatLng(), targetZoom, { duration: 0.45 });
    }

    if (options.openPopup !== false) {
      marker.openPopup();
    }
  }

  renderSelectedStopTimetable();
}

function renderSelectedStopTimetable() {
  if (!appContext) {
    return;
  }

  const { selectedStopId, ui } = appContext;
  if (!selectedStopId) {
    ui.timetableList.innerHTML = '';
    setPanelStatus(ui, '地図上の停留所を選択すると時刻表を表示します。');
    return;
  }

  const selectedDate = parseDateInput(ui.timetableDate.value) || new Date();
  const departures = getDeparturesForStop(selectedStopId, selectedDate);

  const displayed =
    appContext.activeTab === 'next'
      ? departures.slice(0, NEXT_DEPARTURES_LIMIT)
      : departures;

  renderTimetableList(ui.timetableList, displayed);

  if (departures.length === 0) {
    setPanelStatus(ui, '選択日の時刻表データはありません。');
    return;
  }

  if (appContext.activeTab === 'next') {
    setPanelStatus(
      ui,
      `次の${displayed.length}件を表示中（全${departures.length}件）`
    );
  } else {
    setPanelStatus(ui, `その日の全${displayed.length}件を表示中`);
  }
}

function renderTimetableList(listEl, departures) {
  listEl.innerHTML = '';

  departures.forEach((departure) => {
    const item = document.createElement('li');

    const time = document.createElement('div');
    time.className = 'time-label';
    time.textContent = departure.departureLabel;

    const meta = document.createElement('div');
    meta.className = 'trip-meta';

    const routeName = document.createElement('div');
    routeName.className = 'route-name';
    routeName.textContent = departure.routeLabel;

    const headsign = document.createElement('div');
    headsign.className = 'headsign';
    headsign.textContent = departure.headsign;

    meta.appendChild(routeName);
    meta.appendChild(headsign);

    item.appendChild(time);
    item.appendChild(meta);

    listEl.appendChild(item);
  });
}

function getDeparturesForStop(stopId, selectedDate) {
  const rows = appContext.timetableByStopId.get(stopId) || [];
  const departures = [];

  const now = new Date();
  const isToday = isSameLocalDate(selectedDate, now);
  const nowSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const dateKey = formatDateKey(selectedDate);
  const weekday = selectedDate.getDay();

  rows.forEach((row) => {
    const trip = appContext.tripById.get(row.tripId);
    if (!trip) {
      return;
    }

    if (!appContext.serviceCalendar.isActive(trip.serviceId, dateKey, weekday)) {
      return;
    }

    if (isToday && row.departureSeconds < nowSeconds) {
      return;
    }

    const routeDetails = appContext.routeById.get(trip.routeId);

    departures.push({
      departureSeconds: row.departureSeconds,
      departureLabel: formatGtfsSeconds(row.departureSeconds),
      routeLabel: buildRouteLabel(routeDetails, trip.routeId),
      headsign: trip.headsign || '行先情報なし',
    });
  });

  departures.sort((a, b) => a.departureSeconds - b.departureSeconds);
  return departures;
}

async function loadGtfsDataWithFallback() {
  const candidateUrls = await resolveGtfsZipCandidates();
  const errors = [];

  for (const url of candidateUrls) {
    try {
      const gtfsData = await loadGtfsData(url);
      return { gtfsData, sourceUrl: url, errors };
    } catch (error) {
      const reason = summarizeError(error);
      errors.push(`${url} (${reason})`);
      console.warn('Failed to load GTFS source:', url, error);
    }
  }

  throw new Error(`GTFS取得に失敗しました。試行先: ${errors.join(' / ')}`);
}

async function resolveGtfsZipCandidates() {
  const candidates = [];
  try {
    const latest = await resolveLatestGtfsZipUrl();
    if (latest) {
      candidates.push(latest);
    }
  } catch (error) {
    console.warn('Failed to resolve latest GTFS URL.', error);
  }

  FALLBACK_GTFS_ZIP_URLS.forEach((url) => {
    candidates.push(url);
  });

  const unique = [];
  const seen = new Set();

  candidates.forEach((url) => {
    if (!url || seen.has(url)) {
      return;
    }
    seen.add(url);
    unique.push(url);
  });

  return unique;
}

async function resolveLatestGtfsZipUrl() {
  const response = await fetchWithTimeout(CKAN_PACKAGE_SHOW_URL, GTFS_FETCH_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(`CKAN metadata fetch failed: ${response.status}`);
  }

  const payload = await response.json();
  const resources = payload?.result?.resources;
  if (!Array.isArray(resources)) {
    throw new Error('Invalid CKAN response: resources not found');
  }

  const zipResources = resources
    .map((resource) => ({ resource, resolvedUrl: resolveResourceUrl(resource?.url) }))
    .filter(({ resource, resolvedUrl }) => {
      if (!resolvedUrl) {
        return false;
      }

      const format = String(resource?.format || '').toLowerCase();
      return /\.zip(?:$|\?)/i.test(resolvedUrl) || format === 'zip';
    })
    .sort((a, b) => getResourceTimestamp(b.resource) - getResourceTimestamp(a.resource));

  if (zipResources.length === 0) {
    throw new Error('No ZIP resource found in CKAN dataset');
  }

  return zipResources[0].resolvedUrl;
}

function resolveResourceUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) {
    return '';
  }

  try {
    return new URL(raw, CKAN_BASE_URL).toString();
  } catch (error) {
    return '';
  }
}

function getResourceTimestamp(resource) {
  const candidates = [
    resource.last_modified,
    resource.metadata_modified,
    resource.created,
    resource.revision_timestamp,
  ];

  for (const candidate of candidates) {
    const time = Date.parse(candidate);
    if (Number.isFinite(time)) {
      return time;
    }
  }

  return 0;
}

async function loadGtfsData(url) {
  const zip = await fetchGtfsZip(url);

  const [stops, routes, trips, stopTimes, calendar, calendarDates, shapes] =
    await Promise.all([
      parseCsvFile(zip, 'stops.txt'),
      parseCsvFile(zip, 'routes.txt'),
      parseCsvFile(zip, 'trips.txt'),
      parseCsvFile(zip, 'stop_times.txt'),
      parseCsvFile(zip, 'calendar.txt', { optional: true }),
      parseCsvFile(zip, 'calendar_dates.txt', { optional: true }),
      parseCsvFile(zip, 'shapes.txt', { optional: true }),
    ]);

  return {
    stops,
    routes,
    trips,
    stopTimes,
    calendar,
    calendarDates,
    shapes,
  };
}

async function fetchGtfsZip(url) {
  const response = await fetchWithTimeout(url, GTFS_FETCH_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(`Failed to download GTFS ZIP: ${response.status}`);
  }
  const blob = await response.blob();
  try {
    return await JSZip.loadAsync(blob);
  } catch (error) {
    throw new Error(`Invalid GTFS ZIP: ${summarizeError(error)}`);
  }
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

async function parseCsvFile(zip, filename, options = {}) {
  const file = findGtfsFile(zip, filename);
  if (!file) {
    if (options.optional) {
      return [];
    }
    const available = Object.keys(zip.files).slice(0, 12).join(', ');
    throw new Error(`${filename} is missing from GTFS feed (available: ${available})`);
  }

  const buffer = await file.async('arraybuffer');
  const text = decodeCsvText(buffer);

  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      complete: ({ data }) => resolve(data),
      error: (error) => reject(new Error(`${filename} parse error: ${summarizeError(error)}`)),
    });
  });
}

function findGtfsFile(zip, filename) {
  const direct = zip.file(filename);
  if (direct) {
    return direct;
  }

  const target = String(filename || '').toLowerCase();
  if (!target) {
    return null;
  }

  const files = Object.values(zip.files);
  for (const entry of files) {
    if (!entry || entry.dir) {
      continue;
    }

    const basename = String(entry.name || '').split(/[\\/]/).pop();
    if (basename && basename.toLowerCase() === target) {
      return entry;
    }
  }

  return null;
}

function decodeCsvText(buffer) {
  try {
    const utf8Text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return utf8Text.replace(/^\uFEFF/, '');
  } catch (error) {
    return new TextDecoder('shift_jis').decode(buffer).replace(/^\uFEFF/, '');
  }
}

function summarizeError(error) {
  if (!error) {
    return '不明なエラー';
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error.message) {
    return error.message;
  }
  return String(error);
}

function filterBusData(data) {
  const busRoutes = data.routes.filter(
    (route) => String(route.route_type || '').trim() === BUS_ROUTE_TYPE
  );

  const routeIds = new Set(busRoutes.map((route) => route.route_id).filter(Boolean));

  const trips = data.trips.filter((trip) => routeIds.has(trip.route_id));
  const tripIds = new Set(trips.map((trip) => trip.trip_id).filter(Boolean));
  const serviceIds = new Set(trips.map((trip) => trip.service_id).filter(Boolean));

  const stopTimes = data.stopTimes.filter((stopTime) => tripIds.has(stopTime.trip_id));
  const stopIds = new Set(stopTimes.map((stopTime) => stopTime.stop_id).filter(Boolean));

  const stops = data.stops.filter((stop) => stopIds.has(stop.stop_id));

  const shapeIds = new Set(trips.map((trip) => trip.shape_id).filter(Boolean));
  const shapes = data.shapes.filter((shape) => shapeIds.has(shape.shape_id));

  const calendar = data.calendar.filter((row) => serviceIds.has(row.service_id));
  const calendarDates = data.calendarDates.filter((row) => serviceIds.has(row.service_id));

  return {
    stops,
    routes: busRoutes,
    trips,
    stopTimes,
    calendar,
    calendarDates,
    shapes,
  };
}

function filterStopsByRadius(stops, center, radiusMeters) {
  return stops.filter((stop) => {
    const lat = parseFloat(stop.stop_lat);
    const lon = parseFloat(stop.stop_lon);

    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      return false;
    }

    const distance = haversineDistanceMeters(center.lat, center.lon, lat, lon);
    return distance <= radiusMeters;
  });
}

function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const earthRadius = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function plotStops(map, stops, icon, onSelect) {
  const markerByStopId = new Map();

  stops.forEach((stop) => {
    const lat = parseFloat(stop.stop_lat);
    const lon = parseFloat(stop.stop_lon);
    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      return;
    }

    const stopName = stop.stop_name || '停留所名未設定';
    const stopId = stop.stop_id || '';

    const marker = L.marker([lat, lon], { icon }).addTo(map).bindPopup(
      `<strong>${escapeHtml(stopName)}</strong><br>${escapeHtml(stopId)}`
    );

    marker.on('click', () => {
      onSelect(stop.stop_id);
    });

    markerByStopId.set(stop.stop_id, marker);
  });

  return markerByStopId;
}

function escapeHtml(value) {
  const text = String(value);
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function drawRoutes(map, shapes, shapeToRoute, routeDetails) {
  const pointsByShapeId = groupShapePointsById(shapes);
  const activeRoutes = new Set();

  pointsByShapeId.forEach((points, shapeId) => {
    const routeId = shapeToRoute.get(shapeId);
    if (!routeId || points.length < 2) {
      return;
    }

    const details = routeDetails.get(routeId);
    const latlngs = points
      .sort((a, b) => a.sequence - b.sequence)
      .map(({ lat, lon }) => [lat, lon]);

    const color = details?.color || '#0066cc';
    const polyline = L.polyline(latlngs, {
      color,
      weight: 3,
      opacity: 0.72,
    }).addTo(map);

    polyline.bindPopup(`<strong>${escapeHtml(details?.displayLabel || routeId)}</strong>`);
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

    if (Number.isNaN(lat) || Number.isNaN(lon) || Number.isNaN(sequence)) {
      return;
    }

    const points = grouped.get(shapeId) || [];
    points.push({ lat, lon, sequence });
    grouped.set(shapeId, points);
  });

  return grouped;
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

function renderRouteInfo(container, routeDetails, activeRoutes) {
  if (!container) {
    return;
  }

  container.innerHTML = '';

  const entries = Array.from(routeDetails.entries()).filter(([routeId]) =>
    activeRoutes.has(routeId)
  );

  entries.sort((a, b) =>
    a[1].displayLabel.localeCompare(b[1].displayLabel, 'ja')
  );

  entries.forEach(([, details]) => {
    const item = document.createElement('li');

    const color = document.createElement('span');
    color.className = 'route-color';
    color.style.backgroundColor = details.color;

    const text = document.createElement('span');
    text.textContent = details.displayLabel;

    item.appendChild(color);
    item.appendChild(text);
    container.appendChild(item);
  });
}

function buildStopIndex(stops) {
  const stopById = new Map();
  stops.forEach((stop) => {
    stopById.set(stop.stop_id, stop);
  });
  return stopById;
}

function buildTripIndex(trips) {
  const tripById = new Map();

  trips.forEach((trip) => {
    if (!trip.trip_id) {
      return;
    }

    tripById.set(trip.trip_id, {
      routeId: trip.route_id,
      serviceId: trip.service_id,
      headsign: (trip.trip_headsign || '').trim(),
      shapeId: trip.shape_id,
    });
  });

  return tripById;
}

function buildStopTimetableIndex(stopTimes, tripById) {
  const timetableByStopId = new Map();

  stopTimes.forEach((row) => {
    const stopId = row.stop_id;
    const tripId = row.trip_id;

    if (!stopId || !tripId || !tripById.has(tripId)) {
      return;
    }

    const departureRaw = (row.departure_time || row.arrival_time || '').trim();
    const departureSeconds = parseGtfsTimeToSeconds(departureRaw);

    if (departureSeconds === null) {
      return;
    }

    const records = timetableByStopId.get(stopId) || [];
    records.push({
      tripId,
      departureSeconds,
    });
    timetableByStopId.set(stopId, records);
  });

  timetableByStopId.forEach((records) => {
    records.sort((a, b) => a.departureSeconds - b.departureSeconds);
  });

  return timetableByStopId;
}

function parseGtfsTimeToSeconds(value) {
  const match = String(value).match(/^(\d+):([0-5]\d):([0-5]\d)$/);
  if (!match) {
    return null;
  }

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);

  if ([hours, minutes, seconds].some(Number.isNaN)) {
    return null;
  }

  return hours * 3600 + minutes * 60 + seconds;
}

function formatGtfsSeconds(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function buildServiceCalendar(calendarRows, calendarDateRows) {
  const baseByServiceId = new Map();

  calendarRows.forEach((row) => {
    if (!row.service_id) {
      return;
    }

    baseByServiceId.set(row.service_id, {
      startDate: normalizeDateKey(row.start_date),
      endDate: normalizeDateKey(row.end_date),
      weekdayFlags: [
        row.sunday === '1',
        row.monday === '1',
        row.tuesday === '1',
        row.wednesday === '1',
        row.thursday === '1',
        row.friday === '1',
        row.saturday === '1',
      ],
    });
  });

  const exceptionsByServiceId = new Map();

  calendarDateRows.forEach((row) => {
    const serviceId = row.service_id;
    const dateKey = normalizeDateKey(row.date);
    const exceptionType = parseInt(row.exception_type, 10);

    if (!serviceId || !dateKey || Number.isNaN(exceptionType)) {
      return;
    }

    const serviceExceptions = exceptionsByServiceId.get(serviceId) || new Map();
    serviceExceptions.set(dateKey, exceptionType);
    exceptionsByServiceId.set(serviceId, serviceExceptions);
  });

  return {
    isActive(serviceId, dateKey, weekday) {
      const exceptions = exceptionsByServiceId.get(serviceId);
      if (exceptions && exceptions.has(dateKey)) {
        const value = exceptions.get(dateKey);
        if (value === 1) {
          return true;
        }
        if (value === 2) {
          return false;
        }
      }

      const base = baseByServiceId.get(serviceId);
      if (!base) {
        return false;
      }

      if (base.startDate && dateKey < base.startDate) {
        return false;
      }

      if (base.endDate && dateKey > base.endDate) {
        return false;
      }

      return Boolean(base.weekdayFlags[weekday]);
    },
  };
}

function normalizeDateKey(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 8) {
    return '';
  }
  return digits;
}

function parseDateInput(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function formatDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function isSameLocalDate(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function buildRouteLabel(routeDetails, routeId) {
  if (!routeDetails) {
    return routeId || '不明な路線';
  }

  if (routeDetails.shortName && routeDetails.longName) {
    if (routeDetails.shortName === routeDetails.longName) {
      return routeDetails.shortName;
    }
    return `${routeDetails.shortName} ${routeDetails.longName}`;
  }

  return routeDetails.shortName || routeDetails.longName || routeDetails.displayLabel;
}

function formatStopSearchLabel(stop) {
  const name = (stop.stop_name || '停留所名未設定').trim();
  const stopId = (stop.stop_id || '').trim();
  if (!stopId) {
    return name;
  }
  return `${name} (${stopId})`;
}
