import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from '../config/configSchema.js';
import { nodeIdOf, OPTIONAL_SECTIONS, REQUIRED_SECTIONS } from './featureSchema.js';
import { FEATURE_MAP_FILE, type FeatureMap, type Problem } from './loadFeatureMap.js';

/** The `features` of one task of an active spec. */
export interface SpecTaskFeatures {
  spec: string;
  task: string;
  features: string[];
}

export interface CheckFeatureMapInput {
  repoRoot: string;
  config: Config;
  specTaskFeatures: SpecTaskFeatures[];
  /** Names of active and archived specs (for the `specs` warning). */
  knownSpecs: string[];
}

const MIN_CAPABILITIES = 3;

/** FMD-6: errors and warnings of a loaded feature map; pure, the caller reads the repo's specs. */
export function checkFeatureMap(map: FeatureMap, input: CheckFeatureMapInput): Problem[] {
  const { repoRoot, config, specTaskFeatures, knownSpecs } = input;
  const featuresDir = config.featuresDir.replace(/\\/g, '/').replace(/\/+$/, '');
  const problems: Problem[] = [...map.problems];
  const error = (path: string, message: string): void =>
    void problems.push({ path, message, level: 'error' });
  const warning = (path: string, message: string): void =>
    void problems.push({ path, message, level: 'warning' });

  const ids = new Set(map.docs.map((doc) => doc.idFromPath));

  const readmePath = map.readme?.path ?? `${featuresDir}/${FEATURE_MAP_FILE}`;
  if (map.readme === null) {
    error(readmePath, 'feature map README is missing');
  } else {
    if (map.readme.mermaidBlocks !== 1) {
      error(
        readmePath,
        `expected exactly one mermaid block, found ${String(map.readme.mermaidBlocks)}`,
      );
    }
    const rowIds = new Set(map.readme.rows.map((row) => row.id));
    for (const row of map.readme.rows) {
      if (!ids.has(row.id)) error(readmePath, `index row "${row.id}" has no feature doc`);
    }
    for (const doc of map.docs) {
      if (!rowIds.has(doc.idFromPath)) {
        error(doc.path, `feature "${doc.idFromPath}" has no row in the index`);
      }
    }
    const nodes = new Set(map.readme.nodes);
    const featureNodes = new Map<string, string>();
    for (const doc of map.docs) {
      const node = nodeIdOf(doc.idFromPath);
      const other = featureNodes.get(node);
      if (other !== undefined) {
        error(doc.path, `node id "${node}" collides with feature "${other}"`);
      } else featureNodes.set(node, doc.idFromPath);
      if (!nodes.has(node)) error(doc.path, `feature has no node "${node}" in the mermaid graph`);
    }
    for (const node of map.readme.nodes) {
      if (!featureNodes.has(node)) error(readmePath, `mermaid node "${node}" has no feature doc`);
    }
  }

  for (const doc of map.docs) {
    const fm = doc.frontmatter;
    if (fm !== null) {
      if (fm.id !== doc.idFromPath) {
        error(doc.path, `frontmatter id "${fm.id}" does not match the path "${doc.idFromPath}"`);
      }
      for (const dep of fm.depends_on) {
        if (!ids.has(dep)) error(doc.path, `depends_on: unknown feature "${dep}"`);
      }
      for (const [key, paths] of [
        ['code', fm.code],
        ['tests', fm.tests],
      ] as const) {
        for (const path of paths) {
          if (!existsSync(join(repoRoot, path)))
            error(doc.path, `${key}: "${path}" does not exist`);
        }
      }
      for (const spec of fm.specs) {
        if (!knownSpecs.includes(spec)) {
          warning(doc.path, `specs: "${spec}" not found under ${config.specsDir}/ or its archive`);
        }
      }
    }
    for (const section of REQUIRED_SECTIONS) {
      if (!doc.sections.includes(section)) error(doc.path, `missing section "## ${section}"`);
    }
    const order: readonly string[] = [...REQUIRED_SECTIONS, ...OPTIONAL_SECTIONS];
    const known = doc.sections.filter((s) => order.includes(s));
    const sorted = [...known].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    if (known.some((s, i) => s !== sorted[i])) {
      error(doc.path, `sections out of order, expected: ${order.map((s) => `## ${s}`).join(', ')}`);
    }
    // No upper bound: a cap made agents merge bullets instead of splitting features.
    if (doc.capabilities < MIN_CAPABILITIES) {
      warning(
        doc.path,
        `${String(doc.capabilities)} capabilities, expected at least ${String(MIN_CAPABILITIES)}`,
      );
    }
  }

  for (const { spec, task, features } of specTaskFeatures) {
    for (const feature of features) {
      if (!ids.has(feature)) {
        error(
          `${config.specsDir}/${spec}/tasks.yaml`,
          `task ${task}: unknown feature "${feature}"`,
        );
      }
    }
  }
  return problems;
}
