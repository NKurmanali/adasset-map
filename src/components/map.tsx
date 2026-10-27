'use client';
import { useEffect, useRef, useState } from 'react';
import type { Map as LMap } from 'leaflet';
import type { Row } from '@/lib/domain';
import { labels } from '@/lib/i18n';
import { MAP_CENTER } from '@/lib/location';
const colors: Record<string, string> = {
  healthy: '#23a17c',
  remarks: '#d0a023',
  repair: '#e08b36',
  critical: '#db5656',
  unknown: '#8895a7',
};
export default function MapView({
  assets,
  onSelect,
  onPick,
  selected,
  compact = false,
  t,
}: {
  assets: Row[];
  onSelect?: (a: Row) => void;
  onPick?: (lat: number, lng: number) => void;
  selected?: string;
  compact?: boolean;
  t: (s: string) => string;
}) {
  const el = useRef<HTMLDivElement>(null),
    map = useRef<LMap | null>(null),
    layer = useRef<any>(null),
    callback = useRef(onSelect),
    pick = useRef(onPick);
  callback.current = onSelect;
  pick.current = onPick;
  const [ready, setReady] = useState(false),
    [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    (async () => {
      try {
        const module = await import('leaflet');
        const L = module.default || module;
        (window as unknown as { L: typeof L }).L = L;
        await import('leaflet.markercluster');
        if (cancelled || !el.current) return;
        const m = L.map(el.current, { zoomControl: false, attributionControl: true }).setView(
          MAP_CENTER,
          12,
        );
        map.current = m;
        L.control.zoom({ position: 'bottomright' }).addTo(m);
        const tiles = L.tileLayer(
          process.env.NEXT_PUBLIC_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
          {
            maxZoom: 19,
            attribution:
              process.env.NEXT_PUBLIC_TILE_ATTRIBUTION ||
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          },
        );
        tiles.on('tileerror', () => setError(true));
        tiles.on('tileload', () => setError(false));
        tiles.addTo(m);
        layer.current = L.markerClusterGroup({
          showCoverageOnHover: false,
          maxClusterRadius: 42,
          spiderfyOnMaxZoom: true,
          iconCreateFunction: (cluster) =>
            L.divIcon({
              html: `<span>${cluster.getChildCount()}</span>`,
              className: 'asset-cluster',
              iconSize: [40, 40],
            }),
        });
        m.addLayer(layer.current);
        let chosen: any = null;
        m.on('click', (e) => {
          if (pick.current) {
            pick.current(e.latlng.lat, e.latlng.lng);
            chosen?.remove();
            chosen = L.circleMarker(e.latlng, {
              radius: 10,
              color: '#2563eb',
              weight: 3,
              fillOpacity: 0.4,
            }).addTo(m);
          }
        });
        const ro = new ResizeObserver(() => m.invalidateSize());
        ro.observe(el.current);
        cleanup = () => {
          ro.disconnect();
          m.remove();
          map.current = null;
        };
        setReady(true);
      } catch (error) {
        console.error('Map initialization failed', error);
        setError(true);
      }
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);
  useEffect(() => {
    if (!ready || !layer.current) return;
    import('leaflet').then((module) => {
      const L = module.default || module;
      layer.current.clearLayers();
      for (const a of assets) {
        const color = ['suspended', 'dismantled'].includes(a.lifecycle)
          ? colors.unknown : colors[a.technical_state] || colors.unknown;
        const title = `${a.number} · ${a.name} · ${t(labels[a.technical_state] || 'Неизвестно')}${a.inspection_state === 'overdue' ? ' · '+t('Просроченные осмотры') : ''}`;
        const icon = L.divIcon({
          className: 'asset-marker-wrap',
          html: `<div class="asset-marker ${selected === a.id ? 'selected' : ''}" style="--marker:${color}"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M9 16v5m6-5v5M6 21h12"/></svg>${a.document_state !== 'valid' ? '<b>!</b>' : ''}${a.inspection_state === 'overdue' ? '<b class="inspection-alert">◷</b>' : ''}</div>`,
          iconSize: [34, 39],
          iconAnchor: [17, 39],
        });
        const marker = L.marker([a.latitude, a.longitude], {
          icon,
          title,
          alt: title,
        });
        const tip = document.createElement('span');
        tip.textContent = title;
        marker.bindTooltip(tip).on('click', () => callback.current?.(a));
        layer.current.addLayer(marker);
      }
    });
  }, [assets, ready, selected]);
  return (
    <div className={`map-container ${compact ? 'compact' : ''}`}>
      <div ref={el} className="map-canvas" />
      {!ready && !error && <div className="map-message">{t('Карта загружается…')}</div>}
      {error && (
        <div className="map-failure">
          {t('Карта недоступна. Реестр и карточки продолжают работать.')}
        </div>
      )}
      {assets.some((a) => a.demo) && (
        <div className="map-label">
          <span className="pulse" />
          {t('Демонстрационные данные')}
        </div>
      )}
      {!onPick && (
        <div className="map-legend">
          {Object.entries(colors).map(([k, c]) => (
            <span key={k}>
              <i style={{ background: c }} />
              {t(
                (
                  {
                    healthy: 'Исправно',
                    remarks: 'Есть замечания',
                    repair: 'Требуется ремонт',
                    critical: 'Критическое состояние',
                    unknown: 'Неизвестно',
                  } as any
                )[k],
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
