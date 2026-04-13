/**
 * Configuration service for extension settings and secure API key storage.
 * API keys are stored in VSCode SecretStorage (encrypted OS keychain) — never in plaintext settings.
 */

import * as vscode from 'vscode';
import { IConfigService } from '../types';

export type ProviderName = 'gemini' | 'groq' | 'anthropic' | 'openai';

const SECRET_KEY_PREFIX = 'verno.apikey.';

export class ConfigService implements IConfigService {
  private readonly configKey = 'verno';
  private secrets: vscode.SecretStorage | null = null;

  /**
   * Wire in the extension context's SecretStorage.
   * Must be called during activation before any getApiKey/storeApiKey calls.
   */
  setSecretStorage(secrets: vscode.SecretStorage): void {
    this.secrets = secrets;
  }

  // ─── API Key (SecretStorage) ─────────────────────────────────────────────

  /**
   * Retrieve a stored API key from SecretStorage.
   * Returns undefined if no key has been stored yet.
   */
  async getApiKey(provider: ProviderName): Promise<string | undefined> {
    if (!this.secrets) { return undefined; }
    return this.secrets.get(`${SECRET_KEY_PREFIX}${provider}`);
  }

  /**
   * Persist an API key to SecretStorage (encrypted OS keychain).
   */
  async storeApiKey(provider: ProviderName, key: string): Promise<void> {
    if (!this.secrets) {
      throw new Error('SecretStorage not initialized. Call setSecretStorage() first.');
    }
    await this.secrets.store(`${SECRET_KEY_PREFIX}${provider}`, key);
  }

  /**
   * Remove a stored API key from SecretStorage.
   */
  async deleteApiKey(provider: ProviderName): Promise<void> {
    if (!this.secrets) { return; }
    await this.secrets.delete(`${SECRET_KEY_PREFIX}${provider}`);
  }

  /**
   * Detect which provider a key belongs to based on its prefix.
   */
  detectProvider(apiKey: string): ProviderName {
    if (apiKey.startsWith('AIza')) { return 'gemini'; }
    if (apiKey.startsWith('sk-ant')) { return 'anthropic'; }
    if (apiKey.startsWith('sk-')) { return 'openai'; }
    return 'groq'; // Groq keys are opaque — default fallback
  }

  // ─── Settings ────────────────────────────────────────────────────────────

  get<T>(key: string): T | undefined {
    const config = vscode.workspace.getConfiguration(this.configKey);
    return config.get<T>(key);
  }

  async set<T>(key: string, value: T): Promise<void> {
    const config = vscode.workspace.getConfiguration(this.configKey);
    await config.update(key, value, vscode.ConfigurationTarget.Global);
  }

  getAll(): Record<string, unknown> {
    const config = vscode.workspace.getConfiguration(this.configKey);
    return config;
  }
}
