/**
 * Conversation-focused HTML template for Verno Agent Panel
 * Features: Dynamic providers, conversations history, MCP marketplace, settings panel
 */

interface VadPaths {
    bundlePath: string;
    workletPath: string;
    modelPath: string;
    wasmRoot: string;
}

export function getConversationHTML(nonce: string, vadPaths?: VadPaths): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' https://cdn.jsdelivr.net; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net blob:; connect-src vscode-webview-resource: https:; worker-src blob:; media-src vscode-webview-resource: https: blob: mediastream:; font-src https://cdn.jsdelivr.net;">
    <!-- Marked and Highlight.js for markdown rendering -->
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/highlight.min.js"></script>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github-dark.min.css">
    <style>
        :root {
            --background: oklch(0.2046 0 0);
            --foreground: oklch(0.9219 0 0);
            --card: oklch(0.2686 0 0);
            --card-foreground: oklch(0.9219 0 0);
            --popover: oklch(0.2686 0 0);
            --popover-foreground: oklch(0.9219 0 0);
            --primary: oklch(0.7686 0.1647 70.0804);
            --primary-foreground: oklch(0 0 0);
            --secondary: oklch(0.2686 0 0);
            --secondary-foreground: oklch(0.9219 0 0);
            --muted: oklch(0.2393 0 0);
            --muted-foreground: oklch(0.7155 0 0);
            --accent: oklch(0.4732 0.1247 46.2007);
            --accent-foreground: oklch(0.9243 0.1151 95.7459);
            --destructive: oklch(0.6368 0.2078 25.3313);
            --destructive-foreground: oklch(1.0000 0 0);
            --border: oklch(0.3715 0 0);
            
            --bg: var(--background);
            --fg: var(--foreground);
            --input-bg: var(--muted);
            --input-fg: var(--foreground);
            --btn-bg: var(--primary);
            --btn-fg: var(--primary-foreground);
            --btn-hover: oklch(0.85 0.15 70);
            --badge-bg: var(--accent);
            --badge-fg: var(--accent-foreground);
            --header-bg: var(--card);
            --editor-bg: var(--background);
            --quote-bg: var(--card);
            --focus: var(--accent);
            --desc: var(--muted-foreground);
            --link: var(--primary);
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: var(--fg); background: var(--bg); display: flex; flex-direction: column; height: 100vh; overflow: hidden; position: relative; line-height: 1.5; -webkit-font-smoothing: antialiased; }

        /* HEADER */
        .header { padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; background: var(--header-bg); min-height: 48px; z-index: 50; }
        .header-title { opacity: 0.9; letter-spacing: 0.05em; margin-right: auto; text-transform: uppercase; }
        .hdr-btn { background: none; border: none; color: var(--fg); cursor: pointer; opacity: 0.55; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 6px; transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1); }
        .hdr-btn:hover { opacity: 1; background: var(--muted); transform: translateY(-1px); }
        .hdr-btn.active { opacity: 1; background: var(--primary); color: var(--primary-foreground); }
        .hdr-btn svg { width: 16px; height: 16px; fill: currentColor; }

        /* OVERLAY */
        .overlay-bg { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 90; background: rgba(0,0,0,0.4); backdrop-filter: blur(4px); }
        .overlay-bg.show { display: block; animation: fadeIn 0.2s; }
        .panel { display: none; position: absolute; top: 56px; right: 12px; width: calc(100% - 24px); max-width: 400px; max-height: 75vh; background: var(--card); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); z-index: 100; overflow: hidden; flex-direction: column; }
        .panel.show { display: flex; animation: slideInX 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
        @keyframes slideInX { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
        .p-hdr { padding: 12px 16px; font-size: 13px; font-weight: 700; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; text-transform: uppercase; letter-spacing: 0.05em; }
        .p-close { background: none; border: none; color: var(--fg); cursor: pointer; opacity: 0.5; font-size: 20px; line-height: 1; transition: opacity 0.2s; }
        .p-close:hover { opacity: 1; }
        .p-body { padding: 16px; overflow-y: auto; flex: 1; font-size: 13px; }

        /* SECTION TITLE */
        .stitle { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.6; margin-bottom: 8px; font-weight: 700; color: var(--primary); }

        /* PROFILE */
        .prov-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
        .prov-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; font-size: 12px; }
        .prov-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .prov-dot.on { background: #4caf50; box-shadow: 0 0 8px #4caf50; }
        .prov-dot.off { background: var(--muted-foreground); }
        .prov-name { flex: 1; font-weight: 700; }
        .prov-key { opacity: 0.6; font-family: monospace; font-size: 11px; }
        .prov-del { background: none; border: none; color: var(--destructive); cursor: pointer; font-size: 16px; opacity: 0.6; transition: opacity 0.2s; }
        .prov-del:hover { opacity: 1; }
        .add-prov { margin-bottom: 16px; }
        .add-prov select, .add-prov input { width: 100%; padding: 8px 12px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); border-radius: 4px; font-size: 12px; margin-bottom: 8px; font-family: inherit; transition: border-color 0.2s; }
        .add-prov input:focus, .add-prov select:focus { outline: none; border-color: var(--focus); box-shadow: 0 0 0 2px hsla(var(--focus), 0.2); }
        .small-btn { padding: 6px 12px; background: var(--btn-bg); color: var(--btn-fg); border: none; border-radius: 4px; font-size: 11px; cursor: pointer; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; transition: all 0.2s; }
        .small-btn:hover { background: var(--btn-hover); transform: translateY(-1px); }
        .ws-info { padding: 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; font-size: 12px; line-height: 1.6; }

        /* CONVERSATIONS */
        .conv-item { display: flex; align-items: center; padding: 10px 12px; border-radius: 6px; cursor: pointer; gap: 8px; transition: all 0.2s; font-size: 12px; border: 1px solid transparent; }
        .conv-item:hover { background: var(--card); border-color: var(--border); }
        .conv-title { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
        .conv-meta { font-size: 10px; opacity: 0.5; white-space: nowrap; }
        .conv-star { background: none; border: none; cursor: pointer; font-size: 14px; opacity: 0.3; color: #f1c40f; transition: opacity 0.2s; }
        .conv-star:hover, .conv-star.starred { opacity: 1; }
        .conv-del { background: none; border: none; cursor: pointer; font-size: 14px; opacity: 0; color: var(--destructive); transition: opacity 0.2s; }
        .conv-item:hover .conv-del { opacity: 0.6; }
        .conv-del:hover { opacity: 1 !important; }

        /* MCP */
        .mcp-search { width: 100%; padding: 8px 12px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); border-radius: 6px; font-size: 12px; margin-bottom: 12px; font-family: inherit; transition: border-color 0.2s; }
        .mcp-search:focus { outline: none; border-color: var(--focus); box-shadow: 0 0 0 2px hsla(var(--focus), 0.2); }
        .mcp-card { padding: 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px; transition: transform 0.2s; }
        .mcp-card:hover { border-color: var(--focus); transform: translateY(-1px); }
        .mcp-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
        .mcp-name { font-size: 13px; font-weight: 700; }
        .mcp-badge { font-size: 9px; padding: 2px 6px; border-radius: 12px; background: var(--badge-bg); color: var(--badge-fg); font-weight: 700; text-transform: uppercase; }
        .mcp-badge.inst { background: rgba(46,204,113,0.2); color: #2ecc71; border: 1px solid rgba(46,204,113,0.4); }
        .mcp-desc { font-size: 11px; opacity: 0.7; line-height: 1.5; margin-bottom: 8px; }
        .mcp-actions { display: flex; gap: 6px; }
        .scope-select { padding: 4px 8px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); border-radius: 4px; font-size: 11px; }

        /* SETTINGS */
        .settings-split { display: flex; height: 100%; min-height: 350px; position: relative; overflow: hidden; }
        .settings-nav { width: 120px; border-right: 1px solid var(--border); display: flex; flex-direction: column; padding: 8px 0; flex-shrink: 0; transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.3s; background: var(--card); z-index: 10; }
        .settings-nav-item { padding: 10px 12px; font-size: 12px; cursor: pointer; border-left: 2px solid transparent; opacity: 0.6; font-weight: 600; transition: all 0.2s; }
        .settings-nav-item:hover { opacity: 1; background: var(--muted); }
        .settings-nav-item.active { opacity: 1; border-left-color: var(--primary); background: linear-gradient(to right, rgba(118,134,182,0.1), transparent); color: var(--primary); }
        
        .settings-content-wrap { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        .settings-hdr-mobile { display: none; padding: 8px 16px; border-bottom: 1px solid var(--border); align-items: center; gap: 12px; }
        .settings-hamburger { background: none; border: none; color: var(--fg); cursor: pointer; opacity: 0.6; font-size: 16px; display: flex; align-items: center; justify-content: center; }
        .settings-hamburger:hover { opacity: 1; }
        
        @media (max-width: 450px) {
            .settings-nav { position: absolute; top: 0; bottom: 0; left: 0; transform: translateX(-100%); }
            .settings-nav.open { transform: translateX(0); box-shadow: 4px 0 16px rgba(0,0,0,0.3); }
            .settings-hdr-mobile { display: flex; }
        }

        .settings-content { flex: 1; padding: 16px; overflow-y: auto; }
        .settings-group { margin-bottom: 20px; }
        .settings-label { font-size: 12px; font-weight: 700; margin-bottom: 4px; }
        .settings-desc { font-size: 11px; opacity: 0.6; margin-bottom: 8px; }
        .settings-input { width: 100%; padding: 8px 12px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); border-radius: 4px; font-size: 12px; font-family: inherit; transition: border-color 0.2s; }
        .settings-input:focus { outline: none; border-color: var(--focus); box-shadow: 0 0 0 2px hsla(var(--focus), 0.2); }
        .settings-check { display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer; }
        .settings-check input[type=checkbox] { cursor: pointer; width: 14px; height: 14px; accent-color: var(--primary); }
        .settings-page { display: none; }
        .settings-page.active { display: block; animation: fadeIn 0.3s; }

        /* BEHAVIOUR SUB-TABS */
        .sub-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 16px; }
        .sub-tab { padding: 8px 12px; font-size: 11px; cursor: pointer; opacity: 0.5; border-bottom: 2px solid transparent; font-weight: 700; text-transform: uppercase; transition: all 0.2s; }
        .sub-tab:hover { opacity: 1; }
        .sub-tab.active { opacity: 1; border-bottom-color: var(--primary); color: var(--primary); }
        .sub-page { display: none; }
        .sub-page.active { display: block; animation: fadeIn 0.3s; }
        .editable-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
        .editable-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; font-size: 12px; font-weight: 600; }
        .editable-item span { flex: 1; }
        .editable-item .item-scope { font-size: 10px; opacity: 0.6; padding: 2px 6px; background: var(--muted); border-radius: 4px; text-transform: uppercase; }
        .editable-item .item-del { background: none; border: none; color: var(--destructive); cursor: pointer; font-size: 16px; opacity: 0.5; transition: opacity 0.2s; }
        .editable-item .item-del:hover { opacity: 1; }
        .add-row { display: flex; gap: 6px; margin-bottom: 8px; }
        .add-row input, .add-row textarea { flex: 1; padding: 8px 12px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); border-radius: 4px; font-size: 12px; font-family: inherit; transition: border-color 0.2s; }
        .add-row input:focus, .add-row textarea:focus { outline: none; border-color: var(--focus); }
        .add-row select { padding: 8px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); border-radius: 4px; font-size: 11px; }
        .role-box { width: 100%; min-height: 60px; padding: 8px 12px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); border-radius: 4px; font-size: 12px; font-family: inherit; resize: vertical; margin-bottom: 8px; transition: border-color 0.2s; }
        .role-box:focus { outline: none; border-color: var(--focus); }

        /* CONVERSATION */
        .conversation { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 20px; }
        .message { display: flex; flex-direction: column; gap: 4px; max-width: 85%; animation: slideInY 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
        @keyframes slideInY { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .message.user { align-self: flex-end; }
        .message.assistant { align-self: flex-start; }
        .message.system { align-self: center; max-width: 70%; }
        .message-bubble { padding: 12px 16px; border-radius: 8px; line-height: 1.6; font-size: 14px; word-wrap: break-word; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .message.user .message-bubble { background: var(--primary); color: var(--primary-foreground); border-bottom-right-radius: 2px; }
        .message.assistant .message-bubble { background: var(--card); border: 1px solid var(--border); border-bottom-left-radius: 2px; }
        .message.system .message-bubble { font-size: 12px; opacity: 0.8; background: var(--muted); border-radius: 6px; padding: 6px 12px; box-shadow: none; font-weight: 500; }

        /* INPUT */
        .input-area { border-top: 1px solid var(--border); padding: 16px; background: var(--card); display: flex; flex-direction: column; gap: 10px; z-index: 40; }
        textarea { width: 100%; min-height: 60px; max-height: 200px; padding: 12px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); border-radius: 6px; resize: vertical; font-family: inherit; font-size: 14px; transition: border-color 0.2s; }
        textarea:focus { outline: none; border-color: var(--focus); box-shadow: 0 0 0 2px hsla(var(--focus), 0.2); }
        .toolbar { display: flex; justify-content: space-between; align-items: center; gap: 8px; height: 32px; }
        .left-ctrl { display: flex; gap: 8px; align-items: center; flex: 1; }
        .tsel { height: 28px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); border-radius: 4px; padding: 0 8px; font-size: 11px; cursor: pointer; outline: none; transition: border-color 0.2s; }
        .tsel:focus { border-color: var(--focus); }
        .right-ctrl { display: flex; gap: 8px; align-items: center; }
        .send-btn { height: 28px; padding: 0 16px; background: var(--btn-bg); color: var(--btn-fg); border: none; border-radius: 4px; font-size: 11px; font-weight: 700; cursor: pointer; transition: all 0.2s; text-transform: uppercase; letter-spacing: 0.05em; }
        .sdlc-btn { height: 28px; padding: 0 16px; background: var(--accent); color: var(--accent-foreground); border: none; border-radius: 4px; font-size: 11px; font-weight: 700; cursor: pointer; transition: all 0.2s; text-transform: uppercase; letter-spacing: 0.05em; }
        .send-btn:hover, .sdlc-btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
        .api-key-prompt { display: none; margin-top: 8px; padding: 10px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; font-size: 12px; }
        .api-key-prompt input { margin-top: 6px; width: 100%; padding: 6px 8px; background: var(--input-bg); border: 1px solid var(--border); border-radius: 4px; color: var(--input-fg); font-size: 12px; }

        /* CONTEXT BAR */
        .ctx-bar { position: absolute; top: 60px; left: 50%; transform: translateX(-50%); background: var(--card); border: 1px solid var(--border); box-shadow: 0 4px 12px rgba(0,0,0,0.2); border-radius: 20px; padding: 6px 14px; display: flex; align-items: center; gap: 8px; font-size: 10px; z-index: 80; opacity: 0; transition: opacity 0.3s; pointer-events: none; }
        .ctx-bar.show { opacity: 1; }
        .ctx-label { color: var(--primary); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
        .ctx-prog { width: 100px; height: 4px; background: var(--muted); border-radius: 2px; overflow: hidden; }
        .ctx-fill { height: 100%; background: var(--primary); width: 0%; transition: width 0.3s; }
        .ctx-stats { min-width: 50px; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; opacity: 0.8; }

        /* ===== VOICE BUTTON ===== */
        @keyframes pulseAccent {
            0%, 100% { box-shadow: 0 0 0 0 hsla(var(--accent), 0.4); }
            50% { box-shadow: 0 0 0 6px hsla(var(--accent), 0); }
        }
        .voice-btn-wrap { padding: 12px 16px 0 16px; background: var(--card); }
        .voice-btn {
            width: 100%; padding: 12px 20px; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 700; letter-spacing: 0.05em; color: var(--accent); display: flex; align-items: center; justify-content: center; gap: 10px; position: relative; overflow: hidden; transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            background-color: var(--muted);
        }
        .voice-btn:hover { background: var(--accent); color: var(--accent-foreground); transform: translateY(-1px); box-shadow: 0 4px 12px hsla(var(--accent), 0.2); }
        .voice-btn:active { transform: translateY(0); }
        .voice-btn svg { width: 18px; height: 18px; fill: currentColor; flex-shrink: 0; transition: transform 0.2s; }
        .voice-btn:hover svg { transform: scale(1.1); }

        /* ===== VOICE OVERLAY ===== */
        .voice-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 200; background: rgba(0,0,0,0.85); backdrop-filter: blur(16px); flex-direction: column; align-items: center; justify-content: center; gap: 24px; animation: fadeIn 0.3s; }
        .voice-overlay.show { display: flex; }
        .voice-overlay-header { text-align: center; }
        .voice-overlay-title { font-size: 24px; font-weight: 800; letter-spacing: 0.05em; background: linear-gradient(135deg, var(--primary), var(--accent)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; text-transform: uppercase; }
        .voice-overlay-subtitle { font-size: 13px; opacity: 0.6; margin-top: 6px; font-weight: 500; }

        /* Waveform */
        .voice-waveform { display: flex; align-items: center; justify-content: center; gap: 4px; height: 80px; }
        .wave-bar { width: 6px; border-radius: 6px; background: linear-gradient(180deg, var(--primary), var(--accent)); transition: height 0.1s ease; }
        .wave-bar.idle { height: 8px; opacity: 0.4; }
        @keyframes waveAnim1 { 0%,100%{height:12px;} 50%{height:50px;} }
        @keyframes waveAnim2 { 0%,100%{height:16px;} 50%{height:64px;} }
        @keyframes waveAnim3 { 0%,100%{height:10px;} 50%{height:36px;} }
        .wave-bar.active:nth-child(3n+1) { animation: waveAnim1 0.6s ease-in-out infinite; }
        .wave-bar.active:nth-child(3n+2) { animation: waveAnim2 0.5s ease-in-out infinite; }
        .wave-bar.active:nth-child(3n+3) { animation: waveAnim3 0.7s ease-in-out infinite; }

        /* Status pill */
        .voice-status { display: inline-flex; align-items: center; gap: 8px; padding: 6px 16px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; border: 1px solid currentColor; }
        .voice-status.listening { background: hsla(150, 100%, 40%, 0.1); color: #00ff88; }
        .voice-status.speaking { background: hsla(200, 100%, 50%, 0.1); color: #00c8ff; }
        .voice-status.thinking { background: hsla(260, 100%, 60%, 0.1); color: #b388ff; }
        .voice-status .status-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; animation: statusBlink 1s ease-in-out infinite; }

        /* Transcript */
        .voice-transcript { width: 90%; max-width: 480px; max-height: 250px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding: 16px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; }
        .vt-turn { font-size: 14px; line-height: 1.6; padding: 10px 14px; border-radius: 8px; max-width: 90%; animation: slideInY 0.2s; font-weight: 500; }
        .vt-turn.verno { align-self: flex-start; background: rgba(0,200,255,0.1); color: #e0f4ff; border-left: 3px solid #00c8ff; }
        .vt-turn.user { align-self: flex-end; background: rgba(0,255,136,0.1); color: #e0ffec; border-right: 3px solid #00ff88; }
        .vt-turn .vt-label { font-size: 10px; font-weight: 800; text-transform: uppercase; opacity: 0.6; margin-bottom: 4px; letter-spacing: 0.05em; }

        /* Voice buttons */
        .voice-end-btn { padding: 12px 24px; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; background: transparent; color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; transition: all 0.2s; text-transform: uppercase; letter-spacing: 0.05em; }
        .voice-end-btn:hover { background: var(--destructive); border-color: var(--destructive); }
        .voice-record-btn { padding: 12px 28px; border: none; border-radius: 8px; background: var(--primary); color: var(--primary-foreground); font-size: 13px; font-weight: 800; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; gap: 8px; text-transform: uppercase; letter-spacing: 0.05em; }
        .voice-record-btn:hover:not(:disabled) { transform: scale(1.02); filter: brightness(1.1); }
        .voice-record-btn.recording { background: var(--destructive); color: var(--destructive-foreground); animation: pulseRed 2s infinite; }

        /* MODE TOGGLE */
        .mode-toggle { display: flex; background: var(--input-bg); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; height: 28px; font-size: 11px; font-weight: 700; margin-right: 8px; text-transform: uppercase; letter-spacing: 0.02em; }
        .mode-opt { padding: 0 12px; display: flex; align-items: center; cursor: pointer; opacity: 0.6; transition: all 0.2s; }
        .mode-opt:hover { opacity: 1; background: var(--muted); }
        .mode-opt.active { opacity: 1; background: var(--primary); color: var(--primary-foreground); }
    </style>
    ${vadPaths ? `<script nonce="${nonce}" src="${vadPaths.bundlePath}"></script>` : ''}
</head>
<body>
    <div class="header">
        <span class="header-title">Verno</span>
        <span id="coverageBadge" style="margin-right: 15px; font-size: 10px; font-weight: 700; padding: 3px 6px; border-radius: 4px; background: rgba(76, 175, 80, 0.2); color: #4caf50; display: none;">Coverage: --%</span>
        <button class="hdr-btn" id="newTaskBtn" title="New Task"><svg viewBox="0 0 16 16"><path d="M14 7v1H8v6H7V8H1V7h6V1h1v6h6z"/></svg></button>
        <button class="hdr-btn" id="historyBtn" title="History"><svg viewBox="0 0 16 16"><path d="M13.5 2h-11A1.5 1.5 0 001 3.5v9A1.5 1.5 0 002.5 14h11a1.5 1.5 0 001.5-1.5v-9A1.5 1.5 0 0013.5 2zM3 5h10v1H3V5zm0 3h10v1H3V8zm0 3h6v1H3v-1z"/></svg></button>
        <button class="hdr-btn" id="profileBtn" title="Profile"><svg viewBox="0 0 16 16"><path d="M8 1a3 3 0 100 6 3 3 0 000-6zM8 8c-3.3 0-6 1.8-6 4v1.5c0 .3.2.5.5.5h11c.3 0 .5-.2.5-.5V12c0-2.2-2.7-4-6-4z"/></svg></button>
        <button class="hdr-btn" id="mcpBtn" title="MCP Marketplace"><svg viewBox="0 0 16 16"><path d="M2 3.5A1.5 1.5 0 013.5 2h3A1.5 1.5 0 018 3.5v3A1.5 1.5 0 016.5 8h-3A1.5 1.5 0 012 6.5v-3zm6 0A1.5 1.5 0 019.5 2h3A1.5 1.5 0 0114 3.5v3A1.5 1.5 0 0112.5 8h-3A1.5 1.5 0 018 6.5v-3zm-6 6A1.5 1.5 0 013.5 8h3A1.5 1.5 0 018 9.5v3A1.5 1.5 0 016.5 14h-3A1.5 1.5 0 012 12.5v-3zm6 0A1.5 1.5 0 019.5 8h3a1.5 1.5 0 011.5 1.5v3a1.5 1.5 0 01-1.5 1.5h-3A1.5 1.5 0 018 12.5v-3z"/></svg></button>
        <button class="hdr-btn" id="settingsBtn" title="Settings"><svg viewBox="0 0 16 16"><path d="M9.1 4.4L8.6 2H7.4l-.5 2.4-.7.3-2-1.3-.9.8 1.3 2-.3.7L2 7.4v1.2l2.4.5.3.7-1.3 2 .8.9 2-1.3.7.3.5 2.4h1.2l.5-2.4.7-.3 2 1.3.9-.8-1.3-2 .3-.7 2.4-.5V7.4l-2.4-.5-.3-.7 1.3-2-.8-.9-2 1.3-.7-.3zM8 10a2 2 0 110-4 2 2 0 010 4z"/></svg></button>
    </div>

    <div class="overlay-bg" id="overlayBg"></div>

    <!-- HISTORY PANEL -->
    <div class="panel" id="historyPanel">
        <div class="p-hdr"><span>Conversation History</span><button class="p-close" id="closeHistory">\u00D7</button></div>
        <div class="p-body" id="historyBody"><div style="text-align:center;opacity:0.4;padding:20px;font-size:11px;">Loading...</div></div>
    </div>

    <!-- PROFILE PANEL -->
    <div class="panel" id="profilePanel">
        <div class="p-hdr"><span>Profile &amp; API Keys</span><button class="p-close" id="closeProfile">\u00D7</button></div>
        <div class="p-body">
            <div class="stitle">Configured Providers</div>
            <div class="prov-list" id="provList"></div>
            <div class="stitle">Add Provider</div>
            <div class="add-prov">
                <select id="addProvSelect"><option value="">Select provider...</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="gemini">Google Gemini</option><option value="groq">Groq</option><option value="mistral">Mistral</option><option value="cohere">Cohere</option><option value="openrouter">OpenRouter</option><option value="deepseek">DeepSeek</option><option value="together">Together AI</option><option value="custom">Custom</option></select>
                <input type="password" id="addProvKey" placeholder="Paste API key..." />
                <button class="small-btn" id="addProvBtn">Add Provider</button>
            </div>
            <div class="stitle">Workspace</div>
            <div class="ws-info" id="wsInfo">No workspace info available</div>
        </div>
    </div>

    <!-- MCP PANEL -->
    <div class="panel" id="mcpPanel">
        <div class="p-hdr"><span>MCP Marketplace</span><button class="p-close" id="closeMcp">\u00D7</button></div>
        <div class="p-body"><input class="mcp-search" id="mcpSearch" placeholder="Search servers..." /><div id="mcpList"></div></div>
    </div>

    <!-- SETTINGS PANEL -->
    <div class="panel" id="settingsPanel" style="max-height:80vh;">
        <div class="p-hdr"><span>Settings</span><button class="p-close" id="closeSettings">\u00D7</button></div>
        <div class="settings-split">
            <div class="settings-nav" id="settingsNav">
                <div class="settings-nav-item active" data-page="general">General</div>
                <div class="settings-nav-item" data-page="models">Models</div>
                <div class="settings-nav-item" data-page="agents">Agents</div>
                <div class="settings-nav-item" data-page="behaviour">Behaviour</div>
                <div class="settings-nav-item" data-page="about">About</div>
            </div>
            <div class="settings-content-wrap">
                <div class="settings-hdr-mobile">
                    <button class="settings-hamburger" id="settingsHamburger">\u2630</button>
                    <span style="font-size: 12px; font-weight: 600;" id="settingsCurrentPageName">General</span>
                </div>
                <div class="settings-content">
                    <div class="settings-page active" id="page-general">
                    <div class="settings-group"><div class="settings-label">Auto Save Conversations</div><div class="settings-desc">Automatically save conversations to disk</div><label class="settings-check"><input type="checkbox" id="setAutoSave" checked /> Enabled</label></div>
                    <div class="settings-group"><div class="settings-label">Show Context Bar</div><div class="settings-desc">Display token usage during processing</div><label class="settings-check"><input type="checkbox" id="setContextBar" checked /> Enabled</label></div>
                    <div class="settings-group"><div class="settings-label">Output Log</div><div class="settings-desc">Open the Verno output channel</div><button class="small-btn" id="openLogBtn">Open Log</button></div>
                </div>
                <div class="settings-page" id="page-models">
                    <div class="settings-group"><div class="settings-label">Default Model</div><div class="settings-desc">Model used when no specific model is selected</div><select class="settings-input" id="setDefaultModel"><option value="gemini">Gemini Pro</option><option value="groq">Groq Llama3</option><option value="openai">OpenAI GPT-4</option><option value="anthropic">Anthropic Claude</option></select></div>
                    <div class="settings-group"><div class="settings-label">Temperature</div><div class="settings-desc">Controls randomness (0.0 - 1.0)</div><input type="number" class="settings-input" id="setTemp" value="0.7" min="0" max="1" step="0.1" /></div>
                    <div class="settings-group"><div class="settings-label">Max Tokens</div><div class="settings-desc">Maximum tokens in response</div><input type="number" class="settings-input" id="setMaxTokens" value="4096" min="256" max="32768" step="256" /></div>
                </div>
                <div class="settings-page" id="page-agents">
                    <div class="settings-group"><div class="settings-label">Orchestrator Agent</div><label class="settings-check"><input type="checkbox" checked disabled /> Always enabled (core)</label></div>
                    <div class="settings-group"><div class="settings-label">Planning Agent</div><label class="settings-check"><input type="checkbox" checked /> Enabled</label></div>
                    <div class="settings-group"><div class="settings-label">Developer Agent</div><label class="settings-check"><input type="checkbox" checked /> Enabled</label></div>
                    <div class="settings-group"><div class="settings-label">Analyst Agent</div><label class="settings-check"><input type="checkbox" checked /> Enabled</label></div>
                    <div class="settings-group"><div class="settings-label">Code Review Agent</div><label class="settings-check"><input type="checkbox" checked /> Enabled</label></div>
                </div>
                <div class="settings-page" id="page-behaviour">
                    <div class="sub-tabs">
                        <div class="sub-tab active" data-sub="bh-mcp">MCP</div>
                        <div class="sub-tab" data-sub="bh-mode">Mode</div>
                        <div class="sub-tab" data-sub="bh-workflows">Workflows</div>
                        <div class="sub-tab" data-sub="bh-rules">Rules</div>
                    </div>
                    <!-- MCP Sub-tab -->
                    <div class="sub-page active" id="bh-mcp">
                        <div class="settings-desc">MCP (Model Context Protocol) servers extend the capabilities of the AI by providing tools, resources, and context.</div>
                        <div class="settings-label" style="margin-top:8px;">Global MCPs</div>
                        <div class="editable-list" id="bhMcpGlobal"></div>
                        <div class="settings-label">Workspace MCPs</div>
                        <div class="editable-list" id="bhMcpWorkspace"></div>
                        <button class="small-btn" id="bhMcpRefresh" style="margin-top:4px;">Refresh All MCPs</button>
                    </div>
                    <!-- Mode Sub-tab -->
                    <div class="sub-page" id="bh-mode">
                        <div class="settings-desc">Modes define the AI's behavior. Built-in modes: Plan, Code, Ask. Create custom modes with a role definition.</div>
                        <div class="settings-label" style="margin-top:8px;">Built-in Modes</div>
                        <div class="editable-list"><div class="editable-item"><span>Plan</span><span class="item-scope">built-in</span></div><div class="editable-item"><span>Code</span><span class="item-scope">built-in</span></div><div class="editable-item"><span>Ask</span><span class="item-scope">built-in</span></div></div>
                        <div class="settings-label">Custom Modes</div>
                        <div class="editable-list" id="bhModeList"></div>
                        <div class="settings-label" style="margin-top:6px;">Create Custom Mode</div>
                        <div class="add-row"><input type="text" id="bhModeNameInp" placeholder="Mode name (e.g. Reviewer)" /></div>
                        <textarea class="role-box" id="bhModeRoleInp" placeholder="Role definition: Describe how the AI should behave in this mode..."></textarea>
                        <button class="small-btn" id="bhModeAddBtn">Create Mode</button>
                    </div>
                    <!-- Workflows Sub-tab -->
                    <div class="sub-page" id="bh-workflows">
                        <div class="settings-desc">Workflows are step-by-step instructions for common tasks. They can be global (all projects) or workspace-specific.</div>
                        <div class="settings-label" style="margin-top:8px;">Global Workflows</div>
                        <div class="editable-list" id="bhWfGlobal"></div>
                        <div class="settings-label">Workspace Workflows</div>
                        <div class="editable-list" id="bhWfWorkspace"></div>
                        <div class="settings-label" style="margin-top:6px;">Create Workflow</div>
                        <div class="add-row"><input type="text" id="bhWfNameInp" placeholder="Workflow name" /><select id="bhWfScopeInp"><option value="workspace">Workspace</option><option value="global">Global</option></select></div>
                        <textarea class="role-box" id="bhWfStepsInp" placeholder="Steps (one per line):\n1. Do this...\n2. Then that..."></textarea>
                        <button class="small-btn" id="bhWfAddBtn">Create Workflow</button>
                    </div>
                    <!-- Rules Sub-tab -->
                    <div class="sub-page" id="bh-rules">
                        <div class="settings-desc">Rules define constraints or instructions the AI must follow. They can be scoped globally or per-workspace.</div>
                        <div class="settings-label" style="margin-top:8px;">Global Rules</div>
                        <div class="editable-list" id="bhRulesGlobal"></div>
                        <div class="settings-label">Workspace Rules</div>
                        <div class="editable-list" id="bhRulesWorkspace"></div>
                        <div class="settings-label" style="margin-top:6px;">Add Rule</div>
                        <div class="add-row"><input type="text" id="bhRuleInp" placeholder="e.g. Always use TypeScript strict mode" /><select id="bhRuleScopeInp"><option value="workspace">Workspace</option><option value="global">Global</option></select><button class="small-btn" id="bhRuleAddBtn">Add</button></div>
                    </div>
                </div>
                <div class="settings-page" id="page-about">
                    <div class="settings-group"><div class="settings-label">Verno</div><div class="settings-desc">Version 0.0.1</div></div>
                    <div class="settings-group"><div class="settings-label">Description</div><div class="settings-desc">AI-powered VS Code extension with multi-agent pipeline for planning and code generation.</div></div>
                    <div class="settings-group"><div class="settings-label">License</div><div class="settings-desc">MIT</div></div>
                </div>
                </div>
            </div>
        </div>
    </div>

    <!-- CONTEXT BAR -->
    <div class="ctx-bar" id="ctxBar"><span class="ctx-label">Context</span><div class="ctx-prog"><div class="ctx-fill" id="ctxFill"></div></div><span class="ctx-stats" id="ctxStats">0/32k</span></div>

    <!-- CONVERSATION -->
    <div class="conversation" id="conversation"><div id="thinking" style="display:none;font-size:11px;opacity:0.6;margin-left:10px;">Thinking...</div></div>

    <!-- VOICE CONVERSATION OVERLAY -->
    <div class="voice-overlay" id="voiceOverlay">
        <div class="voice-overlay-header">
            <div class="voice-overlay-title">Verno Voice</div>
            <div class="voice-overlay-subtitle">Tell me what you want to build</div>
        </div>
        <div class="voice-waveform" id="voiceWaveform"></div>
        <div class="voice-status listening" id="voiceStatus"><span class="status-dot"></span><span id="voiceStatusText">Initializing...</span></div>
        <div class="voice-transcript" id="voiceTranscript"></div>
        <div class="voice-fallback" id="voiceFallback"><input type="text" id="voiceFallbackInput" placeholder="Type your response..." /><button id="voiceFallbackSend">Send</button></div>
        
        <div class="voice-controls" style="display:flex; gap:10px; margin-top:10px;">
            <button class="voice-record-btn" id="voiceRecordBtn">
                <span class="btn-icon">●</span> <span class="btn-text">Start Recording</span>
            </button>
            <button class="voice-end-btn" id="voiceEndBtn">End Conversation</button>
        </div>
    </div>

    <!-- VOICE BUTTON -->
    <div class="voice-btn-wrap">
        <button class="voice-btn" id="voiceBtn">
            <svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
            <span class="btn-text">Start Voice Conversation</span>
        </button>
    </div>

    <!-- INPUT -->
    <div class="input-area">
        <textarea id="msgInput" placeholder="Type a message..." rows="1"></textarea>
        <div class="toolbar">
            <div class="left-ctrl">
                <div class="mode-toggle" id="modeToggle">
                    <div class="mode-opt" data-val="conversational">Conversational</div>
                    <div class="mode-opt" data-val="development">Development</div>
                </div>
                <select id="modelSelect" class="tsel" style="min-width:140px;">
                    <optgroup label="Anthropic">
                        <option value="anthropic:claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
                        <option value="anthropic:claude-3-haiku-20240307">Claude 3 Haiku</option>
                    </optgroup>
                    <optgroup label="OpenAI">
                        <option value="openai:gpt-4o">GPT-4o</option>
                        <option value="openai:gpt-4o-mini">GPT-4o Mini</option>
                    </optgroup>
                    <optgroup label="Google">
                        <option value="gemini:gemini-pro">Gemini Pro</option>
                    </optgroup>
                    <optgroup label="Groq">
                        <option value="groq:llama-3">Llama 3</option>
                    </optgroup>
                </select>
            </div>
            <div class="right-ctrl">
                <button class="sdlc-btn" id="sdlcBtn" title="Start SDLC Flow (PRD & Jira)">Start SDLC</button>
                <button class="send-btn" id="sendBtn">Send</button>
            </div>
        </div>
        <div id="apiKeyPrompt" class="api-key-prompt"><div>API Key required for <span id="modelNameDisp">Gemini</span>:</div><input type="password" id="apiKeyInp" placeholder="Enter API Key and press Enter..." /></div>
    </div>

    <script nonce="${nonce}">
    (function(){
        var vscode = acquireVsCodeApi();
        var vadPaths = ${vadPaths ? JSON.stringify(vadPaths) : 'null'};
        var saved = vscode.getState();
        var S = { mode:'plan', model:'gemini', providers:[], starred:[], mcpInstalled:[], settings:{}, customModes:[], workflows:[], rules:[], mcpGlobal:[], mcpWorkspace:[] };
        if(saved){
            if(saved.mode) S.mode=saved.mode;
            if(saved.model) S.model=saved.model;
            if(Array.isArray(saved.providers)) S.providers=saved.providers;
            if(Array.isArray(saved.starred)) S.starred=saved.starred;
            if(Array.isArray(saved.mcpInstalled)) S.mcpInstalled=saved.mcpInstalled;
            if(saved.settings) S.settings=saved.settings;
            if(Array.isArray(saved.customModes)) S.customModes=saved.customModes;
            if(Array.isArray(saved.workflows)) S.workflows=saved.workflows;
            if(Array.isArray(saved.rules)) S.rules=saved.rules;
            if(Array.isArray(saved.mcpGlobal)) S.mcpGlobal=saved.mcpGlobal;
            if(Array.isArray(saved.mcpWorkspace)) S.mcpWorkspace=saved.mcpWorkspace;
            // Migrate old apiKeys format
            if(saved.apiKeys && typeof saved.apiKeys==='object'){
                if(saved.apiKeys.gemini && !S.providers.find(function(p){return p.id==='gemini';})) S.providers.push({id:'gemini',name:'Google Gemini',key:saved.apiKeys.gemini});
                if(saved.apiKeys.groq && !S.providers.find(function(p){return p.id==='groq';})) S.providers.push({id:'groq',name:'Groq',key:saved.apiKeys.groq});
            }
        }

        var MCP_CATALOG = [
            {id:'filesystem',name:'Filesystem',desc:'Read, write, and manage files in your workspace.',cat:'Core'},
            {id:'github',name:'GitHub',desc:'Access repos, issues, PRs, and Actions.',cat:'Dev Tools'},
            {id:'postgres',name:'PostgreSQL',desc:'Connect to PostgreSQL databases.',cat:'Database'},
            {id:'sqlite',name:'SQLite',desc:'Lightweight SQLite database access.',cat:'Database'},
            {id:'brave-search',name:'Brave Search',desc:'Web search via Brave.',cat:'Search'},
            {id:'puppeteer',name:'Puppeteer',desc:'Browser automation and screenshots.',cat:'Automation'},
            {id:'slack',name:'Slack',desc:'Send messages and manage Slack.',cat:'Comms'},
            {id:'docker',name:'Docker',desc:'Manage containers and images.',cat:'DevOps'},
            {id:'memory',name:'Memory',desc:'Persistent knowledge graph storage.',cat:'Core'},
            {id:'fetch',name:'Fetch',desc:'HTTP requests to external APIs.',cat:'Network'},
            {id:'redis',name:'Redis',desc:'Redis caching and pub/sub.',cat:'Database'},
            {id:'notion',name:'Notion',desc:'Access Notion pages and databases.',cat:'Productivity'}
        ];

        // DOM
        var conv=document.getElementById('conversation'), msgInput=document.getElementById('msgInput'), sendBtn=document.getElementById('sendBtn');
        var modeSelect=document.getElementById('modeSelect'), modelSelect=document.getElementById('modelSelect');
        var apiKeyPrompt=document.getElementById('apiKeyPrompt'), apiKeyInp=document.getElementById('apiKeyInp');
        var thinking=document.getElementById('thinking');
        var ctxBar=document.getElementById('ctxBar'), ctxFill=document.getElementById('ctxFill'), ctxStats=document.getElementById('ctxStats');
        var overlayBg=document.getElementById('overlayBg');
        var panels={history:document.getElementById('historyPanel'),profile:document.getElementById('profilePanel'),mcp:document.getElementById('mcpPanel'),settings:document.getElementById('settingsPanel')};
        var btns={newTask:document.getElementById('newTaskBtn'),history:document.getElementById('historyBtn'),profile:document.getElementById('profileBtn'),mcp:document.getElementById('mcpBtn'),settings:document.getElementById('settingsBtn')};
        var sdlcBtn=document.getElementById('sdlcBtn');

        // Init
        if(modeSelect) modeSelect.value=S.mode;
        if(modelSelect) modelSelect.value=S.model;
        updatePlaceholder(S.mode);
        checkApiKey();

        // === PANEL TOGGLE ===
        function openPanel(name){
            closeAll();
            if(panels[name]){panels[name].classList.add('show'); overlayBg.classList.add('show');}
            if(btns[name]) btns[name].classList.add('active');
            if(name==='history') vscode.postMessage({type:'listConversations'});
            if(name==='profile') renderProviders();
        }
        function closeAll(){
            for(var k in panels) if(panels[k]) panels[k].classList.remove('show');
            for(var k in btns) if(btns[k]) btns[k].classList.remove('active');
            if(overlayBg) overlayBg.classList.remove('show');
        }
        if(overlayBg) overlayBg.addEventListener('click',closeAll);
        document.querySelectorAll('.p-close').forEach(function(b){b.addEventListener('click',closeAll);});

        // Header buttons
        if(btns.newTask) btns.newTask.addEventListener('click',function(){
            vscode.postMessage({type:'newTask'});
            if(conv&&thinking){while(conv.firstChild&&conv.firstChild!==thinking)conv.removeChild(conv.firstChild);}
            addMsg('system','New task started.');
        });
        if(btns.history) btns.history.addEventListener('click',function(){openPanel('history');});
        if(btns.profile) btns.profile.addEventListener('click',function(){openPanel('profile');});
        if(btns.mcp) btns.mcp.addEventListener('click',function(){openPanel('mcp'); renderMcp('');});
        if(btns.settings) btns.settings.addEventListener('click',function(){openPanel('settings');});

        // === PROFILE ===
        function renderProviders(){
            var list=document.getElementById('provList'); if(!list) return;
            list.innerHTML='';
            if(S.providers.length===0){list.innerHTML='<div style="opacity:0.4;font-size:10px;padding:4px;">No providers configured. Add one below.</div>'; return;}
            S.providers.forEach(function(p,i){
                var d=document.createElement('div'); d.className='prov-item';
                d.innerHTML='<span class="prov-dot on"></span><span class="prov-name">'+esc(p.name)+'</span><span class="prov-key">'+esc(p.key.substring(0,8))+'...</span>';
                var del=document.createElement('button'); del.className='prov-del'; del.textContent='\u00D7';
                del.addEventListener('click',function(){
                    S.providers.splice(i,1);
                    save();renderProviders();checkApiKey();
                    vscode.postMessage({ type: 'deleteApiKey', provider: p.id });
                });
                d.appendChild(del); list.appendChild(d);
            });
        }
        var addProvBtn=document.getElementById('addProvBtn');
        if(addProvBtn) addProvBtn.addEventListener('click',function(){
            var sel=document.getElementById('addProvSelect'), keyInp=document.getElementById('addProvKey');
            if(!sel||!keyInp) return;
            var id=sel.value, key=keyInp.value.trim();
            if(!id||!key){return;}
            var names={openai:'OpenAI',anthropic:'Anthropic',gemini:'Google Gemini',groq:'Groq',mistral:'Mistral',cohere:'Cohere',openrouter:'OpenRouter',deepseek:'DeepSeek',together:'Together AI',custom:'Custom'};
            // Remove existing if same provider
            S.providers=S.providers.filter(function(p){return p.id!==id;});
            S.providers.push({id:id,name:names[id]||id,key:key});
            save(); sel.value=''; keyInp.value='';
            renderProviders(); checkApiKey();
            addMsg('system',names[id]+' API key saved.');
            vscode.postMessage({ type: 'saveApiKey', provider: id, apiKey: key });
        });

        // Workspace info
        var wsEl=document.getElementById('wsInfo');
        if(wsEl) wsEl.innerHTML='<div><strong>Path:</strong> Workspace loaded</div><div><strong>Extension:</strong> Verno v0.0.1</div><div><strong>Providers:</strong> '+S.providers.length+' configured</div>';

        // === CONVERSATIONS ===
        function renderConvList(convs){
            var body=document.getElementById('historyBody'); if(!body) return;
            body.innerHTML='';
            if(!convs||convs.length===0){body.innerHTML='<div style="text-align:center;opacity:0.4;padding:20px;font-size:11px;">No conversations yet.</div>';return;}
            convs.forEach(function(c){
                var d=document.createElement('div'); d.className='conv-item';
                var isStarred=S.starred.indexOf(c.id)!==-1;
                var star=document.createElement('button'); star.className='conv-star'+(isStarred?' starred':''); star.textContent=isStarred?'\u2605':'\u2606';
                star.addEventListener('click',function(e){e.stopPropagation();
                    var idx=S.starred.indexOf(c.id);
                    if(idx===-1){S.starred.push(c.id);star.textContent='\u2605';star.classList.add('starred');}
                    else{S.starred.splice(idx,1);star.textContent='\u2606';star.classList.remove('starred');}
                    save();
                });
                var title=document.createElement('span'); title.className='conv-title'; title.textContent=c.title||'Untitled';
                title.addEventListener('click',function(){
                    vscode.postMessage({type:'loadConversation',conversationId:c.id});
                    closeAll();
                });
                var meta=document.createElement('span'); meta.className='conv-meta'; meta.textContent=c.messageCount+'msg';
                var del=document.createElement('button'); del.className='conv-del'; del.textContent='\u2716';
                del.addEventListener('click',function(e){e.stopPropagation(); vscode.postMessage({type:'deleteConversation',conversationId:c.id});});
                d.appendChild(star); d.appendChild(title); d.appendChild(meta); d.appendChild(del);
                body.appendChild(d);
            });
        }

        // === MCP ===
        function renderMcp(filter){
            var list=document.getElementById('mcpList'); if(!list) return;
            list.innerHTML='';
            var filtered=MCP_CATALOG.filter(function(s){if(!filter)return true;return(s.name+s.desc+s.cat).toLowerCase().indexOf(filter)!==-1;});
            if(filtered.length===0){list.innerHTML='<div style="text-align:center;opacity:0.4;padding:16px;font-size:11px;">No servers found.</div>';return;}
            filtered.forEach(function(srv){
                var inst=S.mcpInstalled.indexOf(srv.id)!==-1;
                var card=document.createElement('div'); card.className='mcp-card';
                var top=document.createElement('div'); top.className='mcp-top';
                var nm=document.createElement('span'); nm.className='mcp-name'; nm.textContent=srv.name;
                var badge=document.createElement('span'); badge.className=inst?'mcp-badge inst':'mcp-badge'; badge.textContent=inst?'Installed':srv.cat;
                top.appendChild(nm); top.appendChild(badge);
                var desc=document.createElement('div'); desc.className='mcp-desc'; desc.textContent=srv.desc;
                var acts=document.createElement('div'); acts.className='mcp-actions';
                if(!inst){
                    var scope=document.createElement('select'); scope.className='scope-select';
                    var o1=document.createElement('option'); o1.value='project'; o1.textContent='This Project';
                    var o2=document.createElement('option'); o2.value='global'; o2.textContent='Global';
                    scope.appendChild(o1); scope.appendChild(o2);
                    var ibtn=document.createElement('button'); ibtn.className='small-btn'; ibtn.textContent='Install';
                    ibtn.addEventListener('click',(function(sid,sc,bd,ib){return function(){
                        S.mcpInstalled.push(sid); save();
                        vscode.postMessage({type:'mcpInstall',serverId:sid,scope:sc.value});
                        bd.textContent='Installed'; bd.className='mcp-badge inst';
                        ib.textContent='Installed'; ib.disabled=true; ib.style.opacity='0.5';
                        sc.style.display='none';
                        addMsg('system','MCP "'+sid+'" installed ('+sc.value+').');
                    };})(srv.id,scope,badge,ibtn));
                    acts.appendChild(scope); acts.appendChild(ibtn);
                } else {
                    var done=document.createElement('span'); done.style.fontSize='10px'; done.style.opacity='0.5'; done.textContent='Installed';
                    acts.appendChild(done);
                }
                card.appendChild(top); card.appendChild(desc); card.appendChild(acts);
                list.appendChild(card);
            });
        }
        var mcpSearchEl=document.getElementById('mcpSearch');
        if(mcpSearchEl) mcpSearchEl.addEventListener('input',function(){renderMcp(mcpSearchEl.value.trim().toLowerCase());});

        // === SETTINGS NAV ===
        var settingsHamburger = document.getElementById('settingsHamburger');
        var settingsNav = document.getElementById('settingsNav');
        var settingsCurrentPageName = document.getElementById('settingsCurrentPageName');
        if (settingsHamburger) {
            settingsHamburger.addEventListener('click', function() {
                if (settingsNav) settingsNav.classList.toggle('open');
            });
        }
        document.querySelectorAll('.settings-nav-item').forEach(function(item){
            item.addEventListener('click',function(){
                document.querySelectorAll('.settings-nav-item').forEach(function(n){n.classList.remove('active');});
                document.querySelectorAll('.settings-page').forEach(function(p){p.classList.remove('active');});
                item.classList.add('active');
                var pg=document.getElementById('page-'+item.getAttribute('data-page'));
                if(pg) pg.classList.add('active');
                if(settingsCurrentPageName) settingsCurrentPageName.textContent = item.textContent;
                if(window.innerWidth <= 450 && settingsNav) settingsNav.classList.remove('open');
            });
        });

        // === BEHAVIOUR SUB-TABS ===
        document.querySelectorAll('.sub-tab').forEach(function(tab){
            tab.addEventListener('click',function(){
                tab.parentElement.querySelectorAll('.sub-tab').forEach(function(t){t.classList.remove('active');});
                var parent=tab.closest('.settings-page');
                if(parent) parent.querySelectorAll('.sub-page').forEach(function(p){p.classList.remove('active');});
                tab.classList.add('active');
                var pg=document.getElementById(tab.getAttribute('data-sub'));
                if(pg) pg.classList.add('active');
            });
        });

        // --- Behaviour: MCP ---
        function renderBhMcp(){
            renderEditableList('bhMcpGlobal',S.mcpGlobal,'global','mcpGlobal');
            renderEditableList('bhMcpWorkspace',S.mcpWorkspace,'workspace','mcpWorkspace');
        }
        var bhMcpRefresh=document.getElementById('bhMcpRefresh');
        if(bhMcpRefresh) bhMcpRefresh.addEventListener('click',function(){
            addMsg('system','Refreshing all MCP servers...'); vscode.postMessage({type:'mcpRefresh'});
        });
        renderBhMcp();

        // --- Behaviour: Modes ---
        function renderBhModes(){
            var list=document.getElementById('bhModeList'); if(!list)return;
            list.innerHTML='';
            if(S.customModes.length===0){list.innerHTML='<div style="opacity:0.4;font-size:10px;padding:2px;">No custom modes yet.</div>';return;}
            S.customModes.forEach(function(m,i){
                var d=document.createElement('div');d.className='editable-item';
                var nm=document.createElement('span');nm.textContent=m.name;
                var sc=document.createElement('span');sc.className='item-scope';sc.textContent='custom';
                var del=document.createElement('button');del.className='item-del';del.textContent='\u00D7';
                del.addEventListener('click',function(){S.customModes.splice(i,1);save();renderBhModes();updateModeSelect();});
                d.appendChild(nm);d.appendChild(sc);d.appendChild(del);list.appendChild(d);
            });
        }
        var bhModeAddBtn=document.getElementById('bhModeAddBtn');
        if(bhModeAddBtn) bhModeAddBtn.addEventListener('click',function(){
            var nameInp=document.getElementById('bhModeNameInp'),roleInp=document.getElementById('bhModeRoleInp');
            if(!nameInp||!roleInp)return;
            var name=nameInp.value.trim(),role=roleInp.value.trim();
            if(!name){return;}
            S.customModes.push({name:name,role:role,id:name.toLowerCase().replace(/\s+/g,'-')});
            save();nameInp.value='';roleInp.value='';
            renderBhModes();updateModeSelect();
            addMsg('system','Custom mode "'+name+'" created.');
        });
        function updateModeSelect(){
            if(!modeSelect)return;
            var cur=modeSelect.value;
            // Remove custom options
            while(modeSelect.options.length>3)modeSelect.remove(3);
            S.customModes.forEach(function(m){
                var opt=document.createElement('option');opt.value=m.id;opt.textContent=m.name;
                modeSelect.appendChild(opt);
            });
            modeSelect.value=cur;
        }
        renderBhModes();updateModeSelect();

        // --- Behaviour: Workflows ---
        function renderBhWorkflows(){
            var gList=document.getElementById('bhWfGlobal'),wList=document.getElementById('bhWfWorkspace');
            if(gList){gList.innerHTML='';var gWfs=S.workflows.filter(function(w){return w.scope==='global';});
                if(gWfs.length===0)gList.innerHTML='<div style="opacity:0.4;font-size:10px;padding:2px;">No global workflows.</div>';
                gWfs.forEach(function(w,i){makeWfItem(gList,w);});
            }
            if(wList){wList.innerHTML='';var wWfs=S.workflows.filter(function(w){return w.scope==='workspace';});
                if(wWfs.length===0)wList.innerHTML='<div style="opacity:0.4;font-size:10px;padding:2px;">No workspace workflows.</div>';
                wWfs.forEach(function(w,i){makeWfItem(wList,w);});
            }
        }
        function makeWfItem(parent,w){
            var d=document.createElement('div');d.className='editable-item';
            var nm=document.createElement('span');nm.textContent=w.name;nm.title=w.steps||'';
            var sc=document.createElement('span');sc.className='item-scope';sc.textContent=w.scope;
            var del=document.createElement('button');del.className='item-del';del.textContent='\u00D7';
            del.addEventListener('click',function(){S.workflows=S.workflows.filter(function(x){return x!==w;});save();renderBhWorkflows();});
            d.appendChild(nm);d.appendChild(sc);d.appendChild(del);parent.appendChild(d);
        }
        var bhWfAddBtn=document.getElementById('bhWfAddBtn');
        if(bhWfAddBtn) bhWfAddBtn.addEventListener('click',function(){
            var nameInp=document.getElementById('bhWfNameInp'),stepsInp=document.getElementById('bhWfStepsInp'),scopeInp=document.getElementById('bhWfScopeInp');
            if(!nameInp||!stepsInp||!scopeInp)return;
            var name=nameInp.value.trim(),steps=stepsInp.value.trim(),scope=scopeInp.value;
            if(!name){return;}
            S.workflows.push({name:name,steps:steps,scope:scope});
            save();nameInp.value='';stepsInp.value='';
            renderBhWorkflows();
            addMsg('system','Workflow "'+name+'" created ('+scope+').');
        });
        renderBhWorkflows();

        // --- Behaviour: Rules ---
        function renderBhRules(){
            var gList=document.getElementById('bhRulesGlobal'),wList=document.getElementById('bhRulesWorkspace');
            if(gList){gList.innerHTML='';var gRules=S.rules.filter(function(r){return r.scope==='global';});
                if(gRules.length===0)gList.innerHTML='<div style="opacity:0.4;font-size:10px;padding:2px;">No global rules.</div>';
                gRules.forEach(function(r){makeRuleItem(gList,r);});
            }
            if(wList){wList.innerHTML='';var wRules=S.rules.filter(function(r){return r.scope==='workspace';});
                if(wRules.length===0)wList.innerHTML='<div style="opacity:0.4;font-size:10px;padding:2px;">No workspace rules.</div>';
                wRules.forEach(function(r){makeRuleItem(wList,r);});
            }
        }
        function makeRuleItem(parent,r){
            var d=document.createElement('div');d.className='editable-item';
            var nm=document.createElement('span');nm.textContent=r.text;
            var sc=document.createElement('span');sc.className='item-scope';sc.textContent=r.scope;
            var del=document.createElement('button');del.className='item-del';del.textContent='\u00D7';
            del.addEventListener('click',function(){S.rules=S.rules.filter(function(x){return x!==r;});save();renderBhRules();});
            d.appendChild(nm);d.appendChild(sc);d.appendChild(del);parent.appendChild(d);
        }
        var bhRuleAddBtn=document.getElementById('bhRuleAddBtn');
        if(bhRuleAddBtn) bhRuleAddBtn.addEventListener('click',function(){
            var inp=document.getElementById('bhRuleInp'),scopeInp=document.getElementById('bhRuleScopeInp');
            if(!inp||!scopeInp)return;
            var text=inp.value.trim(),scope=scopeInp.value;
            if(!text){return;}
            S.rules.push({text:text,scope:scope});
            save();inp.value='';
            renderBhRules();
            addMsg('system','Rule added ('+scope+').');
        });
        renderBhRules();

        // Shared editable list renderer for MCP
        function renderEditableList(elId,arr,scopeLabel,stateKey){
            var el=document.getElementById(elId);if(!el)return;
            el.innerHTML='';
            if(arr.length===0){el.innerHTML='<div style="opacity:0.4;font-size:10px;padding:2px;">None configured.</div>';return;}
            arr.forEach(function(item,i){
                var d=document.createElement('div');d.className='editable-item';
                var nm=document.createElement('span');nm.textContent=typeof item==='string'?item:item.name||item;
                var sc=document.createElement('span');sc.className='item-scope';sc.textContent=scopeLabel;
                var del=document.createElement('button');del.className='item-del';del.textContent='\u00D7';
                del.addEventListener('click',function(){S[stateKey].splice(i,1);save();renderBhMcp();});
                d.appendChild(nm);d.appendChild(sc);d.appendChild(del);el.appendChild(d);
            });
        }

        var openLogBtn=document.getElementById('openLogBtn');
        if(openLogBtn) openLogBtn.addEventListener('click',function(){vscode.postMessage({type:'showOutput'});});

        // === MODE / MODEL ===
        var modeToggle=document.getElementById('modeToggle');
        var modeOpts=document.querySelectorAll('.mode-opt');
        if(modeToggle) {
            if(S.mode === 'plan' || S.mode === 'code' || S.mode === 'development') {
                S.mode = 'development';
            } else {
                S.mode = 'conversational';
            }
            modeOpts.forEach(function(o){
                if(o.getAttribute('data-val') === S.mode) o.classList.add('active');
                else o.classList.remove('active');
            });
            modeOpts.forEach(function(opt) {
                opt.addEventListener('click', function() {
                    modeOpts.forEach(function(o){ o.classList.remove('active'); });
                    opt.classList.add('active');
                    S.mode = opt.getAttribute('data-val');
                    save();
                    updatePlaceholder(S.mode);
                });
            });
        }
        if(modelSelect) {
            modelSelect.value = (S.provider && S.model) ? (S.provider + ':' + S.model) : 'gemini:gemini-pro';
            modelSelect.addEventListener('change',function(){
                var parts = modelSelect.value.split(':');
                S.provider = parts[0];
                S.model = parts[1];
                save();checkApiKey();
            });
        }
        function updatePlaceholder(m){if(!msgInput)return;if(m==='development')msgInput.placeholder='Describe code changes...';else if(m==='conversational')msgInput.placeholder='Ask a question...';else msgInput.placeholder='Type a message...';}
        function checkApiKey(){
            var key=getProviderKey(S.provider || S.model);
            if(!key&&apiKeyPrompt){apiKeyPrompt.style.display='block';var nd=document.getElementById('modelNameDisp');if(nd)nd.textContent=(S.provider||S.model);}
            else if(apiKeyPrompt){apiKeyPrompt.style.display='none';}
        }
        function getProviderKey(provId){
            var p=S.providers.find(function(x){return x.id===provId;});
            return p?p.key:'';
        }
        if(apiKeyInp) apiKeyInp.addEventListener('keydown',function(e){
            if(e.key==='Enter'){var k=apiKeyInp.value.trim();if(k){
                var prov = S.provider || S.model;
                S.providers=S.providers.filter(function(p){return p.id!==prov;});
                S.providers.push({id:prov,name:prov,key:k});
                save();apiKeyInp.value='';checkApiKey();
                vscode.postMessage({ type: 'saveApiKey', provider: prov, apiKey: k });
            }}
        });

        // === SEND ===
        if(sendBtn) sendBtn.addEventListener('click',function(){sendMessage();});
        if(sdlcBtn) sdlcBtn.addEventListener('click',function(){
            var text = msgInput ? msgInput.value.trim() : '';
            var apiKey = getProviderKey(S.provider || S.model);
            vscode.postMessage({
                type:'start-sdlc', 
                input: text, 
                apiKey: apiKey,
                provider: S.provider,
                model: S.model
            });
            if(msgInput) { msgInput.value=''; msgInput.style.height='auto'; }
        });
        if(msgInput) msgInput.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}});
        function sendMessage(){
            if(!msgInput)return;
            var text=msgInput.value.trim(); if(!text)return;
            var apiKey=getProviderKey(S.provider || S.model);
            if(!apiKey){if(apiKeyPrompt)apiKeyPrompt.style.display='block';if(apiKeyInp)apiKeyInp.focus();addMsg('system','Please add an API key first (use Profile button).');return;}
            addMsg('user',text); msgInput.value=''; msgInput.style.height='auto';
            if(thinking)thinking.style.display='block';
            if(conv)conv.scrollTop=conv.scrollHeight;
            var outMode = (S.mode === 'conversational' || S.mode === 'ask') ? 'ask' : 'code';
            vscode.postMessage({type:'processInputSubmit',input:text,apiKey:apiKey,mode:outMode,provider:S.provider,model:S.model});
        }

        // === MESSAGES ===
        function addMsg(role,content){
            if(!conv||!thinking)return;
            var d=document.createElement('div');d.className='message '+role;
            var b=document.createElement('div');b.className='message-bubble';b.textContent=content;
            d.appendChild(b);conv.insertBefore(d,thinking);conv.scrollTop=conv.scrollHeight;
        }
        window.addEventListener('message',function(ev){
            var m=ev.data; if(!m||!m.type)return;
            switch(m.type){
                case 'coverageUpdate':
                    var badge = document.getElementById('coverageBadge');
                    if (badge) {
                        badge.style.display = 'inline-block';
                        badge.textContent = 'Coverage: ' + m.percentage.toFixed(1) + '%';
                        if (m.percentage >= 80) {
                            badge.style.background = 'rgba(76, 175, 80, 0.2)';
                            badge.style.color = '#4caf50';
                        } else if (m.percentage >= 50) {
                            badge.style.background = 'rgba(255, 193, 7, 0.2)';
                            badge.style.color = '#ffc107';
                        } else {
                            badge.style.background = 'rgba(244, 67, 54, 0.2)';
                            badge.style.color = '#f44336';
                        }
                    }
                    break;
                case 'chatToken':
                    if(thinking)thinking.style.display='none';
                    if(!window.currentAsstMsg) {
                        var d=document.createElement('div');d.className='message assistant';
                        var b=document.createElement('div');b.className='message-bubble markdown-body';
                        window.currentAsstMsg = b; window.currentAsstText = '';
                        d.appendChild(b);conv.insertBefore(d,thinking);
                    }
                    window.currentAsstText += m.token;
                    if(typeof marked !== 'undefined') {
                        window.currentAsstMsg.innerHTML = marked.parse(window.currentAsstText);
                        if(typeof hljs !== 'undefined') {
                            window.currentAsstMsg.querySelectorAll('pre code').forEach((block) => {
                                hljs.highlightElement(block);
                            });
                        }
                    } else {
                        window.currentAsstMsg.textContent = window.currentAsstText;
                    }
                    conv.scrollTop=conv.scrollHeight;
                    break;
                case 'newMessage': 
                    var wasStreaming = !!window.currentAsstMsg;
                    window.currentAsstMsg = null;
                    if(m.message) {
                        if (m.message.role === 'user') {
                           addMsg(m.message.role, m.message.content);
                           var b=document.createElement('div');b.className='message-bubble markdown-body';
                        } else {
                           // If we were streaming, replace the last assistant bubble content. Otherwise add new.
                           if (wasStreaming && typeof marked !== 'undefined') {
                               var asstNodes = conv.querySelectorAll('.message.assistant');
                               if (asstNodes.length > 0) {
                                   var lastNode = asstNodes[asstNodes.length - 1];
                                   var b = lastNode.querySelector('.message-bubble');
                                   if (b) {
                                       b.innerHTML = marked.parse(m.message.content);
                                       if(typeof hljs !== 'undefined') {
                                           b.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
                                       }
                                       conv.scrollTop=conv.scrollHeight;
                                       break;
                                   }
                               }
                           }
                           
                           var d=document.createElement('div');d.className='message '+m.message.role;
                           var b=document.createElement('div');b.className='message-bubble markdown-body';
                           if(typeof marked !== 'undefined') {
                               b.innerHTML = marked.parse(m.message.content);
                               if(typeof hljs !== 'undefined') {
                                   b.querySelectorAll('pre code').forEach((block) => {
                                       hljs.highlightElement(block);
                                   });
                               }
                           } else {
                               b.textContent = m.message.content;
                           }
                           d.appendChild(b);conv.insertBefore(d,thinking);conv.scrollTop=conv.scrollHeight;
                        }
                    } 
                    if(thinking)thinking.style.display='none'; 
                    setTimeout(function(){if(ctxBar)ctxBar.classList.remove('show');},2000); 
                    break;
                case 'thinking': if(thinking)thinking.style.display=m.show?'block':'none'; break;
                case 'contextUsage': if(ctxBar&&ctxFill&&ctxStats){ctxBar.classList.add('show');var pct=Math.min((m.used/m.total)*100,100);ctxFill.style.width=pct+'%';var fk=function(n){return n>=1000?(n/1000).toFixed(1)+'k':''+n;};ctxStats.textContent=fk(m.used)+'/'+fk(m.total);} break;
                case 'conversationList': renderConvList(m.conversations); break;
                case 'conversationHistory': if(conv&&thinking){while(conv.firstChild&&conv.firstChild!==thinking)conv.removeChild(conv.firstChild);} if(m.messages)m.messages.forEach(function(msg){addMsg(msg.role,msg.content);}); break;
                case 'clearConversation': if(conv&&thinking){while(conv.firstChild&&conv.firstChild!==thinking)conv.removeChild(conv.firstChild);} break;
            }
        });

        function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML;}
        function save(){vscode.setState(S);}
        if(msgInput) msgInput.addEventListener('input',function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,120)+'px';});

        // ========================================
        // VOICE CONVERSATION ENGINE (Gemini Live Style)
        // ========================================
        (function VoiceChatEngine(){
            var overlay = document.getElementById('voiceOverlay');
            var voiceBtn = document.getElementById('voiceBtn');
            var waveform = document.getElementById('voiceWaveform');
            var statusEl = document.getElementById('voiceStatus');
            var statusText = document.getElementById('voiceStatusText');
            var transcriptEl = document.getElementById('voiceTranscript');
            var endBtn = document.getElementById('voiceEndBtn');
            var fallbackWrap = document.getElementById('voiceFallback');
            var fallbackInput = document.getElementById('voiceFallbackInput');
            var fallbackSendBtn = document.getElementById('voiceFallbackSend');

            if (!overlay || !voiceBtn) return;

            var transcript = [];
            var isListening = false;
            var isSpeaking = false;
            var isProcessing = false;
            var ttsSupported = false;
            var bestVoice = null;
            var waveBars = [];
            var speakTimer = null;
            var silenceTimer = null;
            var safetyTimeout = null;
            // "Silence" timeout: Since we can't do real VAD in webview easily, 
            // we auto-stop after 15s of recording to prevent indefinite hanging.
            var MAX_RECORD_DURATION = 15000; 

            // Detect TTS
            var synth = null;
            try { if (window.speechSynthesis) { synth = window.speechSynthesis; ttsSupported = true; } } catch(e) {}

            // Waveform bars
            if (waveform) {
                waveform.innerHTML = '';
                for (var i = 0; i < 24; i++) {
                    var bar = document.createElement('div');
                    bar.className = 'wave-bar idle';
                    bar.style.animationDelay = (i * 0.04) + 's';
                    waveform.appendChild(bar);
                    waveBars.push(bar);
                }
            }

            // Voice selection
            function pickBestVoice() {
                if (!synth) return null;
                try {
                    var voices = synth.getVoices();
                    if (!voices || !voices.length) return null;
                    var neural = voices.filter(function(v) { return /natural|neural|online/i.test(v.name) && /en/i.test(v.lang); });
                    if (neural.length) return neural[0];
                    var msEn = voices.filter(function(v) { return /microsoft/i.test(v.name) && /en/i.test(v.lang); });
                    if (msEn.length) return msEn[0];
                    return voices.filter(function(v) { return /en/i.test(v.lang); })[0] || voices[0];
                } catch(e) { return null; }
            }
            if (synth) { try { bestVoice = pickBestVoice(); synth.addEventListener('voiceschanged', function() { bestVoice = pickBestVoice(); }); } catch(e) {} }

            // TTS
            function speak(text, cb) {
                if (!synth || !ttsSupported) { if (cb) setTimeout(cb, 600); return; }
                try {
                    synth.cancel();
                    // Strip markdown roughly for speech
                    var plain = text.replace(/[*#\`]/g, '');
    var utter = new SpeechSynthesisUtterance(plain);
    if (bestVoice) utter.voice = bestVoice;
    utter.rate = 1.1; utter.pitch = 1.0;

    isSpeaking = true;
    if (isListening) stopListening(); // Don't listen to self

    setStatus('speaking', 'Verno is speaking...');
    setWaveActive(true);

    var done = false;
    function onDone() {
        if (done) return; done = true;
        isSpeaking = false; setWaveActive(false);
        if (speakTimer) { clearTimeout(speakTimer); speakTimer = null; }
        if (cb) cb();
    }
    utter.onend = onDone;
    utter.onerror = onDone;

    // Safety timeout based on length
    speakTimer = setTimeout(function () { if (!done) { try { synth.cancel(); } catch (e) { } onDone(); } }, Math.max(text.length * 80, 3000));

    synth.speak(utter);
} catch (e) {
    isSpeaking = false;
    if (cb) setTimeout(cb, 500);
}
            }

// Logging
function log(msg) {
    console.log('[Voice] ' + msg);
    vscode.postMessage({ type: 'log', message: msg });
}

// --- RECORDING CONTROL ---

var recordingTimeout = null;
var myvad = null;

async function initVAD() {
    if (myvad || !window.vad) return;
    try {
        log('Initializing WebAssembly VAD...');
        myvad = await window.vad.MicVAD.new({
            workletURL: vadPaths ? vadPaths.workletPath : '',
            modelURL: vadPaths ? vadPaths.modelPath : '',
            ortConfig: {
                wasmPaths: {
                    "ort-wasm.wasm": vadPaths ? vadPaths.wasmRoot + 'ort-wasm.wasm' : '',
                    "ort-wasm-simd.wasm": vadPaths ? vadPaths.wasmRoot + 'ort-wasm-simd.wasm' : '',
                    "ort-wasm-threaded.wasm": vadPaths ? vadPaths.wasmRoot + 'ort-wasm-threaded.wasm' : '',
                    "ort-wasm-simd-threaded.wasm": vadPaths ? vadPaths.wasmRoot + 'ort-wasm-simd-threaded.wasm' : ''
                }
            },
            onSpeechStart: function() {
                log('Speech started.');
                setStatus('listening', 'Hearing you...');
                setWaveActive(true);
            },
            onSpeechEnd: function(audio) {
                log('Speech ended. Processing Int16 PCM...');
                setWaveActive(false);
                setStatus('thinking', 'Processing...');
                
                var int16Array = new Int16Array(audio.length);
                for (var i = 0; i < audio.length; i++) {
                    var s = Math.max(-1, Math.min(1, audio[i]));
                    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
                
                vscode.postMessage({ type: 'vadAudioData', audioData: Array.from(int16Array) });
                stopListening();
            },
            onVADMisfire: function() {
                log('VAD misfire (too short).');
            }
        });
        log('VAD initialized successfully.');
    } catch (e) {
        log('VAD Init Error: ' + e);
    }
}

function startListening() {
    if (isSpeaking || isListening || isProcessing) return;

    isListening = true;
    log('Starting native recording...');
    setStatus('listening', 'Initializing Mic...');
    updateRecordBtn(true);

    if (!myvad) {
        initVAD().then(function() {
            if (isListening && myvad) {
                myvad.start();
                setStatus('listening', 'Listening...');
                setWaveActive(true);
            }
        });
    } else {
        myvad.start();
        setStatus('listening', 'Listening...');
        setWaveActive(true);
    }

    // Auto-stop after MAX_RECORD_DURATION
    if (recordingTimeout) clearTimeout(recordingTimeout);
    recordingTimeout = setTimeout(function () {
        if (isListening) {
            log('Max record duration reached. Stopping...');
            stopListening();
        }
    }, MAX_RECORD_DURATION);
}

function stopListening() {
    if (isListening) {
        log('Stopping native recording...');
        isListening = false;
        
        if (myvad) myvad.pause();

        if (recordingTimeout) { clearTimeout(recordingTimeout); recordingTimeout = null; }

        setWaveActive(false);
        updateRecordBtn(false);
        setStatus('thinking', 'Processing voice...');
    }
}

// UI Helpers
function setStatus(state, text) {
    if (!statusEl || !statusText) return;
    statusEl.className = 'voice-status ' + state;
    statusText.textContent = text;
}

function setWaveActive(active) {
    waveBars.forEach(function (b) {
        if (active) b.classList.add('active');
        else b.classList.remove('active');
    });
}

function updateRecordBtn(recording) {
    var btn = document.getElementById('voiceRecordBtn');
    if (!btn) return;
    
    if (isProcessing) {
        btn.innerHTML = '<span class="btn-icon">⌛</span> <span class="btn-text">Thinking...</span>';
        btn.className = 'voice-record-btn processing';
        btn.style.opacity = '0.7';
        btn.disabled = true;
        btn.style.cursor = 'not-allowed';
    } else {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
        if (recording) {
            btn.innerHTML = '<span class="btn-icon">■</span> <span class="btn-text">Stop Recording</span>';
            btn.className = 'voice-record-btn recording';
        } else {
            btn.innerHTML = '<span class="btn-icon">●</span> <span class="btn-text">Start Recording</span>';
            btn.className = 'voice-record-btn';
        }
    }
}

function addTranscriptTurn(role, text) {
    if (!transcriptEl) return;
    var div = document.createElement('div'); div.className = 'vt-turn ' + role;
    var label = document.createElement('div'); label.className = 'vt-label'; label.textContent = role === 'verno' ? 'Verno' : 'You';
    var content = document.createElement('div'); content.textContent = text;
    div.appendChild(label); div.appendChild(content);
    transcriptEl.appendChild(div); transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function showFallback() { if (fallbackWrap) fallbackWrap.classList.add('show'); setStatus('thinking', 'Type response...'); setWaveActive(false); }

// --- GENERIC MESSAGE HANDLER (Redirects to Speak if Voice Mode) ---
window.handleNewMessage = function (role, content) {
    // Determine if we should speak this message
    // We speak if: Voice Overlay is showing AND rule is assistant
    if (overlay.classList.contains('show') && role === 'assistant') {
        // Add to transcript
        addTranscriptTurn('verno', content);

        // Speak, then Auto-Listen
        speak(content, function () {
            if (overlay.classList.contains('show')) {
                // Slight delay before listening again
                setTimeout(startListening, 500);
            }
        });
    }
};

// --- EVENT HANDLERS from Extension ---
window.handleVoiceTranscript = function (text) {
    if (!text || text.length < 2) {
        setStatus('ready', 'No speech detected. Try again.');
        updateRecordBtn(false);
        // Don't auto-restart, let user choose to tap record again or cancel
        return;
    }

    // Lock UI while text is being processed by the backend agent
    isProcessing = true;
    updateRecordBtn(false);

    // Add to transcript
    transcript.push({ role: 'user', text: text });
    addTranscriptTurn('user', text);

    // Send to Agent
    setStatus('thinking', 'Agent is thinking...');
    submitToAgent(text);

    // Safety valve — unlock after 30 seconds no matter what
    if (safetyTimeout) clearTimeout(safetyTimeout);
    safetyTimeout = setTimeout(() => {
        if (isProcessing) {
            isProcessing = false;
            updateRecordBtn(isListening);
            console.warn('[VoiceChatEngine] Mutex force-released after timeout');
            setStatus('ready', 'Click Record to speak');
        }
    }, 30000);
}

window.handleThinkingState = function(isThinking) {
    if (isProcessing !== isThinking) {
        isProcessing = isThinking;
        if (!isThinking) {
            if (safetyTimeout) {
                clearTimeout(safetyTimeout);
                safetyTimeout = null;
            }
            if (!isListening && !isSpeaking) {
                setStatus('ready', 'Click Record to speak');
            }
        }
        updateRecordBtn(isListening);
    }
}

window.handleVoiceError = function (msg) {
    isProcessing = false;
    setStatus('thinking', 'Error: ' + msg);
    updateRecordBtn(false);
    if (recordingTimeout) clearTimeout(recordingTimeout);
    // Beep or something?
    setTimeout(() => setStatus('ready', 'Press Record to retry'), 2000);
}

function submitToAgent(text) {
    // We do NOT close voice here. We stay open for the reply.
    addMsg('user', text); // Add to main chat history too

    var apiKey = getProviderKey(S.model);
    if (apiKey) {
        vscode.postMessage({ type: 'processInputSubmit', input: text, apiKey: apiKey, mode: S.mode, model: S.model });
    } else {
        // No key? Fallback
        addMsg('system', 'No API Key found. Ending voice session.');
        closeVoice();
    }
}

// Open/Close
function openVoice(isRestore) {
    transcript = [];
    if (transcriptEl) transcriptEl.innerHTML = '';
    if (fallbackWrap) fallbackWrap.classList.remove('show');
    overlay.classList.add('show');

    // Start with greeting if new session
    var greeting = "I'm listening. What's on your mind?";
    if (!isRestore) {
        addTranscriptTurn('verno', greeting);
        setStatus('ready', 'Speaking...');
        speak(greeting, function () {
            startListening();
        });
    } else {
        // Restore mode: Just go straight to listening or ready?
        // Let's go to ready, user can tap record.
        setStatus('ready', 'Click Record to speak');
        // Or if we want to be aggressive, startListening()
        // startListening(); 
    }
}

function closeVoice() {
    stopListening();
    if (synth) synth.cancel();
    if (speakTimer) clearTimeout(speakTimer);
    if (recordingTimeout) clearTimeout(recordingTimeout);

    overlay.classList.remove('show');
    isListening = false; isSpeaking = false;

    // Notify backend
    vscode.postMessage({ type: 'voiceSessionEnded' });
}

// Inputs
voiceBtn.addEventListener('click', function () {
    try { openVoice(); } catch (e) { console.error(e); }
});

var voiceRecordBtn = document.getElementById('voiceRecordBtn');
if (voiceRecordBtn) {
    voiceRecordBtn.addEventListener('click', function () {
        if (isListening) stopListening();
        else startListening();
    });
}

if (endBtn) endBtn.addEventListener('click', closeVoice);

window.addEventListener('message', event => {
    const m = event.data;
    if (m.type === 'voiceTranscript') window.handleVoiceTranscript(m.text);
    else if (m.type === 'voiceError') window.handleVoiceError(m.message);
    // Hook into newMessage for TTS
    else if (m.type === 'newMessage' && m.message) {
        window.handleNewMessage(m.message.role, m.message.content);
    }
    else if (m.type === 'thinking') {
        if (window.handleThinkingState) window.handleThinkingState(m.show);
    }
    else if (m.type === 'apiKeySaved') {
        addMsg('system', 'Provider ' + m.provider + ' is active and re-initialized successfully.');
    }
    else if (m.type === 'apiKeyDeleted') {
        addMsg('system', 'Provider ' + m.provider + ' credentials removed from memory.');
    }
    else if (m.type === 'restoreVoiceSession') {
        // Restore UI without greeting
        openVoice(true); 
    }
});

        }) ();

    // Signal that we are ready
    vscode.postMessage({ type: 'webviewReady' });
    
    }) ();
</script>
    </body>
    </html>`;
}
