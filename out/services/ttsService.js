"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TTSService = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
const TTS_PORT = 9872;
function buildTTSPythonScript(voice, speed, port) {
    return `
import sys
import subprocess
import json

# Auto-install dependencies
def ensure_deps():
    deps = ["kokoro", "sounddevice", "numpy"]
    for dep in deps:
        try:
            __import__(dep)
        except ImportError:
            subprocess.check_call([sys.executable, "-m", "pip", "install", dep, "-q"])

ensure_deps()

import numpy as np
import sounddevice as sd
from http.server import HTTPServer, BaseHTTPRequestHandler
from kokoro import KPipeline
import time
import threading
import os

last_heartbeat = time.time()

def heartbeat_monitor():
    global last_heartbeat
    while True:
        time.sleep(5)
        if time.time() - last_heartbeat > 30:
            print("No heartbeat for 30s. Self-destructing.", flush=True)
            os._exit(0)

pipeline = KPipeline(lang_code='a')
VOICE = '${voice}'
SPEED = ${speed}

class TTSHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Silence all logs

    def do_POST(self):
        if self.path == '/speak':
            try:
                length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(length)
                data = json.loads(body)
                text = data.get('text', '')

                if text.strip():
                    generator = pipeline(text, voice=VOICE, speed=SPEED)
                    audio_parts = []
                    for _, _, audio in generator:
                        if audio is not None:
                            audio_parts.append(audio)
                    if audio_parts:
                        full_audio = np.concatenate(audio_parts)
                        sd.play(full_audio, samplerate=24000)
                        sd.wait()

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True}).encode())
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        if self.path == '/health':
            global last_heartbeat
            last_heartbeat = time.time()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ready"}).encode())
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == '__main__':
    t = threading.Thread(target=heartbeat_monitor, daemon=True)
    t.start()
    server = HTTPServer(('127.0.0.1', ${port}), TTSHandler)
    server.serve_forever()
`;
}
class TTSService {
    process = null;
    ready = false;
    scriptPath = '';
    lockfilePath = '';
    pingInterval = null;
    extensionPath = '';
    configListener = null;
    async initialize(extensionPath) {
        this.extensionPath = extensionPath;
        const config = vscode.workspace.getConfiguration('verno');
        const ttsEnabled = config.get('ttsEnabled', true);
        if (!ttsEnabled) {
            console.log('[TTSService] TTS disabled via settings');
            return;
        }
        try {
            // Write the Python script to disk
            const scriptsDir = path.join(extensionPath, '.verno-scripts');
            if (!fs.existsSync(scriptsDir)) {
                fs.mkdirSync(scriptsDir, { recursive: true });
            }
            this.scriptPath = path.join(scriptsDir, 'tts_server.py');
            this.lockfilePath = path.join(scriptsDir, 'tts.pid');
            const voice = config.get('ttsVoice', 'af_heart');
            const speed = config.get('ttsSpeed', 1.1);
            fs.writeFileSync(this.scriptPath, buildTTSPythonScript(voice, speed, TTS_PORT), 'utf-8');
            // Find Python
            const pythonPath = await this.findPython();
            if (!pythonPath) {
                console.log('[TTSService] Python not found, TTS unavailable');
                return;
            }
            // Check lockfile and kill stale process
            if (fs.existsSync(this.lockfilePath)) {
                try {
                    const oldPidStr = fs.readFileSync(this.lockfilePath, 'utf-8').trim();
                    const oldPid = parseInt(oldPidStr, 10);
                    if (!isNaN(oldPid)) {
                        console.log(`[TTSService] Found stale PID ${oldPid}, attempting to kill...`);
                        try {
                            process.kill(oldPid, 0); // Check if process exists
                            process.kill(oldPid, 'SIGKILL'); // Kill it
                            await new Promise(r => setTimeout(r, 1000)); // Wait for port to free
                        }
                        catch (e) {
                            if (e.code !== 'ESRCH') {
                                console.warn('[TTSService] Stale PID kill failed:', e.code);
                            }
                        }
                    }
                }
                catch (err) {
                    console.warn('[TTSService] Failed to read or parse lockfile:', err);
                }
            }
            // Spawn the process
            this.process = (0, child_process_1.spawn)(pythonPath, [this.scriptPath], {
                stdio: 'ignore',
                detached: false
            });
            if (this.process.pid) {
                fs.writeFileSync(this.lockfilePath, this.process.pid.toString(), 'utf-8');
            }
            this.process.on('error', (err) => {
                console.error('[TTSService] Process error:', err.message);
                this.ready = false;
            });
            this.process.on('exit', (code) => {
                console.log(`[TTSService] Process exited with code ${code}`);
                this.ready = false;
            });
            // Wait for the model to load
            await this.waitForReady(15000);
            // Start heartbeat ping
            if (this.ready) {
                this.pingInterval = setInterval(async () => {
                    try {
                        await fetch(`http://127.0.0.1:${TTS_PORT}/health`);
                    }
                    catch {
                        // Ignore ping failures
                    }
                }, 10000); // Ping every 10 seconds
                // Listen for config changes
                if (!this.configListener) {
                    this.configListener = vscode.workspace.onDidChangeConfiguration(async (e) => {
                        if (e.affectsConfiguration('verno.ttsVoice') ||
                            e.affectsConfiguration('verno.ttsSpeed')) {
                            console.log('[TTSService] Voice config changed, restarting server...');
                            const wasReady = this.ready;
                            this.dispose(); // kills process, clears intervals but keeps this instance
                            // Re-initialize using stored path if it was previously enabled
                            if (wasReady) {
                                await this.initialize(this.extensionPath);
                            }
                        }
                    });
                }
            }
        }
        catch (err) {
            console.error('[TTSService] Initialization failed:', err);
        }
    }
    async findPython() {
        const candidates = ['python3', 'python', 'py'];
        for (const cmd of candidates) {
            try {
                const proc = (0, child_process_1.spawn)(cmd, ['--version'], { stdio: 'pipe' });
                const exitCode = await new Promise((resolve) => {
                    proc.on('exit', (code) => resolve(code ?? 1));
                    proc.on('error', () => resolve(1));
                });
                if (exitCode === 0)
                    return cmd;
            }
            catch {
                continue;
            }
        }
        return null;
    }
    async waitForReady(timeoutMs) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            try {
                const resp = await fetch(`http://127.0.0.1:${TTS_PORT}/health`);
                if (resp.ok) {
                    this.ready = true;
                    console.log('[TTSService] Server ready');
                    return;
                }
            }
            catch {
                // Server not up yet
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        console.log('[TTSService] Server did not become ready in time');
    }
    async speak(text) {
        if (!text || text.trim().length === 0)
            return;
        if (this.ready) {
            try {
                const resp = await fetch(`http://127.0.0.1:${TTS_PORT}/speak`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text })
                });
                if (resp.ok)
                    return;
            }
            catch (err) {
                console.error('[TTSService] Speak failed, falling back:', err);
            }
        }
        // Fallback: show as VS Code status bar message
        vscode.window.setStatusBarMessage(`🔊 ${text}`, 5000);
    }
    dispose() {
        if (this.configListener) {
            this.configListener.dispose();
            this.configListener = null;
        }
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        if (this.process) {
            try {
                this.process.kill('SIGKILL');
            }
            catch {
                // Process may have already exited
            }
            this.process = null;
        }
        this.ready = false;
        // Clean up script file
        try {
            if (this.scriptPath && fs.existsSync(this.scriptPath)) {
                fs.unlinkSync(this.scriptPath);
            }
            if (this.lockfilePath && fs.existsSync(this.lockfilePath)) {
                fs.unlinkSync(this.lockfilePath);
            }
        }
        catch {
            // Ignore cleanup errors
        }
    }
}
exports.TTSService = TTSService;
//# sourceMappingURL=ttsService.js.map