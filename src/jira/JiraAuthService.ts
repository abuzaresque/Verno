import * as vscode from 'vscode';
import * as https from 'https';
import { JiraCredentials } from '../types/sdlc';

export class JiraAuthService {
    private static instance: JiraAuthService;
    private context: vscode.ExtensionContext;

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    public static getInstance(context?: vscode.ExtensionContext): JiraAuthService {
        if (!JiraAuthService.instance && context) {
            JiraAuthService.instance = new JiraAuthService(context);
        }
        if (!JiraAuthService.instance) {
            throw new Error('JiraAuthService not initialized');
        }
        return JiraAuthService.instance;
    }

    public formatDomain(domain: string): string {
        let cleaned = domain.trim().toLowerCase();
        cleaned = cleaned.replace(/^https?:\/\//, '');
        cleaned = cleaned.replace(/\/+$/, '');
        if (!cleaned.includes('.')) {
            cleaned = `${cleaned}.atlassian.net`;
        }
        return cleaned;
    }

    public async saveCredentials(creds: JiraCredentials): Promise<void> {
        creds.domain = this.formatDomain(creds.domain);
        await this.context.secrets.store('jira_domain', creds.domain);
        await this.context.secrets.store('jira_email', creds.email);
        await this.context.secrets.store('jira_apiToken', creds.apiToken);
    }

    public async getCredentials(): Promise<JiraCredentials | null> {
        const domain = await this.context.secrets.get('jira_domain');
        const email = await this.context.secrets.get('jira_email');
        const apiToken = await this.context.secrets.get('jira_apiToken');

        if (domain && email && apiToken) {
            return { domain, email, apiToken };
        }
        return null;
    }

    public async clearCredentials(): Promise<void> {
        await this.context.secrets.delete('jira_domain');
        await this.context.secrets.delete('jira_email');
        await this.context.secrets.delete('jira_apiToken');
    }

    public async isAuthenticated(): Promise<boolean> {
        return (await this.getCredentials()) !== null;
    }

    public async validateCredentials(creds?: JiraCredentials): Promise<boolean> {
        const c = creds || await this.getCredentials();
        if (!c) return false;

        const authHeader = 'Basic ' + Buffer.from(`${c.email}:${c.apiToken}`).toString('base64');
        const options: https.RequestOptions = {
            hostname: c.domain,
            path: '/rest/api/3/myself',
            method: 'GET',
            headers: {
                'Authorization': authHeader,
                'Accept': 'application/json'
            }
        };

        return new Promise<boolean>((resolve) => {
            const req = https.request(options, (res) => {
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(true);
                } else {
                    resolve(false);
                }
                res.on('data', () => {}); // consume data
            });

            req.on('error', () => {
                resolve(false);
            });

            req.end();
        });
    }
}
