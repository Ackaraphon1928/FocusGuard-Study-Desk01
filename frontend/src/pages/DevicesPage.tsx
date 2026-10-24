import { ArrowRight, Camera, Check, Cpu, Database, Fan, LampDesk, Radio, ShieldCheck, Sparkles, Sun, Volume2, Wifi } from 'lucide-react';
import type { DataMode, DeskState } from '../lib/types';
import { api } from '../lib/api';
import { useDesk, useDeskMutation } from '../lib/queries';
import { formatNumber, formatTime, humanize, postureLabel } from '../lib/format';
import { Badge, Card, ErrorNotice } from '../components/ui';
import { useToast } from '../components/ToastProvider';

function healthLabel(value: unknown): string {
  if (value === true) return 'Connected';
  if (value === false) return 'Offline';
  if (value && typeof value === 'object' && 'status' in value) return humanize(String(value.status));
  return typeof value === 'string' && value ? humanize(value) : 'Not configured';
}

function booleanLabel(value: unknown, enabled: string, disabled: string) { return value === true ? enabled : value === false ? disabled : 'Unknown'; }

export function DevicesPage() {
  const desk = useDesk();
  const { notify } = useToast();
  const modeMutation = useDeskMutation<DataMode>((mode) => api<DeskState>('/mode', { method: 'POST', body: JSON.stringify({ mode }) }));
  if (!desk.data) return <ErrorNotice error={desk.error} />;
  const state = desk.data;
  const { sensors, health, mode } = state;
  const pcCamera = mode === 'demo' && state.vision_source === 'pc_camera';
  const definitions = [
    { id: 'nodeA', title: 'User interaction node', subtitle: 'ESP32 · ToF + seat pressure', Icon: Radio, topic: 'focusguard/nodeA/user', primary: sensors.distance_cm == null ? 'Unavailable' : `${formatNumber(sensors.distance_cm)} cm`, secondary: sensors.seat_occupied == null ? 'Seat state unknown' : `${sensors.seat_occupied ? 'Seat occupied' : 'Seat unoccupied'} · ${formatNumber(sensors.seat_pressure)} ADC` },
    { id: 'nodeB', title: 'Environment node', subtitle: 'ESP32 · motion + relative sound', Icon: Volume2, topic: 'focusguard/nodeB/environment', primary: sensors.noise_level == null ? 'Unavailable' : `${formatNumber(sensors.noise_level * 100)}% · ${humanize(sensors.noise_state)}`, secondary: booleanLabel(sensors.motion, 'Motion detected', 'No motion') },
    { id: 'gateway_environment', title: 'Environment gateway', subtitle: 'Raspberry Pi · BME280 + BH1750', Icon: Sun, topic: 'focusguard/gateway/environment', primary: sensors.lux == null ? 'Unavailable' : `${formatNumber(sensors.lux)} lux`, secondary: `${formatNumber(sensors.temperature_c, 1)} °C · ${formatNumber(sensors.humidity_percent)}% RH · ${formatNumber(sensors.pressure_hpa)} hPa` },
    { id: 'vision', title: 'Local vision pipeline', subtitle: pcCamera ? 'PC webcam · Python + MediaPipe' : 'Raspberry Pi · OpenCV + MediaPipe', Icon: Camera, topic: 'focusguard/gateway/vision', primary: postureLabel(sensors.posture), secondary: `${formatNumber(sensors.confidence == null ? null : sensors.confidence * 100)}% landmark confidence · ${formatNumber(sensors.fps, 1)} FPS` },
  ];
  const ack = mode === 'hardware' ? state.actuator_ack : null;
  const ackAgeSeconds = ack?.timestamp ? Math.max(0, (Date.parse(state.now) - Date.parse(ack.timestamp)) / 1000) : null;
  const freshAck = ackAgeSeconds != null && ackAgeSeconds < 8;

  async function changeMode(next: DataMode) {
    if (next === mode) return;
    try { await modeMutation.mutateAsync(next); notify(next === 'hardware' ? 'Listening for real sensor data.' : 'Your demo workspace is ready.', 'success'); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not change the data source.', 'error'); }
  }

  return <div className="space-y-6">
    <Card className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
      <div><h2 className="font-semibold text-stone-800">Data source</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-500">{pcCamera ? 'PC camera posture feeds the decision engine. Environment, distance, and actuator outputs remain simulated.' : mode === 'demo' ? 'The simulator feeds the same decision engine used by hardware.' : 'Listening for your local MQTT sensor nodes. Missing readings remain unavailable.'} Switching source saves and ends the current session.</p></div>
      <select aria-label="Data source" value={mode} disabled={modeMutation.isPending} onChange={(event) => changeMode(event.target.value as DataMode)} className="rounded-xl border border-stone-200 bg-[#f9faf5] px-4 py-3 text-sm font-medium text-stone-700 focus:border-[#9fb386] focus:outline-none focus:ring-2 focus:ring-[#dce7d0] disabled:opacity-50"><option value="demo">Demo workspace</option><option value="hardware">Real hardware</option></select>
    </Card>
    {modeMutation.error && <ErrorNotice error={modeMutation.error} />}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
      { label: 'MQTT broker', Icon: Wifi, value: healthLabel(health.mqtt) },
      { label: 'InfluxDB', Icon: Database, value: healthLabel(health.influxdb) },
      { label: 'AWS Bedrock', Icon: Sparkles, value: healthLabel(health.ai) },
      { label: 'Local journal', Icon: Database, value: 'SQLite · stored locally' },
    ].map(({ label, Icon, value }) => <div key={label} className="flex items-center gap-3 rounded-2xl border border-[#e5e7dc] bg-[#f2f4ed] px-4 py-4"><Icon size={18} className="shrink-0 text-[#84996b]" /><div><p className="text-sm font-medium text-stone-700">{label}</p><p className="mt-1 text-xs text-stone-500">{value}</p></div></div>)}</div>
    <div className="grid gap-5 xl:grid-cols-2">{definitions.map(({ id, title, subtitle, Icon, topic, primary, secondary }) => {
      const device = state.devices.find((entry) => entry.id === id || entry.topic === topic);
      const pcVision = pcCamera && id === 'vision';
      const online = pcVision ? sensors.vision_available && device?.status !== 'offline' : device?.status === 'online';
      const connected = pcVision ? online ? 'PC camera online' : 'PC camera unavailable' : device ? mode === 'demo' ? device.status === 'online' ? 'Simulated' : 'Simulated · offline' : humanize(device.status) : 'Awaiting data';
      const lastSeen = pcVision ? state.vision_last_seen ?? device?.last_seen : device?.last_seen;
      return <Card key={id} className="min-w-0 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#f0f3e9] text-[#819866]"><Icon size={22} /></div><div className="min-w-0 flex-1"><h3 className="font-semibold text-stone-800">{title}</h3><p className="mt-1 text-xs text-stone-500">{subtitle}</p></div><Badge tone={online ? 'good' : 'muted'}>{connected}</Badge></div>
        <dl className="my-6 grid gap-x-6 gap-y-5 sm:grid-cols-2">{[
          ['Latest reading', primary], ['Derived state', secondary], ['Last received', lastSeen ? formatTime(lastSeen) : pcVision ? 'No camera metadata yet' : mode === 'demo' ? 'Live simulation' : 'No packets yet'], ['Transport', pcVision ? 'Python pipeline · derived metadata' : mode === 'demo' ? 'Internal simulator' : 'MQTT · local network'],
        ].map(([label, value]) => <div key={label}><dt className="text-xs text-stone-400">{label}</dt><dd className="mt-1.5 break-words text-sm font-medium text-stone-600">{value}</dd></div>)}</dl>
        <code className="block overflow-x-auto rounded-xl bg-[#f5f6f0] px-3 py-3 text-xs text-[#82916d]">{pcVision ? '/api/vision/status' : topic}</code>
      </Card>;
    })}</div>
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold text-stone-800">Actuator delivery</h2><p className="mt-1 text-sm text-stone-500">{mode === 'demo' ? 'Controls apply to the simulated desk.' : 'Compare requested controls with the last state reported by the Raspberry Pi.'}</p></div><Badge tone={mode === 'demo' ? 'muted' : freshAck ? 'good' : 'warning'}>{mode === 'demo' ? 'Simulated outputs' : freshAck ? 'Recent gateway report' : ack ? 'Gateway report stale' : 'Awaiting gateway report'}</Badge></div>
      <div className="mt-6 overflow-x-auto"><table className="w-full min-w-[440px] text-left text-sm"><thead><tr className="border-b border-stone-100 text-xs text-stone-400"><th className="pb-3 font-medium">Output</th><th className="pb-3 font-medium">Requested</th><th className="pb-3 font-medium">{mode === 'demo' ? 'Simulation' : 'Last reported by gateway'}</th></tr></thead><tbody className="divide-y divide-stone-100">
        {[
          { label: 'Desk lamp', Icon: LampDesk, requested: `${formatNumber(state.actuators.lamp_percent)}% · ${humanize(state.actuators.lamp_mode)}`, applied: ack?.lamp_percent == null ? 'Unknown' : `${formatNumber(ack.lamp_percent)}%` },
          { label: 'Desk fan', Icon: Fan, requested: `${state.actuators.fan ? 'On' : 'Off'} · ${humanize(state.actuators.fan_mode)}`, applied: booleanLabel(ack?.fan, 'On', 'Off') },
          { label: 'Buzzer', Icon: Volume2, requested: state.actuators.buzzer ? 'Active' : 'Off', applied: booleanLabel(ack?.buzzer, 'Active', 'Off') },
        ].map(({ label, Icon, requested, applied }) => <tr key={label}><td className="py-4"><span className="flex items-center gap-2 text-stone-600"><Icon size={16} className="text-[#8d9e78]" />{label}</span></td><td className="py-4 text-stone-600">{requested}</td><td className="py-4 text-stone-500">{mode === 'demo' ? <span className="inline-flex items-center gap-1.5"><Check size={14} className="text-[#91a575]" />Simulated</span> : applied}</td></tr>)}
      </tbody></table></div>
      {mode === 'hardware' && <p className="mt-3 text-xs leading-relaxed text-stone-500">{ack ? `Last report: ${formatTime(ack.timestamp)} · command ${ack.command_id || 'unavailable'}. ${freshAck ? '' : 'This report is older than the eight-second command expiry. '}` : 'The gateway has not acknowledged an actuator command. '}A gateway report confirms its output state; physical output measurement requires hardware testing.</p>}
    </Card>
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold text-stone-800">One small, connected ecosystem</h2><span className="text-xs text-stone-400">Edge first. Cloud optional.</span></div>
    <Card className="p-5 sm:p-6">
      <div className="grid items-center gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">{[
        { title: pcCamera ? 'Simulated desk nodes' : 'ESP32 nodes', caption: 'Sensor metadata', Icon: Cpu }, { title: pcCamera ? 'Python backend + camera' : 'Local gateway', caption: pcCamera ? 'MediaPipe pose + rules' : 'Vision + rules + actuators', Icon: Camera }, { title: pcCamera ? 'Local HTTP + FastAPI' : 'MQTT + FastAPI', caption: 'Local messaging', Icon: Wifi }, { title: 'InfluxDB + Grafana', caption: 'Time-series analytics', Icon: Database },
      ].map(({ title, caption, Icon }, index) => <div key={title} className="contents">{index > 0 && <ArrowRight size={18} className="mx-auto hidden text-[#bbc4ad] xl:block" />}<div className="rounded-2xl border border-[#e7ebdf] bg-[#f8faf4] px-3 py-5 text-center"><Icon className="mx-auto mb-3 text-[#8c9f74]" size={22} /><p className="text-sm font-medium text-stone-700">{title}</p><p className="mt-1.5 text-xs text-stone-400">{caption}</p></div></div>)}</div>
      <div className="mt-6 flex gap-3 rounded-xl bg-[#f1f4ea] p-4 text-xs leading-relaxed text-stone-500"><ShieldCheck size={20} className="mt-0.5 shrink-0 text-[#8a9d73]" /><p>{pcCamera ? 'Python captures the PC webcam and runs MediaPipe, calibration and posture classification locally. The dashboard receives derived diagnostics; an optional debug preview streams local images without recording. Desk sensors and outputs are simulated.' : 'Hardware video is processed on the Raspberry Pi. MQTT carries numeric or categorical metadata.'} Hardware actuators use <code className="text-[#6d8354]">focusguard/actuator</code>; configuration uses <code className="text-[#6d8354]">focusguard/config</code>. Optional cloud AI receives aggregate session statistics when you opt in.</p></div>
    </Card>
  </div>;
}
