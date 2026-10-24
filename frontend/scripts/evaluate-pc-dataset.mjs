/** Replay actual locally extracted landmarks through the production classifier. */
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(frontend, '..')
const output = resolve(root, 'evaluation/results/pc-dataset')
const dataset = JSON.parse(await readFile(join(frontend, 'src/test/fixtures/pc-dataset.landmarks.json'), 'utf8'))
await mkdir(output, { recursive: true })
await build({
  configFile: false, root: frontend, publicDir: false, logLevel: 'error',
  build: {
    lib: { entry: join(frontend, 'src/lib/vision/posture.ts'), formats: ['es'], fileName: () => 'posture.mjs' },
    outDir: output, emptyOutDir: false,
  },
})
const { PostureClassifier, extractPoseGeometry } = await import(pathToFileURL(join(output, 'posture.mjs')).href)
const neutral = dataset.images.find(image => image.label === 'GOOD')
if (!neutral || neutral.landmarks.length !== 1) throw new Error('Dataset needs one detected GOOD calibration reference')
const frame = (image, timestampMs) => ({
  landmarks: image.landmarks, worldLandmarks: image.worldLandmarks,
  width: image.width, height: image.height, timestampMs,
})
const rows = dataset.images.map(image => {
  const classifier = new PostureClassifier({ view: 'front' })
  classifier.startCalibration()
  for (let index = 0; index < 30; index++) classifier.update(frame(neutral, index * 100))
  // This replays fixed extracted coordinates to exercise calibration/debounce;
  // repeated stills are not independent camera frames or an accuracy benchmark.
  let result
  for (let index = 0; index < 15; index++) result = classifier.update(frame(image, 3_000 + index * 100))
  const geometry = extractPoseGeometry(image.landmarks[0] ?? [], image.width, image.height, 'front', image.worldLandmarks?.[0]).geometry
  return {
    filename: image.filename, expected: image.label, predicted: result.posture,
    pass: result.posture === image.label, reason: result.reason, confidence: result.confidence,
    tracking_mode: geometry?.trackingMode ?? null, upper_body: geometry?.upperBody ?? null,
  }
})
const labels = ['GOOD', 'SLOUCH', 'LEAN_FORWARD', 'LEAN_LEFT_RIGHT', 'NO_PERSON', 'UNKNOWN']
const confusion = Object.fromEntries(labels.map(actual => [actual, Object.fromEntries(labels.map(predicted => [predicted, rows.filter(row => row.expected === actual && row.predicted === predicted).length]))]))
const report = {
  kind: 'user_provided_tuning_regression_not_independent_accuracy',
  provenance: dataset.provenance,
  calibration: 'Single GOOD reference replayed; the same reference is also a GOOD regression case.',
  limitations: 'Seven screenshots from one person, used for tuning. Native CPU VIDEO extraction with repeated stills is not browser GPU/live-camera validation. No held-out test data.',
  matched: rows.filter(row => row.pass).length, total: rows.length, rows, confusion,
}
await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.table(rows.map(({ filename, expected, predicted, pass, confidence }) => ({ filename, expected, predicted, pass, confidence: confidence.toFixed(3) })))
console.log(`Tuning regression: ${report.matched}/${report.total}; report: ${join(output, 'report.json')}`)
if (report.matched !== report.total) process.exitCode = 1
