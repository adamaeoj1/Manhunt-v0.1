'use client';

import React, { useEffect, useRef, useState } from 'react';

export interface MapParticipantMarker {
  id: string;
  nickname: string;
  role: 'HUNTER' | 'HIDER' | 'HIDDEN' | null;
  isSelf: boolean;
  lat: number;
  lng: number;
  accuracy: number;
  ageSeconds: number;
  isStale: boolean;
}

export interface AuiLandmark {
  id: string;
  name: string;
  category: string;
  icon: string;
  lat: number;
  lng: number;
}

export const AUI_LANDMARKS: AuiLandmark[] = [
  { id: 'gate', name: 'Main Gate (البوابة الرئيسية)', category: 'Entrance', icon: '🚪', lat: 33.54115, lng: -5.10520 },
  { id: 'mosque', name: 'Mosque (المسجد)', category: 'Worship', icon: '🕌', lat: 33.54055, lng: -5.10740 },
  { id: 'library', name: 'Mohammed VI Library (المكتبة)', category: 'Study', icon: '🏛️', lat: 33.53890, lng: -5.10670 },
  { id: 'student_center', name: 'Student Center & Dining (مركز الطلاب والمطعم)', category: 'Dining', icon: '🍽️', lat: 33.54020, lng: -5.10590 },
  { id: 'quad', name: 'Academic Quad (المباني الأكاديمية)', category: 'Classes', icon: '🎓', lat: 33.53950, lng: -5.10650 },
  { id: 'sports', name: 'Sports Complex & Pool (المجمع الرياضي)', category: 'Athletics', icon: '⚽', lat: 33.53895, lng: -5.10780 },
  { id: 'dorms', name: 'Residence Halls / Dorms (السكن الجامعي)', category: 'Housing', icon: '🏢', lat: 33.54070, lng: -5.10470 },
];

interface CampusMapProps {
  mode: 'setup' | 'gameplay';
  boundary: { lat: number; lng: number; radiusMeters: number };
  markers?: MapParticipantMarker[];
  onSetupBoundaryMove?: (lat: number, lng: number) => void;
  centerCommand?: { lat: number; lng: number; zoom?: number; ts: number } | null;
  fitBoundaryCommand?: number;
}

interface CachedMarkerEntry {
  marker: any;
  circle: any;
  lastDisplayLat: number;
  lastDisplayLng: number;
  lastRawLat: number;
  lastRawLng: number;
  lastAccuracy: number;
  lastAgeSeconds: number;
  lastIsStale: boolean;
  lastRole: 'HUNTER' | 'HIDER' | 'HIDDEN' | null;
  lastIsSelf: boolean;
  lastNickname: string;
  lastZOffset: number;
}

function CampusMapInner({
  mode,
  boundary,
  markers = [],
  onSetupBoundaryMove,
  centerCommand,
  fitBoundaryCommand,
}: CampusMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const leafletRef = useRef<any>(null);
  const boundaryCircleRef = useRef<any>(null);
  const setupCenterMarkerRef = useRef<any>(null);
  const markersMapRef = useRef<Map<string, CachedMarkerEntry>>(new Map());
  const lastCenterTsRef = useRef<number>(0);
  const lastFitCmdRef = useRef<number>(0);

  const [mapLayer, setMapLayer] = useState<'street' | 'satellite'>('street');
  const [showLandmarks, setShowLandmarks] = useState(false);

  const streetLayerRef = useRef<any>(null);
  const satLayerRef = useRef<any>(null);
  const satLabelsRef = useRef<any>(null);
  const landmarkMarkersRef = useRef<any[]>([]);

  const onSetupBoundaryMoveRef = useRef<CampusMapProps['onSetupBoundaryMove']>(onSetupBoundaryMove);

  useEffect(() => {
    onSetupBoundaryMoveRef.current = onSetupBoundaryMove;
  }, [onSetupBoundaryMove]);

  useEffect(() => {
    let isMounted = true;
    let resizeObserver: ResizeObserver | null = null;

    const handleInvalidateSize = () => {
      if (mapRef.current) {
        try {
          mapRef.current.invalidateSize({ animate: false });
        } catch {}
      }
    };

    async function initLeaflet() {
      if (!containerRef.current || mapRef.current) return;
      const L = (await import('leaflet')).default;
      if (!isMounted || !containerRef.current) return;
      leafletRef.current = L;

      const initialZoom = boundary.radiusMeters >= 320 ? 16 : 16;
      const map = L.map(containerRef.current, {
        zoomControl: mode === 'setup',
        scrollWheelZoom: mode === 'gameplay',
        attributionControl: true,
      }).setView([boundary.lat, boundary.lng], initialZoom);

      if (mode === 'gameplay') {
        L.control.zoom({ position: 'bottomleft' }).addTo(map);
      }

      streetLayerRef.current = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      });

      satLayerRef.current = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 19,
          attribution: 'Tiles © Esri',
        }
      );

      satLabelsRef.current = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 19,
          attribution: '',
        }
      );

      // Default street view
      streetLayerRef.current.addTo(map);

      const circle = L.circle([boundary.lat, boundary.lng], {
        radius: boundary.radiusMeters,
        color: '#14532D',
        weight: mode === 'setup' ? 2.5 : 3,
        dashArray: mode === 'gameplay' ? '6, 6' : undefined,
        fillColor: '#14532D',
        fillOpacity: mode === 'setup' ? 0.14 : 0.08,
        interactive: false,
      }).addTo(map);

      if (mode === 'setup') {
        const centerHtml = `
          <div style="width:18px; height:18px; border-radius:9999px; background:#14532D; border:3px solid #FFFFFF; box-shadow:0 2px 6px rgba(0,0,0,0.35);"></div>
        `;
        const centerIcon = L.divIcon({
          html: centerHtml,
          className: '',
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        });
        setupCenterMarkerRef.current = L.marker([boundary.lat, boundary.lng], {
          icon: centerIcon,
          interactive: false,
        }).addTo(map);

        map.on('click', (e: any) => {
          if (onSetupBoundaryMoveRef.current && e?.latlng) {
            onSetupBoundaryMoveRef.current(
              Number(e.latlng.lat.toFixed(6)),
              Number(e.latlng.lng.toFixed(6))
            );
          }
        });
      }

      mapRef.current = map;
      boundaryCircleRef.current = circle;
      setTimeout(handleInvalidateSize, 80);
      setTimeout(handleInvalidateSize, 300);

      if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
        resizeObserver = new ResizeObserver(() => {
          handleInvalidateSize();
        });
        resizeObserver.observe(containerRef.current);
      }
    }

    initLeaflet();
    window.addEventListener('resize', handleInvalidateSize);
    window.addEventListener('orientationchange', handleInvalidateSize);

    return () => {
      isMounted = false;
      window.removeEventListener('resize', handleInvalidateSize);
      window.removeEventListener('orientationchange', handleInvalidateSize);
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        boundaryCircleRef.current = null;
        setupCenterMarkerRef.current = null;
        markersMapRef.current.clear();
        landmarkMarkersRef.current = [];
      }
    };
  }, []);

  // Toggle Satellite vs Street Layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    try {
      if (mapLayer === 'satellite') {
        if (streetLayerRef.current && map.hasLayer(streetLayerRef.current)) {
          map.removeLayer(streetLayerRef.current);
        }
        if (satLayerRef.current && !map.hasLayer(satLayerRef.current)) {
          satLayerRef.current.addTo(map);
        }
        if (satLabelsRef.current && !map.hasLayer(satLabelsRef.current)) {
          satLabelsRef.current.addTo(map);
        }
      } else {
        if (satLayerRef.current && map.hasLayer(satLayerRef.current)) {
          map.removeLayer(satLayerRef.current);
        }
        if (satLabelsRef.current && map.hasLayer(satLabelsRef.current)) {
          map.removeLayer(satLabelsRef.current);
        }
        if (streetLayerRef.current && !map.hasLayer(streetLayerRef.current)) {
          streetLayerRef.current.addTo(map);
        }
      }
    } catch {}
  }, [mapLayer]);

  // Toggle AUI Landmarks Markers
  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;

    // Clear existing landmark markers
    landmarkMarkersRef.current.forEach((m) => {
      try {
        map.removeLayer(m);
      } catch {}
    });
    landmarkMarkersRef.current = [];

    if (showLandmarks) {
      AUI_LANDMARKS.forEach((lm) => {
        const html = `
          <div style="display:inline-flex; align-items:center; gap:3px; background:rgba(15, 23, 42, 0.88); color:#FFFFFF; border:1.5px solid rgba(255, 255, 255, 0.45); border-radius:8px; padding:2.5px 6.5px; font-size:10.5px; font-weight:800; white-space:nowrap; box-shadow:0 3px 8px rgba(0,0,0,0.45); pointer-events:none;">
            <span style="font-size:12px;">${lm.icon}</span>
            <span>${lm.name}</span>
          </div>
        `;
        const icon = L.divIcon({
          html,
          className: '',
          iconSize: [120, 24],
          iconAnchor: [60, 12],
        });
        const marker = L.marker([lm.lat, lm.lng], {
          icon,
          interactive: false,
          zIndexOffset: 50, // Below player pins
        }).addTo(map);
        landmarkMarkersRef.current.push(marker);
      });
    }
  }, [showLandmarks]);

  useEffect(() => {
    if (!boundaryCircleRef.current) return;
    boundaryCircleRef.current.setLatLng([boundary.lat, boundary.lng]);
    boundaryCircleRef.current.setRadius(boundary.radiusMeters);
    if (setupCenterMarkerRef.current) {
      setupCenterMarkerRef.current.setLatLng([boundary.lat, boundary.lng]);
    }
  }, [boundary.lat, boundary.lng, boundary.radiusMeters]);

  useEffect(() => {
    if (!mapRef.current || !centerCommand) return;
    if (centerCommand.ts === lastCenterTsRef.current) return;
    lastCenterTsRef.current = centerCommand.ts;
    mapRef.current.invalidateSize({ animate: false });
    mapRef.current.flyTo([centerCommand.lat, centerCommand.lng], centerCommand.zoom || 17, {
      duration: 0.55,
    });
  }, [centerCommand]);

  useEffect(() => {
    if (!mapRef.current || !boundaryCircleRef.current || !fitBoundaryCommand) return;
    if (fitBoundaryCommand === lastFitCmdRef.current) return;
    lastFitCmdRef.current = fitBoundaryCommand;
    mapRef.current.invalidateSize({ animate: false });
    mapRef.current.fitBounds(boundaryCircleRef.current.getBounds(), { padding: [24, 24] });
  }, [fitBoundaryCommand]);

  useEffect(() => {
    async function syncMarkers() {
      if (mode !== 'gameplay' || !mapRef.current) return;
      const L = leafletRef.current || (await import('leaflet')).default;
      leafletRef.current = L;
      const map = mapRef.current;
      if (!map) return;

      const activeIds = new Set<string>();

      // Spiderfy overlapping markers
      const displayCoords = new Map<string, { lat: number; lng: number }>();
      const clusterRadiusDeg = 0.000065; // ~7 meters visual separation
      const thresholdDeg = 0.00009; // ~10 meters grouping threshold
      const visited = new Set<string>();

      for (let i = 0; i < markers.length; i++) {
        const base = markers[i];
        if (visited.has(base.id)) continue;
        const cluster: MapParticipantMarker[] = [base];
        visited.add(base.id);

        for (let j = i + 1; j < markers.length; j++) {
          const other = markers[j];
          if (visited.has(other.id)) continue;
          if (
            Math.abs(base.lat - other.lat) <= thresholdDeg &&
            Math.abs(base.lng - other.lng) <= thresholdDeg
          ) {
            cluster.push(other);
            visited.add(other.id);
          }
        }

        if (cluster.length === 1) {
          displayCoords.set(base.id, { lat: base.lat, lng: base.lng });
        } else {
          cluster.forEach((item, idx) => {
            const angle = (2 * Math.PI * idx) / cluster.length - Math.PI / 2;
            displayCoords.set(item.id, {
              lat: item.lat + Math.sin(angle) * clusterRadiusDeg,
              lng: item.lng + Math.cos(angle) * clusterRadiusDeg,
            });
          });
        }
      }

      for (const m of markers) {
        activeIds.add(m.id);
        const pos = displayCoords.get(m.id) || { lat: m.lat, lng: m.lng };
        const isHunter = m.role === 'HUNTER';
        const pinBg = isHunter ? '#DC2626' : '#15803D';
        const badgeBg = isHunter ? '#991B1B' : '#14532D';
        const roleLabel = isHunter ? 'HUNTER' : 'HIDER';
        const ageText = m.isStale ? `Stale ${m.ageSeconds}s` : `${m.ageSeconds}s`;
        const zOffset = m.isSelf ? 1000 : isHunter ? 500 : 100;

        const buildIcon = () => {
          const selfBadge = m.isSelf
            ? `<span style="background:#2563EB;color:#FFFFFF;padding:1px 5px;border-radius:5px;font-weight:800;font-size:9px;margin-right:3px;">YOU</span>`
            : '';
          const roleBadge = `<span style="background:${badgeBg};color:#FFFFFF;padding:1px 5px;border-radius:5px;font-weight:800;font-size:9px;margin-right:4px;">${roleLabel}</span>`;
          const selfRingStyle = m.isSelf
            ? 'border:3px solid #FFFFFF; box-shadow: 0 0 0 4px #2563EB, 0 0 14px rgba(37,99,235,0.75);'
            : isHunter
            ? 'border:3px solid #FEE2E2; box-shadow: 0 0 0 2px #991B1B, 0 3px 10px rgba(0,0,0,0.35);'
            : 'border:3px solid #DCFCE7; box-shadow: 0 0 0 2px #14532D, 0 3px 10px rgba(0,0,0,0.3);';

          const html = `
            <div style="position:relative; width:40px; height:40px;">
              ${
                m.isSelf
                  ? `<div style="position:absolute; inset:-6px; border-radius:9999px; border:2.5px solid #3B82F6; opacity:0.75; pointer-events:none;"></div>`
                  : ''
              }
              <div class="campus-marker-pin" style="width:40px; height:40px; background:${pinBg}; ${selfRingStyle} opacity:${
            m.isStale ? '0.68' : '1'
          }; font-size:13px;">
                ${m.nickname.slice(0, 2).toUpperCase()}
              </div>
              <div class="marker-label-pill" style="display:flex; align-items:center; gap:2px;">
                ${selfBadge}${roleBadge}<span>${m.nickname} (±${m.accuracy}m • ${ageText})</span>
              </div>
            </div>
          `;
          return L.divIcon({ html, className: '', iconSize: [40, 40], iconAnchor: [20, 20] });
        };

        const existing = markersMapRef.current.get(m.id);
        if (!existing) {
          const icon = buildIcon();
          const marker = L.marker([pos.lat, pos.lng], { icon, zIndexOffset: zOffset }).addTo(map);
          const circle = L.circle([m.lat, m.lng], {
            radius: m.accuracy,
            color: m.isSelf ? '#2563EB' : pinBg,
            weight: m.isSelf ? 1.5 : 1,
            fillColor: m.isSelf ? '#3B82F6' : pinBg,
            fillOpacity: 0.1,
            interactive: false,
          }).addTo(map);
          markersMapRef.current.set(m.id, {
            marker,
            circle,
            lastDisplayLat: pos.lat,
            lastDisplayLng: pos.lng,
            lastRawLat: m.lat,
            lastRawLng: m.lng,
            lastAccuracy: m.accuracy,
            lastAgeSeconds: m.ageSeconds,
            lastIsStale: m.isStale,
            lastRole: m.role,
            lastIsSelf: m.isSelf,
            lastNickname: m.nickname,
            lastZOffset: zOffset,
          });
        } else {
          if (existing.lastDisplayLat !== pos.lat || existing.lastDisplayLng !== pos.lng) {
            existing.marker.setLatLng([pos.lat, pos.lng]);
            existing.lastDisplayLat = pos.lat;
            existing.lastDisplayLng = pos.lng;
          }
          const hasVisualChange =
            existing.lastRole !== m.role ||
            existing.lastIsStale !== m.isStale ||
            existing.lastAccuracy !== m.accuracy ||
            existing.lastAgeSeconds !== m.ageSeconds ||
            existing.lastIsSelf !== m.isSelf ||
            existing.lastNickname !== m.nickname;
          if (hasVisualChange) {
            existing.marker.setIcon(buildIcon());
            existing.lastRole = m.role;
            existing.lastIsStale = m.isStale;
            existing.lastAccuracy = m.accuracy;
            existing.lastAgeSeconds = m.ageSeconds;
            existing.lastIsSelf = m.isSelf;
            existing.lastNickname = m.nickname;
          }
          if (existing.lastZOffset !== zOffset && existing.marker.setZIndexOffset) {
            existing.marker.setZIndexOffset(zOffset);
            existing.lastZOffset = zOffset;
          }
          if (existing.lastRawLat !== m.lat || existing.lastRawLng !== m.lng) {
            existing.circle.setLatLng([m.lat, m.lng]);
            existing.lastRawLat = m.lat;
            existing.lastRawLng = m.lng;
          }
          if (existing.lastAccuracy !== m.accuracy) {
            existing.circle.setRadius(m.accuracy);
            existing.lastAccuracy = m.accuracy;
          }
        }
      }

      for (const [id, entry] of Array.from(markersMapRef.current.entries())) {
        if (!activeIds.has(id)) {
          map.removeLayer(entry.marker);
          map.removeLayer(entry.circle);
          markersMapRef.current.delete(id);
        }
      }
    }
    syncMarkers();
  }, [mode, markers]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <div
        ref={containerRef}
        style={{ position: 'relative', zIndex: 1, isolation: 'isolate', width: '100%', height: '100%' }}
        className={`map-stack-container w-full h-full ${mode === 'setup' ? 'cursor-crosshair' : ''}`}
      />
      <div className="absolute top-3 right-3 z-[1000] flex items-center gap-1.5 pointer-events-auto">
        <button
          type="button"
          onClick={() => setMapLayer((prev) => (prev === 'street' ? 'satellite' : 'street'))}
          className="h-8 px-2.5 rounded-lg bg-white/95 backdrop-blur border border-stone-300 shadow-md text-xs font-bold text-stone-800 hover:bg-stone-100 transition flex items-center gap-1 select-none"
        >
          <span>{mapLayer === 'street' ? '🛰️ قمر صناعي / Satellite' : '🗺️ خريطة / Street'}</span>
        </button>
        <button
          type="button"
          onClick={() => setShowLandmarks((prev) => !prev)}
          className={`h-8 px-2.5 rounded-lg backdrop-blur border shadow-md text-xs font-bold transition flex items-center gap-1 select-none ${
            showLandmarks
              ? 'bg-emerald-800 text-white border-emerald-900 shadow-emerald-900/30'
              : 'bg-white/95 border-stone-300 text-stone-800 hover:bg-stone-100'
          }`}
        >
          <span>📍 معالم الجامعة / Landmarks</span>
        </button>
      </div>
    </div>
  );
}

const CampusMap = React.memo(CampusMapInner);
export default CampusMap;
