'use client';

import React, { useEffect, useRef } from 'react';

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

interface CampusMapProps {
  mode: 'setup' | 'gameplay';
  boundary: { lat: number; lng: number; radiusMeters: number };
  markers?: MapParticipantMarker[];
  onSetupBoundaryMove?: (lat: number, lng: number) => void;
  centerCommand?: { lat: number; lng: number; zoom?: number; ts: number } | null;
  fitBoundaryCommand?: number;
}

export default function CampusMap({
  mode,
  boundary,
  markers = [],
  onSetupBoundaryMove,
  centerCommand,
  fitBoundaryCommand,
}: CampusMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const boundaryCircleRef = useRef<any>(null);
  const setupCenterMarkerRef = useRef<any>(null);
  const markersMapRef = useRef<Map<string, { marker: any; circle: any }>>(new Map());

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

      const map = L.map(containerRef.current, {
        zoomControl: mode === 'setup',
        scrollWheelZoom: mode === 'gameplay',
        attributionControl: true,
      }).setView([boundary.lat, boundary.lng], 16);

      if (mode === 'gameplay') {
        L.control.zoom({ position: 'bottomleft' }).addTo(map);
      }

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(map);

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
      }
    };
  }, []);

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
    mapRef.current.invalidateSize({ animate: false });
    mapRef.current.flyTo([centerCommand.lat, centerCommand.lng], centerCommand.zoom || 17, { duration: 0.4 });
  }, [centerCommand]);

  useEffect(() => {
    if (!mapRef.current || !boundaryCircleRef.current || !fitBoundaryCommand) return;
    mapRef.current.invalidateSize({ animate: false });
    mapRef.current.fitBounds(boundaryCircleRef.current.getBounds(), { padding: [24, 24] });
  }, [fitBoundaryCommand]);

  useEffect(() => {
    async function syncMarkers() {
      if (mode !== 'gameplay' || !mapRef.current) return;
      const L = (await import('leaflet')).default;
      const map = mapRef.current;
      const activeIds = new Set<string>();

      // Compute spiderfy/offset positions when multiple players share nearly identical coordinates
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
        const selfBadge = m.isSelf
          ? `<span style="background:#2563EB;color:#FFFFFF;padding:1px 5px;border-radius:5px;font-weight:800;font-size:9px;margin-right:3px;">YOU</span>`
          : '';
        const roleBadge = `<span style="background:${badgeBg};color:#FFFFFF;padding:1px 5px;border-radius:5px;font-weight:800;font-size:9px;margin-right:4px;">${roleLabel}</span>`;
        const selfRingStyle = m.isSelf
          ? 'border:3px solid #FFFFFF; box-shadow: 0 0 0 4px #2563EB, 0 0 14px rgba(37,99,235,0.75);'
          : isHunter
          ? 'border:3px solid #FEE2E2; box-shadow: 0 0 0 2px #991B1B, 0 3px 10px rgba(0,0,0,0.35);'
          : 'border:3px solid #DCFCE7; box-shadow: 0 0 0 2px #14532D, 0 3px 10px rgba(0,0,0,0.3);';
        const ageText = m.isStale ? `Stale ${m.ageSeconds}s` : `${m.ageSeconds}s`;

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

        const icon = L.divIcon({ html, className: '', iconSize: [40, 40], iconAnchor: [20, 20] });
        const zOffset = m.isSelf ? 1000 : isHunter ? 500 : 100;
        const existing = markersMapRef.current.get(m.id);
        if (!existing) {
          const marker = L.marker([pos.lat, pos.lng], { icon, zIndexOffset: zOffset }).addTo(map);
          const circle = L.circle([m.lat, m.lng], {
            radius: m.accuracy,
            color: m.isSelf ? '#2563EB' : pinBg,
            weight: m.isSelf ? 1.5 : 1,
            fillColor: m.isSelf ? '#3B82F6' : pinBg,
            fillOpacity: 0.1,
            interactive: false,
          }).addTo(map);
          markersMapRef.current.set(m.id, { marker, circle });
        } else {
          existing.marker.setLatLng([pos.lat, pos.lng]);
          existing.marker.setIcon(icon);
          if (existing.marker.setZIndexOffset) {
            existing.marker.setZIndexOffset(zOffset);
          }
          existing.circle.setLatLng([m.lat, m.lng]);
          existing.circle.setRadius(m.accuracy);
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
    <div
      ref={containerRef}
      style={{ position: 'relative', zIndex: 1, isolation: 'isolate' }}
      className={`map-stack-container w-full h-full ${mode === 'setup' ? 'cursor-crosshair' : ''}`}
    />
  );
}
