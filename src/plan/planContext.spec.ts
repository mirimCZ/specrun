import { describe, expect, it } from 'vitest';
import { planLaunchArgs, renderPlanContext } from './planContext.js';

const base = { spec: '001-x', dir: 'spec/001-x', specsDir: 'spec', featureMap: null };

describe('renderPlanContext', () => {
  it('says new for an empty folder and quotes the request', () => {
    const text = renderPlanContext({ ...base, files: [], request: 'Build it\n' });
    expect(text).toContain('- State: new');
    expect(text).toContain('<request>\nBuild it\n\n</request>');
    expect(text).toContain("Write the spec into exactly this folder; don't compute a new number.");
  });

  it('lists existing files and asks for the request when there is none', () => {
    const text = renderPlanContext({ ...base, files: ['README.md', 'tasks.yaml'], request: null });
    expect(text).toContain('- README.md\n- tasks.yaml');
    expect(text).toContain('No request file — ask the user for the request.');
    expect(text).not.toContain('<request>');
  });
});

describe('renderPlanContext feature map', () => {
  it('names the map README when given', () => {
    const text = renderPlanContext({
      ...base,
      files: [],
      request: null,
      featureMap: 'docs/features/README.md',
    });
    expect(text).toContain('- Feature map: docs/features/README.md');
    expect(text).not.toContain('No feature map');
  });

  it('says there is no map otherwise', () => {
    expect(renderPlanContext({ ...base, files: [], request: null })).toContain('No feature map');
  });
});

describe('planLaunchArgs', () => {
  it('builds new and resumed sessions', () => {
    expect(
      planLaunchArgs({ kind: 'new', spec: '001-x', sessionId: 'abc', contextFile: '/c.md' }).args,
    ).toEqual([
      '--session-id',
      'abc',
      '-n',
      'plan 001-x',
      '--append-system-prompt-file',
      '/c.md',
      '/specrun:plan 001-x',
    ]);
    expect(
      planLaunchArgs({ kind: 'resume', spec: '001-x', sessionId: 'abc', contextFile: '/c.md' })
        .args,
    ).toEqual([
      '--resume',
      'abc',
      '--append-system-prompt-file',
      '/c.md',
      'Continue planning 001-x.',
    ]);
  });
});
