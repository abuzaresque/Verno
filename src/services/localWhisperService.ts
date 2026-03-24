import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { ChildProcess, spawn } from 'child_process';

const WHISPER_PORT = 9871;

function buildPythonScript(modelSize: string): string {
    return `
import sys
import subprocess
import json
import tempfile
import os

# Auto-install faster-whisper
try:
    from faster_whisper import WhisperModel
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "faster-whisper", "-q"])
    from faster_whisper import WhisperModel

from http.server import HTTPServer, BaseHTTPRequestHandler

model = WhisperModel("${modelSize}", device="cpu", compute_type="int8")

class WhisperHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Silence all logs

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            audio_bytes = self.rfile.read(length)

            # Write to temp file
            tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
            tmp.write(audio_bytes)
            tmp.close()

            try:
                segments, _ = model.transcribe(tmp.name, beam_size=5)
                text = " ".join([seg.text for seg in segments]).strip()
            finally:
                os.unlink(tmp.name)

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"text": text}).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ready"}).encode())
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == '__main__':
    server = HTTPServer(('127.0.0.1', ${WHISPER_PORT}), WhisperHandler)
    server.serve_forever()
`;
}

export class LocalWhisperService {
    private process: ChildProcess | null = null;
    private ready: boolean = false;
    private scriptPath: string = '';

    public async initialize(extensionPath: string): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('verno');
            const whisperMode = config.get<string>('whisperMode', 'hybrid');
            if (whisperMode === 'cloud-only') {
                console.log('[LocalWhisper] Skipped: whisperMode is cloud-only');
                return;
            }

            const modelSize = config.get<string>('localWhisperModel', 'base');

            // Write the Python script to disk
            const scriptsDir = path.join(extensionPath, '.verno-scripts');
            if (!fs.existsSync(scriptsDir)) {
                fs.mkdirSync(scriptsDir, { recursive: true });
            }
            this.scriptPath = path.join(scriptsDir, 'whisper_server.py');
            fs.writeFileSync(this.scriptPath, buildPythonScript(modelSize), 'utf-8');

            // Find Python
            const pythonPath = await this.findPython();
            if (!pythonPath) {
                console.log('[LocalWhisper] Python not found, local whisper unavailable');
                return;
            }

            // Spawn the process
            this.process = spawn(pythonPath, [this.scriptPath], {
                stdio: 'ignore',
                detached: false
            });

            this.process.on('error', (err) => {
                console.error('[LocalWhisper] Process error:', err.message);
                this.ready = false;
            });

            this.process.on('exit', (code) => {
                console.log(`[LocalWhisper] Process exited with code ${code}`);
                this.ready = false;
            });

            // Wait for model load (can take a while for larger models)
            await this.waitForReady(30000);
        } catch (err) {
            console.error('[LocalWhisper] Initialization failed:', err);
        }
    }

    private async findPython(): Promise<string | null> {
        const candidates = ['python3', 'python', 'py'];
        for (const cmd of candidates) {
            try {
                const proc = spawn(cmd, ['--version'], { stdio: 'pipe' });
                const exitCode = await new Promise<number>((resolve) => {
                    proc.on('exit', (code) => resolve(code ?? 1));
                    proc.on('error', () => resolve(1));
                });
                if (exitCode === 0) return cmd;
            } catch {
                continue;
            }
        }
        return null;
    }

    private async waitForReady(timeoutMs: number): Promise<void> {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            try {
                const resp = await fetch(`http://127.0.0.1:${WHISPER_PORT}/health`);
                if (resp.ok) {
                    this.ready = true;
                    console.log('[LocalWhisper] Server ready');
                    return;
                }
            } catch {
                // Server not up yet
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        console.log('[LocalWhisper] Server did not become ready in time');
    }

    public async transcribe(audioBuffer: Buffer): Promise<string> {
        if (!this.ready) {
            throw new Error('Local whisper not available');
        }

        const resp = await fetch(`http://127.0.0.1:${WHISPER_PORT}/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: audioBuffer
        });

        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(`Local whisper error: ${resp.status} ${errText}`);
        }

        const data: any = await resp.json();
        return data.text || '';
    }

    public isAvailable(): boolean {
        return this.ready;
    }

    public dispose(): void {
        if (this.process) {
            try {
                this.process.kill();
            } catch {
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
        } catch {
            // Ignore cleanup errors
        }
    }
}
