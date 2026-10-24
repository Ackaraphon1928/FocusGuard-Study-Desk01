/** Prepare versioned MediaPipe assets at install/build time; never fetch models in the browser. */
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = join(frontend, 'node_modules', '@mediapipe', 'tasks-vision')
const output = join(frontend, 'public', 'vision')
const version = '0.10.32'
const modelName = 'pose_landmarker_lite.task'
const modelUrl = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
const modelSha256 = '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a'
const modelBytes = 5_777_746
const wasmFiles = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
]
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function existingFile(path) {
  try {
    return await readFile(path)
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}

function validateModel(bytes, source) {
  if (bytes.byteLength !== modelBytes || sha256(bytes) !== modelSha256) {
    throw new Error(`MediaPipe model integrity check failed: ${source}. Expected SHA256 ${modelSha256}. Remove or replace this file with the official version-1 lite model and rerun npm run prepare:vision.`)
  }
}

async function prepare() {
  const installed = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  if (installed.version !== version) {
    throw new Error(`Expected @mediapipe/tasks-vision ${version}; installed ${installed.version}. Run npm ci.`)
  }
  await mkdir(join(output, 'wasm'), { recursive: true })
  const assets = []
  for (const filename of wasmFiles) {
    const source = join(packageRoot, 'wasm', filename)
    const bytes = await readFile(source)
    await copyFile(source, join(output, 'wasm', filename))
    assets.push({ path: `wasm/${filename}`, bytes: bytes.byteLength, sha256: sha256(bytes) })
  }

  const modelPath = join(output, modelName)
  let model = await existingFile(modelPath)
  if (model) {
    validateModel(model, modelPath)
  } else {
    // Reuse the same reviewed model used by the Pi adapter when available offline.
    const piModel = resolve(frontend, '..', 'raspberry_pi', 'models', modelName)
    model = await existingFile(piModel)
    if (model) {
      validateModel(model, piModel)
    } else {
      console.log(`Downloading official MediaPipe pose model: ${modelUrl}`)
      const response = await fetch(modelUrl, { signal: AbortSignal.timeout(90_000) })
      if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}`)
      if (Number(response.headers.get('content-length') ?? modelBytes) > 20_000_000) {
        throw new Error('Unexpectedly large model download; refusing to use it')
      }
      model = Buffer.from(await response.arrayBuffer())
      validateModel(model, modelUrl)
    }
    // Only a complete, hash-verified model becomes visible to dev/build servers.
    await writeFile(`${modelPath}.tmp`, model)
    await rename(`${modelPath}.tmp`, modelPath)
  }
  const metadata = {
    package: '@mediapipe/tasks-vision', version,
    model: { path: modelName, source: modelUrl, bytes: modelBytes, sha256: modelSha256 },
    assets,
    license: 'Apache-2.0',
  }
  await writeFile(join(output, 'assets.json'), `${JSON.stringify(metadata, null, 2)}\n`)
  console.log(`MediaPipe ${version}: local WASM + verified model ready (${(await stat(modelPath)).size} bytes)`)

  const workerEntry = join(frontend, 'src', 'workers', 'pose.worker.ts')
  if (await existingFile(workerEntry)) {
    // Tasks Vision 0.10.x loads Emscripten with importScripts. It needs a classic
    // worker even in Vite development, where source workers normally use ESM.
    const { build } = await import('vite')
    await build({
      configFile: false,
      root: frontend,
      publicDir: false,
      build: {
        lib: { entry: workerEntry, formats: ['iife'], name: 'FocusGuardPoseWorker', fileName: () => 'pose.worker.js' },
        outDir: output,
        emptyOutDir: false,
        sourcemap: false,
      },
    })
  } else {
    // Docker installs dependencies before copying sources; prebuild runs again.
    console.log('Pose worker source not present yet; predev/prebuild will bundle it after sources are copied.')
  }
}

prepare().catch((error) => {
  console.error(`\nCould not prepare local vision assets: ${error.message}`)
  console.error('Use npm run prepare:vision to retry. First-time setup needs access to storage.googleapis.com or the verified model at raspberry_pi/models/pose_landmarker_lite.task.')
  process.exitCode = 1
})
