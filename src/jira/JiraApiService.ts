import * as https from 'https';
import { JiraCredentials, JiraProject } from '../types/sdlc';
import { Logger } from '../utils/logger';

export class JiraApiService {
    private creds: JiraCredentials;
    private logger: Logger;
    private authHeader: string;

    constructor(creds: JiraCredentials, logger: Logger) {
        this.creds = creds;
        this.logger = logger;
        this.authHeader = 'Basic ' + Buffer.from(`${creds.email}:${creds.apiToken}`).toString('base64');
    }

    private async request<T>(method: string, path: string, payload?: any): Promise<T> {
        const options: https.RequestOptions = {
            hostname: this.creds.domain,
            path,
            method,
            headers: {
                'Authorization': this.authHeader,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        };

        return this.executeWithBackoff<T>(options, payload);
    }

    private async executeWithBackoff<T>(options: https.RequestOptions, payload?: any, maxRetries = 3): Promise<T> {
        let attempt = 0;
        let delay = 500;

        while (attempt <= maxRetries) {
            try {
                return await this.executeRequest<T>(options, payload);
            } catch (error: any) {
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

    private executeRequest<T>(options: https.RequestOptions, payload?: any): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    const statusCode = res.statusCode || 500;
                    if (statusCode >= 200 && statusCode < 300) {
                        try {
                            const parsed = data ? JSON.parse(data) : {};
                            resolve(parsed as T);
                        } catch (e) {
                            reject(new Error(`Failed to parse JSON: ${e}`));
                        }
                    } else {
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

    public async listProjects(): Promise<JiraProject[]> {
        const projects: JiraProject[] = [];
        let startAt = 0;
        const maxResults = 50;
        let isLast = false;

        while (!isLast) {
            const res: any = await this.request('GET', `/rest/api/3/project/search?startAt=${startAt}&maxResults=${maxResults}`);
            if (res.values && res.values.length > 0) {
                projects.push(...res.values.map((p: any) => ({
                    id: p.id,
                    key: p.key,
                    name: p.name,
                    availableIssueTypes: [] // To be fetched per project
                })));
            } else {
                break;
            }
            if (startAt + res.values.length >= res.total) {
                isLast = true;
            } else {
                startAt += maxResults;
            }
        }
        return projects;
    }

    public async discoverFields(): Promise<string | null> {
        const fields: any[] = await this.request('GET', `/rest/api/3/field`);
        const spField = fields.find(f => {
            const name = (f.name || '').toLowerCase();
            return name.includes('story point') || name.includes('story_points');
        });
        return spField ? spField.id : null;
    }

    public async getIssueTypes(projectKey: string): Promise<string[]> {
        const project: any = await this.request('GET', `/rest/api/3/project/${projectKey}`);
        if (project && project.issueTypes) {
            return project.issueTypes.map((t: any) => t.name);
        }
        return [];
    }

    public async createIssue(payload: any): Promise<{ id: string, key: string }> {
        return this.request<{ id: string, key: string }>('POST', `/rest/api/3/issue`, payload);
    }

    public async getIssue(key: string): Promise<any> {
        return this.request<any>('GET', `/rest/api/3/issue/${key}`);
    }
}
