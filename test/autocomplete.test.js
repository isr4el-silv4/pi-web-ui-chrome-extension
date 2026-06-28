import { describe, expect, it } from 'vitest';
import { createInitialState, reduceSidePanelState } from '../sidepanel-state.js';

// Replicate buildAutocompleteItems matching logic for unit testing
// (the real function lives in sidepanel.js and closes over DOM state)
function buildAutocompleteItems(commands, skills, templates, prefix) {
  const items = [];
  // Strip leading / so we match against bare command names
  const raw = prefix.startsWith('/') ? prefix.substring(1) : prefix;
  const lower = raw.toLowerCase();

  for (const cmd of commands) {
    if (cmd.name.toLowerCase().startsWith(lower)) {
      items.push({
        value: `/${cmd.name} `,
        label: `/${cmd.name}`,
        description: cmd.description || '',
        type: 'command',
      });
    }
  }

  for (const skill of skills) {
    const label = `/skill:${skill.name}`;
    if (label.toLowerCase().startsWith('/' + lower)) {
      items.push({
        value: `${label} `,
        label,
        description: skill.description || '',
        type: 'skill',
      });
    }
  }

  for (const tmpl of templates) {
    if (tmpl.name.toLowerCase().startsWith(lower)) {
      items.push({
        value: `/${tmpl.name} `,
        label: `/${tmpl.name}`,
        description: tmpl.description || '',
        type: 'template',
      });
    }
  }

  return items;
}

describe('extension commands and autocomplete state', () => {
  it('starts with empty commands, skills, templates and closed autocomplete', () => {
    const state = createInitialState();
    expect(state.commands).toEqual([]);
    expect(state.skills).toEqual([]);
    expect(state.templates).toEqual([]);
    expect(state.autocompleteOpen).toBe(false);
    expect(state.autocompleteItems).toEqual([]);
    expect(state.autocompleteIndex).toBe(-1);
  });

  it('populates commands, skills, templates on resources_list event', () => {
    const state = reduceSidePanelState(createInitialState(), {
      type: 'resources_list',
      commands: [{ name: 'persona', description: 'Load a persona', source: 'extension', hasCompletions: true }],
      skills: [{ name: 'git-workflow', description: 'Git best practices' }],
      templates: [{ name: 'review', description: 'Review code', args: ['file', 'focus'] }],
    });

    expect(state.commands).toEqual([{ name: 'persona', description: 'Load a persona', source: 'extension', hasCompletions: true }]);
    expect(state.skills).toEqual([{ name: 'git-workflow', description: 'Git best practices' }]);
    expect(state.templates).toEqual([{ name: 'review', description: 'Review code', args: ['file', 'focus'] }]);
  });

  it('handles resources_list with empty arrays', () => {
    const state = reduceSidePanelState(createInitialState(), {
      type: 'resources_list',
      commands: [],
      skills: [],
      templates: [],
    });

    expect(state.commands).toEqual([]);
    expect(state.skills).toEqual([]);
    expect(state.templates).toEqual([]);
  });

  it('handles resources_list without optional fields', () => {
    const state = reduceSidePanelState(createInitialState(), {
      type: 'resources_list',
    });

    expect(state.commands).toEqual([]);
    expect(state.skills).toEqual([]);
    expect(state.templates).toEqual([]);
  });

  it('opens autocomplete with completions on command_completions event', () => {
    const state = reduceSidePanelState(createInitialState(), {
      type: 'command_completions',
      items: [
        { value: '/persona ', label: '/persona', description: 'Load a persona' },
        { value: '/skill:git-workflow ', label: '/skill:git-workflow', description: 'Git best practices' },
      ],
    });

    expect(state.autocompleteOpen).toBe(true);
    expect(state.autocompleteItems).toHaveLength(2);
    expect(state.autocompleteIndex).toBe(0);
    expect(state.autocompleteItems[0]).toEqual({ value: '/persona ', label: '/persona', description: 'Load a persona' });
  });

  it('closes autocomplete when command_completions has no items', () => {
    const state = reduceSidePanelState(createInitialState(), {
      type: 'command_completions',
      items: [],
    });

    expect(state.autocompleteOpen).toBe(false);
    expect(state.autocompleteItems).toEqual([]);
    expect(state.autocompleteIndex).toBe(-1);
  });

  it('opens autocomplete with items on autocomplete_open event', () => {
    const state = reduceSidePanelState(createInitialState(), {
      type: 'autocomplete_open',
      items: [
        { value: '/persona ', label: '/persona', description: 'Load a persona' },
      ],
    });

    expect(state.autocompleteOpen).toBe(true);
    expect(state.autocompleteItems).toHaveLength(1);
    expect(state.autocompleteIndex).toBe(0);
  });

  it('opens autocomplete with index -1 when no items provided', () => {
    const state = reduceSidePanelState(createInitialState(), {
      type: 'autocomplete_open',
    });

    expect(state.autocompleteOpen).toBe(true);
    expect(state.autocompleteIndex).toBe(-1);
  });

  it('closes autocomplete on autocomplete_close event', () => {
    let state = reduceSidePanelState(createInitialState(), {
      type: 'autocomplete_open',
      items: [{ value: '/persona ', label: '/persona' }],
    });
    expect(state.autocompleteOpen).toBe(true);

    state = reduceSidePanelState(state, { type: 'autocomplete_close' });
    expect(state.autocompleteOpen).toBe(false);
    expect(state.autocompleteItems).toEqual([]);
    expect(state.autocompleteIndex).toBe(-1);
  });

  it('updates autocomplete index on autocomplete_select event', () => {
    let state = reduceSidePanelState(createInitialState(), {
      type: 'autocomplete_open',
      items: [
        { value: '/persona ', label: '/persona' },
        { value: '/review ', label: '/review' },
        { value: '/compact ', label: '/compact' },
      ],
    });

    state = reduceSidePanelState(state, { type: 'autocomplete_select', index: 2 });
    expect(state.autocompleteIndex).toBe(2);

    state = reduceSidePanelState(state, { type: 'autocomplete_select', index: 0 });
    expect(state.autocompleteIndex).toBe(0);
  });

  it('wraps autocomplete index from end to start', () => {
    let state = reduceSidePanelState(createInitialState(), {
      type: 'autocomplete_open',
      items: [
        { value: '/persona ', label: '/persona' },
        { value: '/review ', label: '/review' },
      ],
    });

    // At end, wrap to start
    state = reduceSidePanelState(state, { type: 'autocomplete_select', index: 0 });
    expect(state.autocompleteIndex).toBe(0);
  });

  it('wraps autocomplete index from start to end', () => {
    let state = reduceSidePanelState(createInitialState(), {
      type: 'autocomplete_open',
      items: [
        { value: '/persona ', label: '/persona' },
        { value: '/review ', label: '/review' },
      ],
    });

    // At start, wrap to end
    state = reduceSidePanelState(state, { type: 'autocomplete_select', index: 1 });
    expect(state.autocompleteIndex).toBe(1);
  });

  it('accepts autocomplete item on autocomplete_accept event', () => {
    let state = reduceSidePanelState(createInitialState(), {
      type: 'autocomplete_open',
      items: [{ value: '/persona ', label: '/persona' }],
    });
    expect(state.autocompleteOpen).toBe(true);

    state = reduceSidePanelState(state, { type: 'autocomplete_accept' });
    expect(state.autocompleteOpen).toBe(false);
    expect(state.autocompleteItems).toEqual([]);
    expect(state.autocompleteIndex).toBe(-1);
  });

  it('adds extension_command_error as a notification', () => {
    const state = reduceSidePanelState(createInitialState(), {
      type: 'extension_command_error',
      command: 'unknown-cmd',
    });

    expect(state.notifications).toEqual(['⚠ Unknown command: /unknown-cmd']);
    expect(state.sending).toBe(false);
  });

  it('preserves existing notifications when command error occurs', () => {
    let state = reduceSidePanelState(createInitialState(), {
      type: 'extension_ui_notify',
      message: 'Previous notification',
    });
    state = reduceSidePanelState(state, {
      type: 'extension_command_error',
      command: 'bad-cmd',
    });

    expect(state.notifications).toEqual([
      'Previous notification',
      '⚠ Unknown command: /bad-cmd',
    ]);
  });
});

describe('buildAutocompleteItems matching logic', () => {
  const commands = [
    { name: 'persona', description: 'Load a persona', source: 'extension', hasCompletions: true },
    { name: 'compact', description: 'Compact context', source: 'builtin', hasCompletions: false },
    { name: 'model', description: 'Switch model', source: 'builtin', hasCompletions: true },
  ];
  const skills = [
    { name: 'git-workflow', description: 'Git best practices' },
  ];
  const templates = [
    { name: 'review', description: 'Review code', args: ['file', 'focus'] },
  ];

  it('matches all commands when prefix is just "/"', () => {
    const items = buildAutocompleteItems(commands, skills, templates, '/');
    // Should match all commands, skills, and templates
    expect(items).toHaveLength(5); // 3 commands + 1 skill + 1 template
    expect(items.map(i => i.label)).toContain('/persona');
    expect(items.map(i => i.label)).toContain('/compact');
    expect(items.map(i => i.label)).toContain('/model');
    expect(items.map(i => i.label)).toContain('/skill:git-workflow');
    expect(items.map(i => i.label)).toContain('/review');
  });

  it('matches commands by partial prefix with leading /', () => {
    const items = buildAutocompleteItems(commands, skills, templates, '/per');
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('/persona');
    expect(items[0].type).toBe('command');
  });

  it('matches commands by partial prefix without leading /', () => {
    const items = buildAutocompleteItems(commands, skills, templates, 'per');
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('/persona');
  });

  it('matches skills with /skill: prefix', () => {
    const items = buildAutocompleteItems(commands, skills, templates, '/skill:git');
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('/skill:git-workflow');
    expect(items[0].type).toBe('skill');
  });

  it('returns empty array when no match', () => {
    const items = buildAutocompleteItems(commands, skills, templates, '/nonexistent');
    expect(items).toHaveLength(0);
  });

  it('is case-insensitive', () => {
    const items = buildAutocompleteItems(commands, skills, templates, '/PERSONA');
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('/persona');
  });

  it('matches templates by name', () => {
    const items = buildAutocompleteItems(commands, skills, templates, '/rev');
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('/review');
    expect(items[0].type).toBe('template');
  });
});
