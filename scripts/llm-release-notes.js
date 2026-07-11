#!/usr/bin/env node
/**
 * llm-release-notes.js
 *
 * Generates intelligent, categorized release notes using OpenAI API (GPT-4o-mini).
 *
 * Features:
 * - Parses git commits between versions
 * - Generates "Highlights" summary
 * - Categorizes changes (Features, Fixes, Breaking Changes)
 * - Combines with CHANGELOG.md content if available
 * - Graceful fallback on API failure
 *
 * Usage:
 *   node scripts/llm-release-notes.js <new-version> <old-version> [changelog-content]
 *
 * Environment:
 *   OPENAI_API_KEY - Required for LLM enhancement
 *
 * Exit codes:
 *   0 - Success (outputs markdown to stdout)
 *   1 - Error (API failure, missing version, etc.)
 *
 * Sprint: 337-abb8c02
 * Task: BL-337-200
 */

const { execSync } = require('child_process');
const OpenAI = require('openai');

// Configuration
const MODEL = 'gpt-4o-mini';
const MAX_TOKENS = 1000;
const TEMPERATURE = 0.7;

/**
 * Parse git log between two versions/commits
 */
function getGitLog(oldVersion, newVersion) {
  try {
    // Get commits between old and new version
    const oldRef = oldVersion.startsWith('v') ? oldVersion : `v${oldVersion}`;
    const newRef = newVersion.startsWith('v') ? newVersion : `v${newVersion}`;

    // Try with tags first, fallback to commit refs
    let command = `git log ${oldRef}..${newRef} --pretty=format:"%h|%s|%b" --no-merges`;

    try {
      return execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (err) {
      // Fallback: use HEAD if refs don't exist
      command = `git log HEAD~10..HEAD --pretty=format:"%h|%s|%b" --no-merges`;
      return execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    }
  } catch (error) {
    console.error('Error fetching git log:', error.message);
    return '';
  }
}

/**
 * Parse commits into structured data
 */
function parseCommits(gitLog) {
  if (!gitLog || gitLog.trim() === '') {
    return [];
  }

  const commits = gitLog.trim().split('\n').filter(line => line.trim());

  return commits.map(line => {
    const parts = line.split('|');
    const hash = parts[0] || '';
    const subject = parts[1] || '';
    const body = parts[2] || '';

    // Detect conventional commit type
    let type = 'other';
    let scope = '';
    let breaking = false;

    // Only attempt to match if subject exists
    if (subject && subject.trim()) {
      const conventionalMatch = subject.match(/^(feat|fix|docs|style|refactor|perf|test|chore|build|ci)(\(([^)]+)\))?(!)?:/);

      if (conventionalMatch) {
        type = conventionalMatch[1];
        scope = conventionalMatch[3] || '';
        breaking = !!conventionalMatch[4] || (body && body.includes('BREAKING CHANGE'));
      } else if (subject.toLowerCase().includes('break')) {
        breaking = true;
      }
    }

    return {
      hash: hash.trim(),
      subject: subject.trim(),
      body: body.trim(),
      type,
      scope,
      breaking
    };
  });
}

/**
 * Generate release notes using OpenAI
 */
async function generateReleaseNotes(commits, version, changelogContent = '') {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }

  const openai = new OpenAI({ apiKey });

  // Build commit summary for LLM
  const commitSummary = commits.length > 0
    ? commits.map(c => `- [${c.type}${c.scope ? `(${c.scope})` : ''}${c.breaking ? '!' : ''}] ${c.subject}`).join('\n')
    : 'No commits found';

  // Construct prompt
  const prompt = `You are generating release notes for version ${version} of the BitBrat Platform, an event-driven LLM orchestration engine.

${changelogContent ? `CHANGELOG Content:\n${changelogContent}\n\n` : ''}Git Commits:
${commitSummary}

Generate professional GitHub release notes in this EXACT format:

## Highlights
[Write 2-3 sentences summarizing the most important changes in this release. Be concise and engaging.]

## What's New

### Features
${commits.filter(c => c.type === 'feat' || c.type === 'feature').length > 0
  ? '[List new features, one per line with "-" prefix]'
  : '- None'}

### Fixes
${commits.filter(c => c.type === 'fix').length > 0
  ? '[List bug fixes, one per line with "-" prefix]'
  : '- None'}

${commits.some(c => c.breaking) ? `### Breaking Changes
[List breaking changes, one per line with "-" prefix and clear impact description]` : ''}

Rules:
- Be concise and technical
- Focus on user-facing changes
- Use past tense ("Added", "Fixed", "Improved")
- No emojis unless they appear in the original commits
- Skip empty sections
- Combine similar items
- Use markdown formatting appropriately`;

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
    });

    return completion.choices[0].message.content.trim();
  } catch (error) {
    console.error('OpenAI API Error:', error.message);
    throw error;
  }
}

/**
 * Main execution
 */
async function main() {
  const fs = require('fs');
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: node llm-release-notes.js <new-version> <old-version> [changelog-content-or-file]');
    process.exit(1);
  }

  const newVersion = args[0];
  const oldVersion = args[1];
  let changelogContent = args[2] || '';

  // If arg[2] looks like a file path, try to read it
  if (changelogContent && fs.existsSync(changelogContent)) {
    try {
      changelogContent = fs.readFileSync(changelogContent, 'utf8');
    } catch (error) {
      console.error(`Warning: Could not read file ${changelogContent}:`, error.message);
      changelogContent = '';
    }
  }

  try {
    // Get git log
    const gitLog = getGitLog(oldVersion, newVersion);
    const commits = parseCommits(gitLog);

    if (commits.length === 0 && !changelogContent) {
      console.error('No commits found and no CHANGELOG content provided');
      process.exit(1);
    }

    // Generate release notes using LLM
    const releaseNotes = await generateReleaseNotes(commits, newVersion, changelogContent);

    console.log(releaseNotes);
    process.exit(0);
  } catch (error) {
    console.error('Failed to generate release notes:', error.message);

    // Fallback: output basic format if we have CHANGELOG
    if (changelogContent) {
      console.log(`## Release ${newVersion}\n\n${changelogContent}`);
      process.exit(0);
    }

    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { getGitLog, parseCommits, generateReleaseNotes };
