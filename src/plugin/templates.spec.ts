import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';
import { ConfigSchema } from '../config/configSchema.js';
import { checkFeatureMap } from '../features/checkFeatureMap.js';
import { loadFeatureMap } from '../features/loadFeatureMap.js';
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

describe('feature-map task template', () => {
  const read = (file: string): string =>
    readFileSync(join(SKILLS_DIR, 'write-spec/templates', file), 'utf8');

  it('names the check and needs: all, with the header line of task.md', () => {
    const template = read('feature-map-task.md');
    expect(template).toContain('specrun features check');
    expect(template).toContain('needs: all');
    const format = /^Phase \d+ · Needs: .+ · Implements: .+$/m;
    expect(read('task.md')).toMatch(format);
    expect(template).toMatch(format);
  });
});

describe('feature-map templates', () => {
  it('filled in, they form a valid map', () => {
    const repo = mkdtempSync(join(tmpdir(), 'specrun-'));
    try {
      const config = ConfigSchema.parse({ verify: [{ name: 't', command: 'true' }] });
      mkdirSync(join(repo, 'src'));
      writeFileSync(join(repo, 'src/sample.ts'), '');
      writeFileSync(join(repo, 'src/sample.spec.ts'), '');
      const fill = (file: string): string =>
        readFileSync(join(SKILLS_DIR, 'feature-map/templates', file), 'utf8')
          .replaceAll('<path/to/code>', 'src/sample.ts')
          .replaceAll('<path/to/test>', 'src/sample.spec.ts')
          .replaceAll('<area>', 'example')
          .replaceAll('<name>', 'sample')
          .replaceAll(/<[^>\n]+>/g, 'Sample');
      mkdirSync(join(repo, 'docs/features/example'), { recursive: true });
      writeFileSync(join(repo, 'docs/features/README.md'), fill('README.md'));
      writeFileSync(join(repo, 'docs/features/example/sample.md'), fill('feature.md'));

      const map = loadFeatureMap(repo, config);
      expect(map).not.toBeNull();
      if (map === null) return;
      const problems = checkFeatureMap(map, {
        repoRoot: repo,
        config,
        specTaskFeatures: [],
        knownSpecs: [],
      });

      expect(problems).toEqual([]);
      expect(map.docs.map((doc) => doc.idFromPath)).toEqual(['example/sample']);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('plugin skills', () => {
  const skills = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  it('ships refine, write-spec, plan and feature-map', () => {
    expect(skills).toEqual(expect.arrayContaining(['refine', 'write-spec', 'plan', 'feature-map']));
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
