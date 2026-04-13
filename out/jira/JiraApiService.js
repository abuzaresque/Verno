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
exports.JiraApiService = void 0;
const https = __importStar(require("https"));
class JiraApiService {
    creds;
    logger;
    authHeader;
    constructor(creds, logger) {
        this.creds = creds;
        this.logger = logger;
        this.authHeader = 'Basic ' + Buffer.from(`${creds.email}:${creds.apiToken}`).toString('base64');
    }
    async request(method, path, payload) {
        const options = {
            hostname: this.creds.domain,
            path,
            method,
            headers: {
                'Authorization': this.authHeader,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        };
        return this.executeWithBackoff(options, payload);
    }
    async executeWithBackoff(options, payload, maxRetries = 3) {
        let attempt = 0;
        let delay = 500;
        while (attempt <= maxRetries) {
            try {
                return await this.executeRequest(options, payload);
            }
            catch (error) {
                if (attempt === maxRetries || (error.statusCode !== 429 && error.statusCode >= 400 && error.statusCode < 500)) {
                    // Do not retry client errors other than 429
                    throw error;
                }
                attempt++;
                this.logger.warn(`Jira API request failed (attempt ${attempt}), retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
            }
        }
        throw new Error('Jira API Max Retries Reached');
    }
    executeRequest(options, payload) {
        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    const statusCode = res.statusCode || 500;
                    if (statusCode >= 200 && statusCode < 300) {
                        try {
                            const parsed = data ? JSON.parse(data) : {};
                            resolve(parsed);
                        }
                        catch (e) {
                            reject(new Error(`Failed to parse JSON: ${e}`));
                        }
                    }
                    else {
                        reject({ statusCode, message: `API Error: ${statusCode} ${data}` });
                    }
                });
            });
            req.on('error', (err) => {
                reject(err);
            });
            if (payload) {
                req.write(JSON.stringify(payload));
            }
            req.end();
        });
    }
    async listProjects() {
        const projects = [];
        let startAt = 0;
        const maxResults = 50;
        let isLast = false;
        while (!isLast) {
            const res = await this.request('GET', `/rest/api/3/project/search?startAt=${startAt}&maxResults=${maxResults}`);
            if (res.values && res.values.length > 0) {
                projects.push(...res.values.map((p) => ({
                    id: p.id,
                    key: p.key,
                    name: p.name,
                    availableIssueTypes: [] // To be fetched per project
                })));
            }
            else {
                break;
            }
            if (startAt + res.values.length >= res.total) {
                isLast = true;
            }
            else {
                startAt += maxResults;
            }
        }
        return projects;
    }
    async discoverFields() {
        const fields = await this.request('GET', `/rest/api/3/field`);
        const spField = fields.find(f => {
            const name = (f.name || '').toLowerCase();
            return name.includes('story point') || name.includes('story_points');
        });
        return spField ? spField.id : null;
    }
    async getIssueTypes(projectKey) {
        const project = await this.request('GET', `/rest/api/3/project/${projectKey}`);
        if (project && project.issueTypes) {
            return project.issueTypes.map((t) => t.name);
        }
        return [];
    }
    async createIssue(payload) {
        return this.request('POST', `/rest/api/3/issue`, payload);
    }
    async getIssue(key) {
        return this.request('GET', `/rest/api/3/issue/${key}`);
    }
}
exports.JiraApiService = JiraApiService;
//# sourceMappingURL=JiraApiService.js.map