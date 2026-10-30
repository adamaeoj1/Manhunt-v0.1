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

export const AUI_CAMPUS_CENTER = {
  lat: 33.53965,
  lng: -5.10710,
};

interface CampusMapProps {
  mode: 'setup' | 'gameplay';
  boundary: { lat: number; lng: number; radiusMeters: number };
  markers?: MapParticipantMarker[];
  onSetupBoundaryMove?: (lat: number, lng: number) => void;
  centerCommand?: { lat: number; lng: number; zoom?: number; ts: number } | null;
  fitBoundaryCommand?: number;
  onCenterMe?: () => void;
  onFitBoundary?: () => void;
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
  onCenterMe,
  onFitBoundary,
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

  const streetLayerRef = useRef<any>(null);
  const satLayerRef = useRef<any>(null);
  const satLabelsRef = useRef<any>(null);

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

      // Lock zoom strictly to campus buildings (zoom 17 default, min 15, max 19)
      const centerLat = boundary.lat || AUI_CAMPUS_CENTER.lat;
      const centerLng = boundary.lng || AUI_CAMPUS_CENTER.lng;

      const map = L.map(containerRef.current, {
        zoomControl: false,
        scrollWheelZoom: mode === 'gameplay',
        attributionControl: false,
        minZoom: 15,
        maxZoom: 19,
      }).setView([centerLat, centerLng], 17);

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

      const circle = L.circle([centerLat, centerLng], {
        radius: boundary.radiusMeters,
        color: '#065F46', // emerald-800
        weight: mode === 'setup' ? 2.5 : 3,
        dashArray: mode === 'gameplay' ? '6, 6' : undefined,
        fillColor: '#065F46',
        fillOpacity: mode === 'setup' ? 0.12 : 0.08,
        interactive: false,
      }).addTo(map);

      if (mode === 'setup') {
        const centerHtml = `
          <div style="width:18px; height:18px; border-radius:9999px; background:#065F46; border:3px solid #FFFFFF; box-shadow:0 2px 6px rgba(0,0,0,0.35);"></div>
        `;
        const centerIcon = L.divIcon({
          html: centerHtml,
          className: '',
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        });
        setupCenterMarkerRef.current = L.marker([centerLat, centerLng], {
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
      duration: 0.5,
    });
  }, [centerCommand]);

  useEffect(() => {
    if (!mapRef.current || !boundaryCircleRef.current || !fitBoundaryCommand) return;
    if (fitBoundaryCommand === lastFitCmdRef.current) return;
    lastFitCmdRef.current = fitBoundaryCommand;
    mapRef.current.invalidateSize({ animate: false });
    mapRef.current.fitBounds(boundaryCircleRef.current.getBounds(), { padding: [24, 24], maxZoom: 18 });
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
        const pinBg = m.isSelf ? '#2563EB' : isHunter ? '#E11D48' : '#047857';
        const zOffset = m.isSelf ? 1000 : isHunter ? 500 : 100;
        const initials = m.nickname.slice(0, 2).toUpperCase();

        const buildIcon = () => {
          const pulseRing = m.isSelf
            ? `<div style="position:absolute; inset:-4px; border-radius:9999px; background:rgba(37,99,235,0.28); animation:ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>`
            : isHunter
            ? `<div style="position:absolute; inset:-3px; border-radius:9999px; background:rgba(225,29,72,0.22); animation:pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;"></div>`
            : '';

          const html = `
            <div style="position:relative; width:34px; height:34px; display:flex; align-items:center; justify-content:center;">
              ${pulseRing}
              <div style="width:30px; height:30px; border-radius:9999px; background:${pinBg}; border:2.5px solid #FFFFFF; box-shadow:0 2px 8px rgba(0,0,0,0.25); display:flex; align-items:center; justify-content:center; color:#FFFFFF; font-weight:800; font-size:11px; z-index:2; opacity:${m.isStale ? '0.65' : '1'};">
                ${initials}
              </div>
              <div style="position:absolute; top:32px; left:50%; transform:translateX(-50%); background:rgba(255,255,255,0.96); backdrop-filter:blur(4px); border:1px solid rgba(0,0,0,0.08); box-shadow:0 2px 6px rgba(0,0,0,0.12); padding:1.5px 6px; border-radius:8px; font-size:10px; font-weight:700; color:#1C1917; white-space:nowrap; pointer-events:none; z-index:3; display:flex; align-items:center; gap:3px;">
                ${m.isSelf ? '<span style="color:#2563EB; font-weight:900;">YOU</span>•' : ''}
                <span>${m.nickname}</span>
                <span style="color:#78716C; font-weight:500;">±${m.accuracy}m</span>
              </div>
            </div>
          `;
          return L.divIcon({ html, className: '', iconSize: [34, 34], iconAnchor: [17, 17] });
        };

        const existing = markersMapRef.current.get(m.id);
        if (!existing) {
          const icon = buildIcon();
          const marker = L.marker([pos.lat, pos.lng], { icon, zIndexOffset: zOffset }).addTo(map);
          const circle = L.circle([m.lat, m.lng], {
            radius: m.accuracy,
            color: pinBg,
            weight: m.isSelf ? 1.5 : 1,
            fillColor: pinBg,
            fillOpacity: 0.08,
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
      {/* Sleek Floating Map Controls in Top-Right Corner */}
      <div className="absolute top-2.5 right-2.5 z-[500] flex items-center gap-1.5 pointer-events-auto">
        <button
          type="button"
          onClick={() => setMapLayer((prev) => (prev === 'street' ? 'satellite' : 'street'))}
          className="text-xs px-2.5 py-1.5 backdrop-blur-md bg-white/90 hover:bg-white border border-stone-200/80 shadow-sm rounded-lg font-medium text-stone-800 transition flex items-center gap-1 select-none"
        >
          <span>{mapLayer === 'street' ? '🛰️ Satellite' : '🗺️ Street Map'}</span>
        </button>
        {onCenterMe && (
          <button
            type="button"
            onClick={onCenterMe}
            className="text-xs px-2.5 py-1.5 backdrop-blur-md bg-white/90 hover:bg-white border border-stone-200/80 shadow-sm rounded-lg font-medium text-stone-800 transition flex items-center gap-1 select-none"
          >
            <span>🎯 Center</span>
          </button>
        )}
        {onFitBoundary && (
          <button
            type="button"
            onClick={onFitBoundary}
            className="text-xs px-2.5 py-1.5 backdrop-blur-md bg-white/90 hover:bg-white border border-stone-200/80 shadow-sm rounded-lg font-medium text-stone-800 transition flex items-center gap-1 select-none"
          >
            <span>📍 Play Zone</span>
          </button>
        )}
      </div>
    </div>
  );
}

const CampusMap = React.memo(CampusMapInner);
export default CampusMap;
