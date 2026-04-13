import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Epic, JiraCredentials, JiraFieldMapping, SyncStatus } from '../types/sdlc';
import { JiraApiService } from './JiraApiService';
import { Logger } from '../utils/logger';

export class JiraSyncService {
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    private getWorkspaceRoot(): string | undefined {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    private saveState(epics: Epic[]): void {
        const root = this.getWorkspaceRoot();
        if (!root) return;
        const dir = path.join(root, '.verno');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, 'jira-sync-state.json');
        fs.writeFileSync(filePath, JSON.stringify(epics, null, 2), 'utf-8');
    }

    public async syncEpics(
        epics: Epic[],
        credentials: JiraCredentials,
        projectKey: string,
        fieldMapping: JiraFieldMapping,
        issueTypes: string[],
        onUpdate: (itemId: string, status: SyncStatus) => void,
        dryRun: boolean = false
    ): Promise<Epic[]> {
        const api = new JiraApiService(credentials, this.logger);
        const supportsSubtask = issueTypes.some(t => t.toLowerCase().includes('sub-task') || t.toLowerCase().includes('subtask'));

        const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

        for (const epic of epics) {
            if (epic.syncStatus === 'pushed' || epic.jiraKey) {
                epic.syncStatus = 'skipped';
                onUpdate(epic.id, 'skipped');
                continue;
            }

            try {
                if (dryRun) {
                    await delay(100);
                    epic.jiraKey = `${projectKey}-EPIC-MOCK`;
                    epic.syncStatus = 'pushed';
                } else {
                    const res = await api.createIssue({
                        fields: {
                            project: { key: projectKey },
                            summary: epic.title,
                            description: epic.description ? `${epic.description}\n\n[Assigned Agent: ${epic.assignedAgent || 'Unassigned'}]` : `[Assigned Agent: ${epic.assignedAgent || 'Unassigned'}]`,
                            issuetype: { name: 'Epic' }
                        }
                    });
                    epic.jiraId = res.id;
                    epic.jiraKey = res.key;
                    epic.syncStatus = 'pushed';
                    this.saveState(epics);
                }
                onUpdate(epic.id, 'pushed');

                for (const story of epic.stories) {
                    if (story.syncStatus === 'pushed' || story.jiraKey) {
                        story.syncStatus = 'skipped';
                        onUpdate(story.id, 'skipped');
                        continue;
                    }

                    try {
                        if (dryRun) {
                            await delay(100);
                            story.jiraKey = `${projectKey}-STORY-MOCK`;
                            story.syncStatus = 'pushed';
                        } else {
                            const fields: any = {
                                project: { key: projectKey },
                                summary: story.title,
                                description: story.description ? `${story.description}\n\n[Assigned Agent: ${story.assignedAgent || 'Unassigned'}]` : `[Assigned Agent: ${story.assignedAgent || 'Unassigned'}]`,
                                issuetype: { name: 'Story' }
                            };
                            
                            // Link to epic
                            // Note: Jira Cloud typically uses parent.key for Epics now, or custom fields depending on setup.
                            // We use parent assuming standard Atlassian next-gen/team-managed format.
                            fields.parent = { key: epic.jiraKey };
                            
                            // Add story points
                            if (story.storyPoints !== undefined && fieldMapping.storyPointsFieldId) {
                                fields[fieldMapping.storyPointsFieldId] = story.storyPoints;
                            }

                            const sRes = await api.createIssue({ fields });
                            story.jiraId = sRes.id;
                            story.jiraKey = sRes.key;
                            story.syncStatus = 'pushed';
                            this.saveState(epics);
                        }
                        onUpdate(story.id, 'pushed');

                        for (const sub of story.subtasks) {
                            if (sub.syncStatus === 'pushed' || sub.jiraKey) {
                                sub.syncStatus = 'skipped';
                                onUpdate(sub.id, 'skipped');
                                continue;
                            }

                            try {
                                if (dryRun) {
                                    await delay(100);
                                    sub.jiraKey = `${projectKey}-SUB-MOCK`;
                                    sub.syncStatus = 'pushed';
                                } else {
                                    const subFields: any = {
                                        project: { key: projectKey },
                                        summary: sub.title + (sub.assignedAgent ? ` [Agent: ${sub.assignedAgent.toUpperCase()}]` : ''),
                                        parent: { key: story.jiraKey },
                                        issuetype: { name: supportsSubtask ? 'Subtask' : 'Story' } // Fallback to story if subtask not found. Some projects use 'Sub-task' but we checked earlier. Actually standard is 'Subtask' or 'Sub-task'.
                                    };
                                    
                                    // Make sure we use exact case for Sub-task if that was the match in issueTypes
                                    if (supportsSubtask) {
                                        const actualName = issueTypes.find(t => t.toLowerCase() === 'sub-task' || t.toLowerCase() === 'subtask') || 'Subtask';
                                        subFields.issuetype.name = actualName;
                                    }

                                    const sTRes = await api.createIssue({ fields: subFields });
                                    sub.jiraId = sTRes.id;
                                    sub.jiraKey = sTRes.key;
                                    sub.syncStatus = 'pushed';
                                    this.saveState(epics);
                                }
                                onUpdate(sub.id, 'pushed');
                            } catch (e: any) {
                                this.logger.error(`Failed to push subtask ${sub.title}: ${e.message}`, e);
                                sub.syncStatus = 'failed';
                                onUpdate(sub.id, 'failed');
                            }
                        }

                    } catch (e: any) {
                        this.logger.error(`Failed to push story ${story.title}: ${e.message}`, e);
                        story.syncStatus = 'failed';
                        onUpdate(story.id, 'failed');
                    }
                }

            } catch (epicErr: any) {
                this.logger.error(`Failed to push epic ${epic.title}: ${epicErr.message}`, epicErr);
                epic.syncStatus = 'failed';
                onUpdate(epic.id, 'failed');
            }
        }

        return epics;
    }
}
