import { useId, useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { HistoryPoint } from '../../lib/types';
import { formatNumber, formatTime } from '../../lib/format';

export type HistoryMetric = 'score' | 'distance_cm' | 'lux' | 'noise_level' | 'temperature_c' | 'humidity_percent';

export const historyMetrics: { key: HistoryMetric; label: string; unit: string; color: string }[] = [
  { key: 'score', label: 'Study conditions', unit: '/ 100', color: '#648044' },
  { key: 'distance_cm', label: 'Viewing distance', unit: 'cm', color: '#6d938e' },
  { key: 'lux', label: 'Ambient lighting', unit: 'lux', color: '#b99a5c' },
  { key: 'noise_level', label: 'Relative noise', unit: '%', color: '#b08977' },
  { key: 'temperature_c', label: 'Temperature', unit: '°C', color: '#b8866b' },
  { key: 'humidity_percent', label: 'Humidity', unit: '% RH', color: '#7b92a2' },
];

export function HistoryChart({ points, metric, height = 210 }: { points: HistoryPoint[]; metric: HistoryMetric; height?: number }) {
  const gradientId = useId().replace(/:/g, '');
  const definition = historyMetrics.find((item) => item.key === metric) ?? historyMetrics[0]!;
  const data = useMemo(() => {
    const sorted = [...points].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const result: { timestamp: number; value: number | null }[] = [];
    for (let index = 0; index < sorted.length; index += 1) {
      const point = sorted[index]!;
      const timestamp = Date.parse(point.timestamp);
      if (!Number.isFinite(timestamp)) continue;
      const previous = sorted[index - 1];
      if (previous && timestamp - Date.parse(previous.timestamp) > 5_000) {
        result.push({ timestamp: Date.parse(previous.timestamp) + 1, value: null });
      }
      const value = point[metric];
      result.push({ timestamp, value: typeof value === 'number' && Number.isFinite(value) ? value * (metric === 'noise_level' ? 100 : 1) : null });
    }
    return result;
  }, [points, metric]);

  if (!data.some((point) => point.value !== null)) {
    return <div className="flex items-center justify-center px-5 text-center text-sm text-stone-500" style={{ height }}>No observed values yet. New readings will appear here.</div>;
  }

  return <div role="img" aria-label={`${definition.label} history chart. Missing readings and interrupted telemetry appear as gaps.`} style={{ height }}>
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <AreaChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: -18 }} accessibilityLayer>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={definition.color} stopOpacity={0.22} /><stop offset="100%" stopColor={definition.color} stopOpacity={0.01} /></linearGradient></defs>
        <CartesianGrid stroke="#e8e9e2" strokeDasharray="3 5" vertical={false} />
        <XAxis dataKey="timestamp" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(value: number) => formatTime(new Date(value).toISOString())} tick={{ fontSize: 12, fill: '#85877c' }} axisLine={false} tickLine={false} minTickGap={55} />
        <YAxis domain={metric === 'score' || metric === 'noise_level' || metric === 'humidity_percent' ? [0, 100] : ['auto', 'auto']} tick={{ fontSize: 12, fill: '#85877c' }} axisLine={false} tickLine={false} width={58} tickFormatter={(value: number) => formatNumber(value, metric === 'temperature_c' ? 1 : 0)} />
        <Tooltip content={({ active, payload, label }) => active && payload?.length ? <div className="rounded-xl border border-stone-200 bg-white px-4 py-3 shadow-lg"><p className="mb-1 text-xs text-stone-500">{formatTime(Number(label))}</p><p className="text-sm font-semibold text-stone-700">{formatNumber(typeof payload[0]?.value === 'number' ? payload[0].value : null, metric === 'temperature_c' ? 1 : 0)} {definition.unit}</p></div> : null} />
        <Area type="linear" dataKey="value" stroke={definition.color} strokeWidth={2.25} fill={`url(#${gradientId})`} connectNulls={false} dot={data.length === 1 ? { r: 3 } : false} activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  </div>;
}
