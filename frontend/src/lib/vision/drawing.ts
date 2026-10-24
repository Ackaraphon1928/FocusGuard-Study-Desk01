import type { PoseObservation } from './protocol';
import type { Landmark } from './posture';

const edges = [[0, 7], [0, 8], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28]];

function visible(point: Landmark | undefined): point is Landmark {
  return !!point && (point.visibility ?? 1) >= .5 && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

export function drawPose(canvas: HTMLCanvasElement, observation: PoseObservation): void {
  if (canvas.width !== observation.width) canvas.width = observation.width;
  if (canvas.height !== observation.height) canvas.height = observation.height;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  const color = observation.result.posture === 'GOOD' ? '#c7e1a4' : observation.result.posture === 'UNKNOWN' ? '#d7c5a4' : '#ffb879';
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = Math.max(2, canvas.width / 220);
  context.lineCap = 'round';
  for (const landmarks of observation.landmarks) {
    for (const [from, to] of edges) {
      const a = landmarks[from!]; const b = landmarks[to!];
      if (!visible(a) || !visible(b)) continue;
      context.beginPath(); context.moveTo(a.x * canvas.width, a.y * canvas.height); context.lineTo(b.x * canvas.width, b.y * canvas.height); context.stroke();
    }
    for (const index of new Set(edges.flat())) {
      const point = landmarks[index];
      if (!visible(point)) continue;
      context.beginPath(); context.arc(point.x * canvas.width, point.y * canvas.height, Math.max(3, canvas.width / 160), 0, Math.PI * 2); context.fill();
    }
  }
}
