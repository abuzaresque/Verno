import fs from 'fs';
import path from 'path';

const VAD_VERSION = '0.0.19';
const ORT_VERSION = '1.14.0';
const OUT_DIR = path.join(process.cwd(), 'media', 'vad');

if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
}

const files = [
    { url: `https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@${VAD_VERSION}/dist/bundle.min.js`, name: 'vad.bundle.min.js' },
    { url: `https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@${VAD_VERSION}/dist/vad.worklet.bundle.min.js`, name: 'vad.worklet.bundle.min.js' },
    { url: `https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@${VAD_VERSION}/dist/silero_vad.onnx`, name: 'silero_vad.onnx' },
    { url: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort-wasm.wasm`, name: 'ort-wasm.wasm' },
    { url: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort-wasm-simd.wasm`, name: 'ort-wasm-simd.wasm' },
    { url: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort-wasm-threaded.wasm`, name: 'ort-wasm-threaded.wasm' },
    { url: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort-wasm-simd-threaded.wasm`, name: 'ort-wasm-simd-threaded.wasm' }
];

async function download(url, dest) {
    console.log(`Downloading ${path.basename(dest)} from ${url}...`);
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
    }
    const buffer = await res.arrayBuffer();
    fs.writeFileSync(dest, Buffer.from(buffer));
    console.log(`Saved ${path.basename(dest)}`);
}

async function main() {
    for (const f of files) {
        await download(f.url, path.join(OUT_DIR, f.name));
    }
    console.log('All files downloaded successfully.');
}

main().catch(console.error);
