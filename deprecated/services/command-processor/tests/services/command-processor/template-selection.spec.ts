import { chooseTemplate } from '../../../src/services/command-processor/templates';
import type { CommandTemplate } from '../../../src/services/command-processor/command-repo';

describe('templates.chooseTemplate', () => {
  const t = (id: string, text = id): CommandTemplate => ({ id, text });

  it('returns null when no templates', () => {
    expect(chooseTemplate([])).toBeNull();
  });

  it('selects from templates excluding lastUsed when possible', () => {
    const templates = [t('a'), t('b'), t('c')];
    // rng=0 selects first element of the filtered pool
    const res = chooseTemplate(templates, 'b', () => 0);
    expect(res).not.toBeNull();
    expect(['a', 'c']).toContain(res!.template.id);
    expect(res!.template.id).not.toBe('b');
  });

  it('falls back to including lastUsed when it is the only template', () => {
    const templates = [t('only')];
    const res = chooseTemplate(templates, 'only', () => 0);
    expect(res!.template.id).toBe('only');
  });
});
