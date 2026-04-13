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
exports.JiraAuthService = void 0;
const https = __importStar(require("https"));
class JiraAuthService {
    static instance;
    context;
    constructor(context) {
        this.context = context;
    }
    static getInstance(context) {
        if (!JiraAuthService.instance && context) {
            JiraAuthService.instance = new JiraAuthService(context);
        }
        if (!JiraAuthService.instance) {
            throw new Error('JiraAuthService not initialized');
        }
        return JiraAuthService.instance;
    }
    formatDomain(domain) {
        let cleaned = domain.trim().toLowerCase();
        cleaned = cleaned.replace(/^https?:\/\//, '');
        cleaned = cleaned.replace(/\/+$/, '');
        if (!cleaned.includes('.')) {
            cleaned = `${cleaned}.atlassian.net`;
        }
        return cleaned;
    }
    async saveCredentials(creds) {
        creds.domain = this.formatDomain(creds.domain);
        await this.context.secrets.store('jira_domain', creds.domain);
        await this.context.secrets.store('jira_email', creds.email);
        await this.context.secrets.store('jira_apiToken', creds.apiToken);
    }
    async getCredentials() {
        const domain = await this.context.secrets.get('jira_domain');
        const email = await this.context.secrets.get('jira_email');
        const apiToken = await this.context.secrets.get('jira_apiToken');
        if (domain && email && apiToken) {
            return { domain, email, apiToken };
        }
        return null;
    }
    async clearCredentials() {
        await this.context.secrets.delete('jira_domain');
        await this.context.secrets.delete('jira_email');
        await this.context.secrets.delete('jira_apiToken');
    }
    async isAuthenticated() {
        return (await this.getCredentials()) !== null;
    }
    async validateCredentials(creds) {
        const c = creds || await this.getCredentials();
        if (!c)
            return false;
        const authHeader = 'Basic ' + Buffer.from(`${c.email}:${c.apiToken}`).toString('base64');
        const options = {
            hostname: c.domain,
            path: '/rest/api/3/myself',
            method: 'GET',
            headers: {
                'Authorization': authHeader,
                'Accept': 'application/json'
            }
        };
        return new Promise((resolve) => {
            const req = https.request(options, (res) => {
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(true);
                }
                else {
                    resolve(false);
                }
                res.on('data', () => { }); // consume data
            });
            req.on('error', () => {
                resolve(false);
            });
            req.end();
        });
    }
}
exports.JiraAuthService = JiraAuthService;
//# sourceMappingURL=JiraAuthService.js.map