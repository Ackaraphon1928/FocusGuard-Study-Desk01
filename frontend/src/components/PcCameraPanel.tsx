import { Camera, CameraOff, Check, CircleHelp, Info, LoaderCircle, ScanLine, ShieldCheck, SlidersHorizontal, Square } from 'lucide-react';
import type { DeskState, Posture } from '../lib/types';
import { formatNumber } from '../lib/format';
import { usePcCamera } from '../lib/vision/usePcCamera';
import { poseDescriptions, trackingHint } from '../lib/vision/protocol';
import type { CameraView } from '../lib/vision/posture';
import { Badge, Button, Card, ErrorNotice } from './ui';

const postureLabels: Posture[] = ['GOOD', 'SLOUCH', 'LEAN_FORWARD', 'LEAN_LEFT_RIGHT', 'NO_PERSON', 'UNKNOWN'];

export function PcCameraPanel({ state }: {state: DeskState}) {
  const camera = usePcCamera(state);
  const active = ['requesting', 'loading', 'running'].includes(camera.status);
  const running = camera.status === 'running';
  const observation = camera.observation;
  const posture = observation?.result.posture ?? 'UNKNOWN';
  const calibration = observation?.result.calibration;
  const calibrated = calibration?.status === 'ready';
  const collecting = calibration?.status === 'collecting';
  const pcSelected = state.vision_source === 'pc_camera';
  const geometry = observation?.result.geometry;
  const upperBody = geometry?.trackingMode === 'upper_body';
  const trackingMode = !geometry ? 'Waiting for usable points' : upperBody ? 'Upper body · head + shoulders' : 'Full body · hips available';

  return <Card id="pc-camera" className="scroll-mt-5 overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line p-5"><div><h2 className="flex items-center gap-2 text-base font-semibold"><Camera className="size-4 text-pine" />PC camera · pose lab</h2><p className="mt-2 text-xs leading-6 text-muted">MediaPipe on this PC. Video and skeleton stay local; only posture metadata reaches FocusGuard.</p></div><Badge tone={running ? 'good' : 'muted'}>{running ? 'Live PC vision' : pcSelected ? 'PC vision · camera off' : 'Camera off'}</Badge></div>
    <div className={`grid gap-6 p-5 ${active ? 'xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]' : 'lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,1fr)]'}`}>
      <div className="min-w-0">
        <div className={`relative overflow-hidden rounded-xl bg-[#13231b] ${active ? '' : 'min-h-52'}`} style={{ aspectRatio: `${camera.width} / ${camera.height}` }}>
          <video ref={camera.videoRef} aria-label="Local PC camera preview" autoPlay muted playsInline className={`absolute inset-0 size-full object-contain ${camera.mirrored ? '-scale-x-100' : ''} ${active ? '' : 'invisible'}`} />
          <canvas ref={camera.canvasRef} aria-hidden="true" className={`pointer-events-none absolute inset-0 size-full object-contain ${camera.mirrored ? '-scale-x-100' : ''}`} />
          {!active && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center"><CameraOff className="size-8 text-sage" /><p className="text-sm font-medium text-white/85">Try real posture detection with your webcam</p><p className="max-w-md text-xs leading-6 text-white/45">No image upload or audio capture. In Front view, keep your head and shoulders visible, then calibrate while sitting upright. Hips may stay behind the desk.</p></div>}
          {active && !running && <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-pine-dark/75 p-6 text-center text-white"><LoaderCircle className="size-7 animate-spin" /><p className="text-xs leading-6">{camera.message}</p></div>}
          {running && <><div className="absolute top-3 left-3 flex flex-wrap gap-2"><span className="rounded-md bg-black/65 px-2.5 py-1.5 text-[10px] font-medium text-lime">{formatNumber(observation?.fps, 1)} actual FPS</span><span className="rounded-md bg-black/65 px-2.5 py-1.5 text-[10px] text-white/80">{camera.delegate} · local inference</span></div><div className="absolute right-3 bottom-3 left-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-black/70 px-3 py-2.5"><span className="text-xs font-semibold tracking-wide text-white">{collecting ? 'CALIBRATING' : posture}</span><span className="text-[10px] text-white/70">{poseDescriptions[posture]}</span></div></>}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted"><span className="flex items-center gap-1.5"><ShieldCheck className="size-3" />Live video is visible only in this browser</span><span>{running && observation ? `${observation.width} × ${observation.height} · ${formatNumber(observation.inferenceMs, 1)} ms inference` : 'Video + pose overlay · no recording'}</span></div>
        {camera.error && <div className="mt-4"><ErrorNotice error={new Error(camera.error)} /></div>}
        {camera.publishingError && <div className="mt-4"><ErrorNotice error={new Error(camera.publishingError)} /></div>}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap gap-2">{!active ? <Button onClick={() => void camera.start()} disabled={state.mode !== 'demo'}><Camera />Start PC camera</Button> : <Button variant="secondary" onClick={() => camera.stop()}><Square />Stop camera</Button>}{pcSelected && <Button variant="ghost" onClick={() => void camera.useSimulated()}>Use simulated vision</Button>}</div>
        {state.mode !== 'demo' && <p className="text-xs leading-6 text-amber-800">Choose Demo workspace in Devices & network to use this PC camera lab. Hardware mode uses the Raspberry Pi.</p>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2"><label className="text-xs text-muted">Camera view<select aria-label="Camera view" value={camera.view} onChange={event => camera.setView(event.target.value as CameraView)} className="mt-2 block w-full rounded-lg border border-line bg-white px-3 py-2.5 text-xs text-ink"><option value="front">Front · PC webcam</option><option value="side">Side · profile view</option></select></label><label className="text-xs text-muted">Camera device<select aria-label="Camera device" value={camera.deviceId} disabled={active} onChange={event => camera.setDeviceId(event.target.value)} className="mt-2 block w-full rounded-lg border border-line bg-white px-3 py-2.5 text-xs text-ink disabled:opacity-50"><option value="">Default webcam</option>{camera.cameras.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}</select></label></div>
        <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={camera.mirrored} onChange={event => camera.setMirrored(event.target.checked)} />Mirror preview</label>
        <div className="rounded-xl border border-line bg-canvas p-4"><div className="flex items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-xs font-semibold"><ScanLine className="size-4 text-sage" />Your neutral posture</h3><Badge tone={calibrated ? 'good' : 'muted'}>{calibrated ? 'Calibrated' : collecting ? 'Collecting' : 'Not calibrated'}</Badge></div><p className="mt-3 text-xs leading-6 text-muted">{observation ? trackingHint(observation.result.reason) : camera.message}</p>{collecting && <p className="mt-2 text-xs font-medium tabular-nums text-pine">{calibration.frames} / {calibration.required} reliable frames</p>}<Button variant="secondary" className="mt-4 w-full" onClick={camera.calibrate} disabled={!running}>{calibrated ? <Check /> : <SlidersHorizontal />}{calibrated ? 'Recalibrate upright posture' : 'Calibrate upright posture'}</Button></div>
        {running && <><div className="rounded-xl border border-line p-3 text-xs" aria-label="Local tracking diagnostics"><p className="font-medium text-pine">{trackingMode}</p><p className="mt-2 break-words text-[10px] leading-5 text-muted">Tracking reason: <code>{observation?.result.reason ?? 'waiting_for_frame'}</code>{observation && <> · Candidate: {observation.result.candidate}</>}</p></div><div className="grid grid-cols-2 gap-3 text-xs"><div><p className="text-muted">Landmark reliability</p><strong className="mt-2 block text-base font-medium text-pine">{formatNumber(geometry == null ? null : geometry.confidence * 100)}%</strong></div><div><p className="text-muted">{upperBody ? 'Shoulder tilt' : 'Torso angle'}</p><strong className="mt-2 block text-base font-medium text-pine">{formatNumber(upperBody ? geometry?.shoulderAngleDeg : geometry?.torsoAngleDeg, 1)}°</strong></div></div></>}
        <div className="flex items-start gap-2 rounded-xl bg-sage-light p-3 text-[11px] leading-6 text-muted"><Info className="mt-1 size-3.5 shrink-0 text-sage" /><p>Camera posture and FPS are real. Lighting, noise, pressure, and ToF distance are simulated in this demo. A webcam does not measure viewing distance in centimeters.</p></div>
      </div>
    </div>
    <div className="border-t border-line px-5 py-4"><div className="flex flex-wrap gap-2">{postureLabels.map(label => <span key={label} className={`rounded-md border px-2.5 py-1.5 text-[10px] font-medium ${running && posture === label ? 'border-sage bg-sage-light text-pine' : 'border-line text-muted'}`} title={poseDescriptions[label]}>{label}</span>)}</div><p className="mt-3 flex items-start gap-2 text-[10px] leading-6 text-muted"><CircleHelp className="mt-1 size-3.5 shrink-0" />Calibrate before interpreting labels. Front-view forward lean uses calibrated size and head-to-shoulder changes; slouch includes head collapse or reclined, chin-up posture. These are posture proxies, without absolute depth or spine measurements. Missing head/shoulders, low visibility, multiple people or incomplete calibration produce UNKNOWN. Navigating away or hiding the tab stops the camera.</p></div>
  </Card>;
}
