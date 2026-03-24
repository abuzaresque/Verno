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
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' blob:; connect-src vscode-webview-resource: https:; worker-src blob:; media-src vscode-webview-resource: https: blob: mediastream:;">
    <style>
        :root {
            --bg: var(--vscode-sideBar-background);
            --fg: var(--vscode-foreground);
            --input-bg: var(--vscode-input-background);
            --input-fg: var(--vscode-input-foreground);
            --border: var(--vscode-panel-border);
            --btn-bg: var(--vscode-button-background);
            --btn-fg: var(--vscode-button-foreground);
            --btn-hover: var(--vscode-button-hoverBackground);
            --badge-bg: var(--vscode-badge-background);
            --badge-fg: var(--vscode-badge-foreground);
            --header-bg: var(--vscode-sideBarSectionHeader-background);
            --editor-bg: var(--vscode-editor-background);
            --quote-bg: var(--vscode-textBlockQuote-background);
            --focus: var(--vscode-focusBorder);
            --desc: var(--vscode-descriptionForeground);
            --link: var(--vscode-textLink-activeForeground, #007acc);
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: var(--vscode-font-family); color: var(--fg); background: var(--bg); display: flex; flex-direction: column; height: 100vh; overflow: hidden; position: relative; }

        /* HEADER */
        .header { padding: 8px 12px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; background: var(--header-bg); min-height: 38px; z-index: 50; }
        .header-title { opacity: 0.9; letter-spacing: 0.5px; margin-right: auto; }
        .hdr-btn { background: none; border: none; color: var(--fg); cursor: pointer; opacity: 0.55; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; border-radius: 4px; transition: all 0.12s; }
        .hdr-btn:hover { opacity: 1; background: rgba(128,128,128,0.15); }
        .hdr-btn.active { opacity: 1; background: rgba(128,128,128,0.2); }
        .hdr-btn svg { width: 15px; height: 15px; fill: currentColor; }

        /* OVERLAY */
        .overlay-bg { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 90; }
        .overlay-bg.show { display: block; }
        .panel { display: none; position: absolute; top: 40px; right: 6px; width: calc(100% - 12px); max-height: 75vh; background: var(--editor-bg); border: 1px solid var(--border); border-radius: 6px; box-shadow: 0 4px 16px rgba(0,0,0,0.3); z-index: 100; overflow: hidden; flex-direction: column; }
        .panel.show { display: flex; }
        .p-hdr { padding: 9px 12px; font-size: 12px; font-weight: 600; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
        .p-close { background: none; border: none; color: var(--fg); cursor: pointer; opacity: 0.5; font-size: 18px; line-height: 1; }
        .p-close:hover { opacity: 1; }
        .p-body { padding: 10px 12px; overflow-y: auto; flex: 1; font-size: 12px; }

        /* SECTION TITLE */
        .stitle { font-size: 9px; text-transform: uppercase; letter-spacing: 0.8px; opacity: 0.5; margin-bottom: 6px; font-weight: 700; }

        /* PROFILE */
        .prov-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
        .prov-item { display: flex; align-items: center; gap: 6px; padding: 5px 8px; background: var(--quote-bg); border-radius: 4px; font-size: 11px; }
        .prov-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
        .prov-dot.on { background: #4caf50; }
        .prov-dot.off { background: #666; }
        .prov-name { flex: 1; font-weight: 600; }
        .prov-key { opacity: 0.5; font-family: monospace; font-size: 10px; }
        .prov-del { background: none; border: none; color: #e74c3c; cursor: pointer; font-size: 14px; opacity: 0.6; }
        .prov-del:hover { opacity: 1; }
        .add-prov { margin-bottom: 12px; }
        .add-prov select, .add-prov input { width: 100%; padding: 4px 6px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); border-radius: 3px; font-size: 11px; margin-bottom: 4px; font-family: inherit; }
        .add-prov input:focus, .add-prov select:focus { outline: 1px solid var(--focus); border-color: var(--focus); }
        .small-btn { padding: 4px 10px; background: var(--btn-bg); color: var(--btn-fg); border: none; border-radius: 3px; font-size: 10px; cursor: pointer; font-weight: 600; }
        .small-btn:hover { background: var(--btn-hover); }
        .ws-info { padding: 6px 8px; background: var(--quote-bg); border-radius: 4px; font-size: 11px; line-height: 1.6; }

        /* CONVERSATIONS */
        .conv-item { display: flex; align-items: center; padding: 7px 8px; border-radius: 4px; cursor: pointer; gap: 6px; transition: background 0.1s; font-size: 11px; }
        .conv-item:hover { background: rgba(128,128,128,0.12); }
        .conv-title { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .conv-meta { font-size: 9px; opacity: 0.4; white-space: nowrap; }
        .conv-star { background: none; border: none; cursor: pointer; font-size: 13px; opacity: 0.3; color: #f1c40f; }
        .conv-star:hover, .conv-star.starred { opacity: 1; }
        .conv-del { background: none; border: none; cursor: pointer; font-size: 12px; opacity: 0.3; color: #e74c3c; }
        .conv-del:hover { opacity: 1; }

        /* MCP */
        .mcp-search { width: 100%; padding: 5px 8px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); border-radius: 4px; font-size: 11px; margin-bottom: 8px; font-family: inherit; }
        .mcp-search:focus { outline: 1px solid var(--focus); border-color: var(--focus); }
        .mcp-card { padding: 8px 10px; background: var(--quote-bg); border: 1px solid var(--border); border-radius: 5px; margin-bottom: 6px; }
        .mcp-card:hover { border-color: var(--focus); }
        .mcp-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 3px; }
        .mcp-name { font-size: 11px; font-weight: 600; }
        .mcp-badge { font-size: 9px; padding: 1px 5px; border-radius: 8px; background: var(--badge-bg); color: var(--badge-fg); }
        .mcp-badge.inst { background: rgba(76,175,80,0.2); color: #4caf50; }
        .mcp-desc { font-size: 10px; opacity: 0.6; line-height: 1.4; margin-bottom: 5px; }
        .mcp-actions { display: flex; gap: 4px; }
        .scope-select { padding: 2px 4px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); border-radius: 3px; font-size: 9px; }

        /* SETTINGS */
        .settings-split { display: flex; height: 100%; min-height: 300px; }
        .settings-nav { width: 110px; border-right: 1px solid var(--border); display: flex; flex-direction: column; padding: 4px 0; flex-shrink: 0; }
        .settings-nav-item { padding: 7px 10px; font-size: 11px; cursor: pointer; border-left: 2px solid transparent; opacity: 0.7; }
        .settings-nav-item:hover { opacity: 1; background: rgba(128,128,128,0.08); }
        .settings-nav-item.active { opacity: 1; border-left-color: var(--link); font-weight: 600; }
        .settings-content { flex: 1; padding: 10px 12px; overflow-y: auto; }
        .settings-group { margin-bottom: 14px; }
        .settings-label { font-size: 11px; font-weight: 600; margin-bottom: 4px; }
        .settings-desc { font-size: 10px; opacity: 0.5; margin-bottom: 6px; }
        .settings-input { width: 100%; padding: 4px 6px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); border-radius: 3px; font-size: 11px; font-family: inherit; }
        .settings-input:focus { outline: 1px solid var(--focus); border-color: var(--focus); }
        .settings-check { display: flex; align-items: center; gap: 6px; font-size: 11px; cursor: pointer; }
        .settings-check input[type=checkbox] { cursor: pointer; }
        .settings-page { display: none; }
        .settings-page.active { display: block; }

        /* BEHAVIOUR SUB-TABS */
        .sub-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); margin-bottom: 10px; }
        .sub-tab { padding: 5px 10px; font-size: 10px; cursor: pointer; opacity: 0.6; border-bottom: 2px solid transparent; font-weight: 600; }
        .sub-tab:hover { opacity: 1; }
        .sub-tab.active { opacity: 1; border-bottom-color: var(--link); }
        .sub-page { display: none; }
        .sub-page.active { display: block; }
        .editable-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
        .editable-item { display: flex; align-items: center; gap: 6px; padding: 5px 8px; background: var(--quote-bg); border-radius: 4px; font-size: 11px; }
        .editable-item span { flex: 1; }
        .editable-item .item-scope { font-size: 9px; opacity: 0.5; padding: 1px 4px; background: rgba(128,128,128,0.15); border-radius: 3px; }
        .editable-item .item-del { background: none; border: none; color: #e74c3c; cursor: pointer; font-size: 13px; opacity: 0.5; }
        .editable-item .item-del:hover { opacity: 1; }
        .add-row { display: flex; gap: 4px; margin-bottom: 6px; }
        .add-row input, .add-row textarea { flex: 1; padding: 4px 6px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); border-radius: 3px; font-size: 11px; font-family: inherit; }
        .add-row input:focus, .add-row textarea:focus { outline: 1px solid var(--focus); border-color: var(--focus); }
        .add-row select { padding: 4px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); border-radius: 3px; font-size: 10px; }
        .role-box { width: 100%; min-height: 50px; padding: 6px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); border-radius: 3px; font-size: 11px; font-family: inherit; resize: vertical; margin-bottom: 4px; }
        .role-box:focus { outline: 1px solid var(--focus); border-color: var(--focus); }

        /* CONVERSATION */
        .conversation { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 14px; }
        .message { display: flex; flex-direction: column; gap: 3px; max-width: 92%; animation: fadeIn 0.2s; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }
        .message.user { align-self: flex-end; }
        .message.assistant { align-self: flex-start; }
        .message.system { align-self: center; max-width: 80%; }
        .message-bubble { padding: 7px 11px; border-radius: 6px; line-height: 1.5; font-size: 13px; word-wrap: break-word; }
        .message.user .message-bubble { background: var(--btn-bg); color: var(--btn-fg); }
        .message.assistant .message-bubble { background: var(--input-bg); border: 1px solid var(--border); }
        .message.system .message-bubble { font-size: 11px; opacity: 0.7; background: var(--quote-bg); border-radius: 4px; padding: 4px 8px; }

        /* INPUT */
        .input-area { border-top: 1px solid var(--border); padding: 10px; background: var(--bg); display: flex; flex-direction: column; gap: 6px; }
        textarea { width: 100%; min-height: 44px; max-height: 180px; padding: 7px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); border-radius: 4px; resize: vertical; font-family: inherit; font-size: 13px; }
        textarea:focus { outline: 1px solid var(--focus); border-color: var(--focus); }
        .toolbar { display: flex; justify-content: space-between; align-items: center; gap: 6px; height: 26px; }
        .left-ctrl { display: flex; gap: 6px; align-items: center; flex: 1; }
        .tsel { height: 24px; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); border-radius: 3px; padding: 0 4px; font-size: 10px; cursor: pointer; outline: none; }
        .tsel:focus { border-color: var(--focus); }
        .right-ctrl { display: flex; gap: 5px; align-items: center; }
        .send-btn { height: 24px; padding: 0 12px; background: var(--btn-bg); color: var(--btn-fg); border: none; border-radius: 3px; font-size: 10px; font-weight: 700; cursor: pointer; }
        .send-btn:hover { background: var(--btn-hover); }
        .api-key-prompt { display: none; margin-top: 6px; padding: 6px 8px; background: var(--quote-bg); border: 1px solid var(--border); border-radius: 4px; font-size: 11px; }
        .api-key-prompt input { margin-top: 3px; width: 100%; padding: 4px; background: var(--input-bg); border: 1px solid var(--border); color: var(--input-fg); font-size: 11px; }

        /* CONTEXT BAR */
        .ctx-bar { position: absolute; top: 42px; left: 50%; transform: translateX(-50%); background: var(--editor-bg); border: 1px solid var(--border); box-shadow: 0 2px 8px rgba(0,0,0,0.15); border-radius: 16px; padding: 3px 10px; display: flex; align-items: center; gap: 6px; font-size: 9px; z-index: 80; opacity: 0; transition: opacity 0.3s; pointer-events: none; }
        .ctx-bar.show { opacity: 1; }
        .ctx-label { color: var(--desc); font-weight: 600; text-transform: uppercase; }
        .ctx-prog { width: 80px; height: 3px; background: rgba(128,128,128,0.2); border-radius: 2px; overflow: hidden; }
        .ctx-fill { height: 100%; background: var(--link); width: 0%; transition: width 0.3s; }
        .ctx-stats { min-width: 50px; text-align: right; font-variant-numeric: tabular-nums; }

        /* ===== VOICE CONVERSATION BUTTON ===== */
        @keyframes purplePulse {
            0%, 100% { background-color: rgba(120, 50, 220, 0.55); }
            50% { background-color: rgba(160, 80, 255, 0.75); }
        }
        .voice-btn-wrap { padding: 8px 10px 0 10px; }
        .voice-btn {
            width: 100%; padding: 10px 16px; border: none; border-radius: 8px; cursor: pointer; font-family: inherit; font-size: 12px; font-weight: 700; letter-spacing: 0.5px; color: rgba(255,255,255,0.92); display: flex; align-items: center; justify-content: center; gap: 8px; position: relative; overflow: hidden; transition: transform 0.15s, filter 0.15s;
            background-color: rgba(130, 60, 230, 0.6);
            animation: purplePulse 4s ease-in-out infinite;
        }
        .voice-btn:hover { transform: translateY(-1px); filter: brightness(1.2); }
        .voice-btn:active { transform: translateY(0); filter: brightness(0.9); }
        .voice-btn svg { width: 16px; height: 16px; fill: currentColor; flex-shrink: 0; opacity: 0.9; }
        .voice-btn .btn-text { opacity: 0.95; }

        /* ===== VOICE OVERLAY ===== */
        .voice-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 200; background: rgba(0,0,0,0.92); backdrop-filter: blur(12px); flex-direction: column; align-items: center; justify-content: center; gap: 20px; }
        .voice-overlay.show { display: flex; }
        .voice-overlay-header { text-align: center; }
        .voice-overlay-title { font-size: 18px; font-weight: 800; letter-spacing: 1px; background: linear-gradient(135deg, #00ff88, #00c8ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        .voice-overlay-subtitle { font-size: 11px; opacity: 0.5; margin-top: 4px; color: #ccc; }

        /* Waveform */
        .voice-waveform { display: flex; align-items: center; justify-content: center; gap: 3px; height: 60px; }
        .wave-bar { width: 4px; border-radius: 4px; background: linear-gradient(180deg, #00ff88, #00c8ff); transition: height 0.1s ease; }
        .wave-bar.idle { height: 6px; opacity: 0.3; }
        @keyframes waveAnim1 { 0%,100%{height:8px;} 50%{height:40px;} }
        @keyframes waveAnim2 { 0%,100%{height:12px;} 50%{height:52px;} }
        @keyframes waveAnim3 { 0%,100%{height:6px;} 50%{height:28px;} }
        .wave-bar.active:nth-child(3n+1) { animation: waveAnim1 0.6s ease-in-out infinite; }
        .wave-bar.active:nth-child(3n+2) { animation: waveAnim2 0.5s ease-in-out infinite; }
        .wave-bar.active:nth-child(3n+3) { animation: waveAnim3 0.7s ease-in-out infinite; }

        /* Status pill */
        .voice-status { display: inline-flex; align-items: center; gap: 6px; padding: 4px 14px; border-radius: 20px; font-size: 11px; font-weight: 600; }
        .voice-status.listening { background: rgba(0,255,136,0.15); color: #00ff88; }
        .voice-status.speaking { background: rgba(0,200,255,0.15); color: #00c8ff; }
        .voice-status.thinking { background: rgba(123,47,255,0.15); color: #b388ff; }
        .voice-status .status-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: statusBlink 1s ease-in-out infinite; }
        @keyframes statusBlink { 0%,100%{opacity:1;} 50%{opacity:0.3;} }

        /* Transcript */
        .voice-transcript { width: 85%; max-width: 380px; max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; }
        .vt-turn { font-size: 12px; line-height: 1.5; padding: 6px 10px; border-radius: 8px; max-width: 90%; animation: fadeIn 0.2s; }
        .vt-turn.verno { align-self: flex-start; background: rgba(0,200,255,0.1); color: #b0e0ff; border-left: 2px solid #00c8ff; }
        .vt-turn.user { align-self: flex-end; background: rgba(0,255,136,0.1); color: #b0ffdb; border-right: 2px solid #00ff88; }
        .vt-turn .vt-label { font-size: 9px; font-weight: 700; text-transform: uppercase; opacity: 0.5; margin-bottom: 2px; }
        .vt-interim { opacity: 0.4; font-style: italic; }

        /* End button */
        .voice-end-btn { padding: 10px 20px; border: 1px solid rgba(255,255,255,0.15); border-radius: 20px; background: rgba(255,255,255,0.05); color: #ccc; font-size: 11px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
        .voice-end-btn:hover { background: rgba(231,76,60,0.2); border-color: #e74c3c; color: #ff8a80; }

        /* Record button */
        .voice-record-btn { padding: 10px 24px; border: none; border-radius: 20px; background: #00ff88; color: #000; font-size: 12px; font-weight: 700; cursor: pointer; transition: all 0.15s; display: flex; align-items: center; gap: 6px; }
        .voice-record-btn:hover:not(:disabled) { transform: scale(1.05); box-shadow: 0 0 15px rgba(0,255,136,0.4); }
        .voice-record-btn.recording { background: #ff4757; color: white; animation: pulseRed 2s infinite; }
        .voice-record-btn.processing { background: #b388ff; color: #000; }
        .voice-record-btn .btn-icon { font-size: 10px; }
        @keyframes pulseRed { 0% { box-shadow: 0 0 0 0 rgba(255, 71, 87, 0.4); } 70% { box-shadow: 0 0 0 10px rgba(255, 71, 87, 0); } 100% { box-shadow: 0 0 0 0 rgba(255, 71, 87, 0); } }

        /* Fallback input */
        .voice-fallback { display: none; width: 85%; max-width: 380px; }
        .voice-fallback.show { display: flex; gap: 6px; }
        .voice-fallback input { flex: 1; padding: 8px 12px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; color: #fff; font-size: 12px; font-family: inherit; }
        .voice-fallback input:focus { outline: 1px solid #00ff88; border-color: #00ff88; }
        .voice-fallback button { padding: 8px 14px; background: linear-gradient(135deg, #00ff88, #00c8ff); border: none; border-radius: 8px; color: #000; font-size: 11px; font-weight: 700; cursor: pointer; }
        .voice-fallback button { padding: 8px 14px; background: linear-gradient(135deg, #00ff88, #00c8ff); border: none; border-radius: 8px; color: #000; font-size: 11px; font-weight: 700; cursor: pointer; }
    </style>
    ${vadPaths ? `<script nonce="${nonce}" src="${vadPaths.bundlePath}"></script>` : ''}
</head>
<body>
    <div class="header">
        <span class="header-title">Verno</span>
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
                <select id="modeSelect" class="tsel" style="min-width:60px;font-weight:600;"><option value="plan">Plan</option><option value="code">Code</option><option value="ask">Ask</option></select>
                <select id="modelSelect" class="tsel" style="min-width:90px;"><option value="gemini">Gemini Pro</option><option value="groq">Groq</option></select>
            </div>
            <div class="right-ctrl"><button class="send-btn" id="sendBtn">Send</button></div>
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
                del.addEventListener('click',function(){S.providers.splice(i,1);save();renderProviders();checkApiKey();});
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
        document.querySelectorAll('.settings-nav-item').forEach(function(item){
            item.addEventListener('click',function(){
                document.querySelectorAll('.settings-nav-item').forEach(function(n){n.classList.remove('active');});
                document.querySelectorAll('.settings-page').forEach(function(p){p.classList.remove('active');});
                item.classList.add('active');
                var pg=document.getElementById('page-'+item.getAttribute('data-page'));
                if(pg) pg.classList.add('active');
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
        if(modeSelect) modeSelect.addEventListener('change',function(){S.mode=modeSelect.value;save();updatePlaceholder(S.mode);});
        if(modelSelect) modelSelect.addEventListener('change',function(){S.model=modelSelect.value;save();checkApiKey();});
        function updatePlaceholder(m){if(!msgInput)return;if(m==='plan')msgInput.placeholder='What should we build today?';else if(m==='code')msgInput.placeholder='Describe code changes...';else if(m==='ask')msgInput.placeholder='Ask a question...';else msgInput.placeholder='Type a message...';}
        function checkApiKey(){
            var key=getProviderKey(S.model);
            if(!key&&apiKeyPrompt){apiKeyPrompt.style.display='block';var nd=document.getElementById('modelNameDisp');if(nd)nd.textContent=S.model;}
            else if(apiKeyPrompt){apiKeyPrompt.style.display='none';}
        }
        function getProviderKey(modelId){
            var p=S.providers.find(function(x){return x.id===modelId;});
            return p?p.key:'';
        }
        if(apiKeyInp) apiKeyInp.addEventListener('keydown',function(e){
            if(e.key==='Enter'){var k=apiKeyInp.value.trim();if(k){
                S.providers=S.providers.filter(function(p){return p.id!==S.model;});
                S.providers.push({id:S.model,name:S.model,key:k});
                save();apiKeyInp.value='';checkApiKey();
            }}
        });

        // === SEND ===
        if(sendBtn) sendBtn.addEventListener('click',function(){sendMessage();});
        if(msgInput) msgInput.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}});
        function sendMessage(){
            if(!msgInput)return;
            var text=msgInput.value.trim(); if(!text)return;
            var apiKey=getProviderKey(S.model);
            if(!apiKey){if(apiKeyPrompt)apiKeyPrompt.style.display='block';if(apiKeyInp)apiKeyInp.focus();addMsg('system','Please add an API key first (use Profile button).');return;}
            addMsg('user',text); msgInput.value=''; msgInput.style.height='auto';
            if(thinking)thinking.style.display='block';
            if(conv)conv.scrollTop=conv.scrollHeight;
            vscode.postMessage({type:'processInputSubmit',input:text,apiKey:apiKey,mode:S.mode,model:S.model});
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
                case 'newMessage': if(m.message)addMsg(m.message.role,m.message.content); if(thinking)thinking.style.display='none'; setTimeout(function(){if(ctxBar)ctxBar.classList.remove('show');},2000); break;
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
