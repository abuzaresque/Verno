/**
 * SecurityComplianceService — Phase 10 (SDLC Phase 8)
 *
 * Provides feature-aware OWASP Top 10 checklist generation and
 * article-level GDPR/HIPAA compliance flagging for PRD sections.
 *
 * IMPORTANT: This service extracts and enhances logic from DebateOrchestrator.ts.
 * The DebateOrchestrator must be updated to delegate to this service.
 */

import { PRDSection } from '../../types/sdlc';

// ─── OWASP Top 10 (2021) ────────────────────────────────────────────────────

export interface OwaspItem {
    id: string;       // e.g. "A01"
    title: string;    // e.g. "Broken Access Control"
    check: string;    // actionable check for this feature
}

const ALL_OWASP_ITEMS: OwaspItem[] = [
    { id: 'A01', title: 'Broken Access Control',
      check: 'Verify role-based permissions on every endpoint and UI action; deny by default' },
    { id: 'A02', title: 'Cryptographic Failures',
      check: 'Ensure secrets, tokens, and PII are encrypted at rest (AES-256) and in transit (TLS 1.3)' },
    { id: 'A03', title: 'Injection',
      check: 'Sanitize all user inputs (SQL, OS command, LDAP, XPath, SSRF); use parameterized queries' },
    { id: 'A04', title: 'Insecure Design',
      check: 'Apply threat modelling before implementing; verify business logic abuse scenarios are tested' },
    { id: 'A05', title: 'Security Misconfiguration',
      check: 'Disable debug endpoints in production; rotate default credentials; audit headers and CORS policy' },
    { id: 'A06', title: 'Vulnerable and Outdated Components',
      check: 'Run `npm audit`; pin dependency versions; configure Dependabot on the repo' },
    { id: 'A07', title: 'Identification & Authentication Failures',
      check: 'Enforce MFA where applicable; use secure session tokens (httpOnly, SameSite=Strict); rate-limit auth endpoints' },
    { id: 'A08', title: 'Software and Data Integrity Failures',
      check: 'Verify integrity of third-party scripts and CI artifacts; do not deserialize untrusted data' },
    { id: 'A09', title: 'Security Logging & Monitoring Failures',
      check: 'Log authentication events, privilege changes, and access failures with timestamps and actor IDs' },
    { id: 'A10', title: 'Server-Side Request Forgery',
      check: 'Validate and allowlist all server-side URL fetch destinations; reject internal IP ranges' },
];

// Feature keyword → OWASP priority mapping
const FEATURE_OWASP_MAP: Array<{ signals: string[]; owaspIds: string[] }> = [
    { signals: ['login', 'auth', 'password', 'session', 'token', 'jwt', 'oauth', 'sso', 'saml', 'sign in', 'sign up'],
      owaspIds: ['A07', 'A01', 'A02'] },
    { signals: ['upload', 'file', 'attachment', 'media', 'image', 'document'],
      owaspIds: ['A04', 'A03', 'A05'] },
    { signals: ['api', 'endpoint', 'rest', 'graphql', 'webhook', 'route'],
      owaspIds: ['A01', 'A03', 'A08'] },
    { signals: ['payment', 'billing', 'stripe', 'card', 'checkout', 'invoice', 'subscription'],
      owaspIds: ['A02', 'A01', 'A04'] },
    { signals: ['admin', 'role', 'permission', 'privilege', 'access control', 'rbac', 'acl'],
      owaspIds: ['A01', 'A07'] },
    { signals: ['log', 'audit', 'event', 'monitor', 'alert', 'notification'],
      owaspIds: ['A09'] },
    { signals: ['third-party', 'external', 'vendor', 'integration', 'sdk', 'library', 'npm', 'package'],
      owaspIds: ['A06', 'A08'] },
    { signals: ['fetch', 'http', 'request', 'proxy', 'redirect', 'url', 'crawler', 'scrape'],
      owaspIds: ['A10', 'A03'] },
];

const OWASP_BASELINE_IDS = ['A01', 'A02', 'A03', 'A05', 'A07', 'A09'];

// ─── Compliance Flag Types ───────────────────────────────────────────────────

export type ComplianceRegulation = 'GDPR' | 'HIPAA';
export type ComplianceSeverity = 'warn' | 'error';

export interface ComplianceFlag {
    regulation: ComplianceRegulation;
    article: string;      // e.g. "Article 6", "§164.312"
    severity: ComplianceSeverity;
    trigger: string;      // keyword that triggered the flag
    recommendation: string;
}

// Extended GDPR keyword map: keyword → article reference
const GDPR_KEYWORD_MAP: Record<string, string> = {
    // Basic personal identifiers → Art. 6 (lawful basis) + Art. 13 (transparency)
    'email': 'Articles 6, 13', 'name': 'Articles 6, 13', 'address': 'Articles 6, 13',
    'phone': 'Articles 6, 13', 'user data': 'Articles 6, 13', 'personal': 'Articles 6, 13',
    'profile': 'Articles 6, 13', 'ip address': 'Articles 6, 13',
    // Location → Art. 6 + Art. 22 (automated decisions)
    'location': 'Articles 6, 22', 'geolocation': 'Articles 6, 22',
    // Tracking/Analytics → Art. 6 + ePrivacy
    'analytics': 'Article 6 + ePrivacy Directive', 'tracking': 'Article 6 + ePrivacy Directive',
    'cookie': 'Article 6 + ePrivacy Directive',
    // Identity documents → Art. 9 (special category)
    'national id': 'Article 9', 'passport': 'Article 9', 'dob': 'Articles 9, 6',
    'date of birth': 'Articles 9, 6',
    // Biometrics → Art. 9 (special category, explicit consent required)
    'biometric': 'Article 9 (explicit consent required)',
    // Financial
    'financial': 'Articles 6, 32', 'credit': 'Articles 6, 32', 'bank': 'Articles 6, 32',
    // Special categories
    'race': 'Article 9', 'religion': 'Article 9', 'political': 'Article 9',
    'sexual orientation': 'Article 9',
    // Identity/Auth
    'identity': 'Articles 6, 13', 'consent': 'Article 7',
};

// Extended HIPAA keyword map: keyword → safeguard reference
const HIPAA_KEYWORD_MAP: Record<string, string> = {
    'health': '§164.312 Technical Safeguards', 'medical': '§164.312 Technical Safeguards',
    'diagnosis': '§164.312 Technical Safeguards', 'patient': '§164.308 Administrative Safeguards',
    'prescription': '§164.312 Technical Safeguards', 'clinical': '§164.312 Technical Safeguards',
    'symptom': '§164.312 Technical Safeguards', 'doctor': '§164.308 Administrative Safeguards',
    'hospital': '§164.308 Administrative Safeguards', 'lab result': '§164.312 Technical Safeguards',
    'ehr': '§164.312 Technical Safeguards', 'phi': '§164.312 Technical Safeguards',
    'treatment': '§164.312 Technical Safeguards',
    'protected health': '§164.312 Technical Safeguards',
    'medication': '§164.312 Technical Safeguards', 'dosage': '§164.312 Technical Safeguards',
    'allergy': '§164.312 Technical Safeguards', 'immunization': '§164.312 Technical Safeguards',
    'mental health': '§164.312 Technical Safeguards (heightened)',
    'substance abuse': '§164.312 Technical Safeguards (heightened)',
    'genomic': '§164.312 Technical Safeguards',
};

// ─── SecurityComplianceService ───────────────────────────────────────────────

export class SecurityComplianceService {

    /**
     * Returns the most relevant OWASP Top 10 items for a given feature description.
     * Falls back to the 6-item baseline if no signals are detected.
     */
    getOwaspItemsForFeature(featureText: any): OwaspItem[] {
        let extractedText = '';
        if (typeof featureText === 'string') {
            extractedText = featureText;
        } else if (featureText && typeof featureText === 'object') {
            extractedText = featureText.content || featureText.text || JSON.stringify(featureText);
        }

        if (typeof extractedText !== 'string' || !extractedText) {
            // Fallback to baseline if text is missing or invalid
            return ALL_OWASP_ITEMS.filter(item => OWASP_BASELINE_IDS.includes(item.id));
        }

        const lower = extractedText.toLowerCase();
        const matchedIds = new Set<string>();

        for (const mapping of FEATURE_OWASP_MAP) {
            if (mapping.signals.some(signal => lower.includes(signal))) {
                mapping.owaspIds.forEach(id => matchedIds.add(id));
            }
        }

        // Always include baseline
        OWASP_BASELINE_IDS.forEach(id => matchedIds.add(id));

        // Return in OWASP order (A01 → A10)
        return ALL_OWASP_ITEMS.filter(item => matchedIds.has(item.id));
    }

    /**
     * Formats OWASP items as a markdown checklist string.
     */
    formatOwaspChecklist(items: OwaspItem[]): string {
        return '\n\n**OWASP Top 10 (2021) — Applicable Checks:**\n' +
            items.map(item => `- [ ] **${item.id}: ${item.title}** — ${item.check}`).join('\n');
    }

    /**
     * Scans PRD sections for GDPR and HIPAA compliance signals.
     * Returns structured ComplianceFlag objects with regulation article references.
     */
    detectComplianceFlags(sections: PRDSection[]): PRDSection[] {
        return sections.map(section => {
            const flags = this.scanForFlags(section.content);
            const flagStrings = flags.map(f =>
                `⚠️ ${f.regulation} (${f.article}): "${f.trigger}" detected — ${f.recommendation}`
            );
            return {
                ...section,
                complianceFlags: [...(section.complianceFlags ?? []), ...flagStrings],
            };
        });
    }

    /**
     * Returns raw structured ComplianceFlag objects from arbitrary text.
     * Use this for programmatic processing (e.g., sidebar rendering).
     */
    scanForFlags(text: any): ComplianceFlag[] {
        if (!text) return [];

        let extractedText = '';
        if (typeof text === 'string') {
            extractedText = text;
        } else if (typeof text === 'object') {
            extractedText = text.content || text.text || JSON.stringify(text);
        }

        if (typeof extractedText !== 'string' || !extractedText) {
            return [];
        }

        const lower = extractedText.toLowerCase();
        const flags: ComplianceFlag[] = [];
        const seen = new Set<string>();

        for (const [keyword, article] of Object.entries(GDPR_KEYWORD_MAP)) {
            if (lower.includes(keyword) && !seen.has(`GDPR:${keyword}`)) {
                seen.add(`GDPR:${keyword}`);
                const isSpecialCategory = article.includes('Article 9');
                flags.push({
                    regulation: 'GDPR',
                    article,
                    severity: isSpecialCategory ? 'error' : 'warn',
                    trigger: keyword,
                    recommendation: isSpecialCategory
                        ? 'Special category data — explicit consent (Art. 7) mandatory; data minimization (Art. 5); DPA notification may be required'
                        : 'Add explicit consent mechanism, data retention policy (Art. 5), and right-to-erasure endpoint (Art. 17)',
                });
            }
        }

        for (const [keyword, safeguard] of Object.entries(HIPAA_KEYWORD_MAP)) {
            if (lower.includes(keyword) && !seen.has(`HIPAA:${keyword}`)) {
                seen.add(`HIPAA:${keyword}`);
                flags.push({
                    regulation: 'HIPAA',
                    article: safeguard,
                    severity: 'error',
                    trigger: keyword,
                    recommendation: 'Encrypt PHI at rest (AES-256) and in transit (TLS 1.3); enable audit logging; Business Associate Agreement required with all processors',
                });
            }
        }

        return flags;
    }

    /**
     * Injects feature-aware OWASP checklist into the Security section of PRD sections.
     * Replaces the generic baseline if already present.
     */
    injectOwaspChecklist(sections: PRDSection[]): PRDSection[] {
        return sections.map(section => {
            const titleText = (typeof section.title === 'string') ? section.title : '';
            if (titleText.toLowerCase().includes('security')) {
                const owaspItems = this.getOwaspItemsForFeature(section.content);
                const checklist = this.formatOwaspChecklist(owaspItems);
                
                let contentText = '';
                if (typeof section.content === 'string') {
                    contentText = section.content;
                } else if (section.content && typeof section.content === 'object') {
                    contentText = (section.content as any).content || (section.content as any).text || JSON.stringify(section.content);
                }

                const hasOwasp = contentText.toLowerCase().includes('owasp') ||
                                 contentText.toLowerCase().includes('a01:');
                
                // If it's an object, we want to attach the checklist securely to avoid blowing away the object struct.
                // However, since PRDSection.content is structurally expected to be a string, we stringify it.
                const newContent = hasOwasp ? section.content : contentText + checklist;
                
                return { ...section, content: newContent as any };
            }
            return section;
        });
    }

    /**
     * Full security pass: detect compliance flags + inject OWASP checklist.
     * This is the single method DebateOrchestrator should call.
     */
    applySecurityPass(sections: PRDSection[]): PRDSection[] {
        return this.injectOwaspChecklist(this.detectComplianceFlags(sections));
    }
}
