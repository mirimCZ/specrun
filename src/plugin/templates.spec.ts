import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';
import { SpecSchema } from '../spec/specSchema.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PLUGIN_DIR = join(REPO_ROOT, 'plugin');
const SKILLS_DIR = join(PLUGIN_DIR, 'skills');

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Only the `key: value` lines of a SKILL.md frontmatter block. */
function frontmatter(markdown: string): Map<string, string> {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(markdown)?.[1] ?? '';
  const fields = new Map<string, string>();
  for (const line of block.split('\n')) {
    const match = /^([a-z-]+):\s*(.*)$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) fields.set(match[1], match[2].trim());
  }
  return fields;
}

describe('write-spec templates', () => {
  it('tasks.yaml parses with SpecSchema once its placeholders are filled in', () => {
    const template = readFileSync(join(SKILLS_DIR, 'write-spec/templates/tasks.yaml'), 'utf8');
    const filled = template.replaceAll('<PX>', 'EX').replaceAll(/<[^>]+>/g, 'Sample');

    const spec = SpecSchema.parse(parse(filled));

    expect(spec.tasks.map((task) => task.id)).toEqual(['EX-1', 'EX-2']);
    expect(spec.tasks[1]?.needs).toEqual(['EX-1']);
  });
});

describe('plugin skills', () => {
  const skills = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  it('ships refine, write-spec and plan', () => {
    expect(skills).toEqual(expect.arrayContaining(['refine', 'write-spec', 'plan']));
  });

  it.each(skills)('%s has a SKILL.md with name and description frontmatter', (skill) => {
    const fields = frontmatter(readFileSync(join(SKILLS_DIR, skill, 'SKILL.md'), 'utf8'));

    expect(fields.get('name')).toBe(skill);
    expect(fields.get('description')).toMatch(/\S/);
  });
});

describe('plugin manifests', () => {
  it('plugin.json carries the package version', () => {
    const { version } = z
      .object({ version: z.string() })
      .parse(readJson(join(REPO_ROOT, 'package.json')));
    const plugin = z
      .object({ name: z.string(), version: z.string() })
      .parse(readJson(join(PLUGIN_DIR, '.claude-plugin/plugin.json')));

    expect(plugin).toMatchObject({ name: 'specrun', version });
  });

  it('the marketplace lists the plugin folder', () => {
    const marketplace = z
      .object({
        name: z.string(),
        plugins: z.array(z.object({ name: z.string(), source: z.string() })),
      })
      .parse(readJson(join(REPO_ROOT, '.claude-plugin/marketplace.json')));

    expect(marketplace.name).toBe('specrun');
    expect(marketplace.plugins).toEqual([
      expect.objectContaining({ name: 'specrun', source: './plugin' }),
    ]);
  });
});
