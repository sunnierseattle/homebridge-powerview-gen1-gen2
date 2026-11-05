import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type FormItem = string | { key?: string; items?: FormItem[] };

const schema = JSON.parse(readFileSync(new URL('../config.schema.json', import.meta.url), 'utf8')) as {
  schema: { properties: Record<string, unknown> };
  form?: FormItem[];
};

/** Top-level setting keys the form layout places, in order, including duplicates. */
function placedKeys(items: FormItem[]): string[] {
  return items.flatMap((item) => {
    if (typeof item === 'string') {
      return [item.split('.')[0]];
    }
    if (item.key) {
      return [item.key.split('.')[0]];
    }
    return placedKeys(item.items ?? []);
  });
}

/** Keys exactly as the layout writes them, e.g. `quietHours.start`. */
function rawKeys(items: FormItem[]): string[] {
  return items.flatMap((item) => {
    if (typeof item === 'string') {
      return [item];
    }
    return item.key ? [item.key] : rawKeys(item.items ?? []);
  });
}

describe('config.schema.json form layout', () => {
  it('has a form layout', () => {
    expect(Array.isArray(schema.form)).toBe(true);
  });

  // A setting left out of the layout is not rendered at all, so it would
  // silently vanish from the settings page.
  it('places every setting exactly once', () => {
    const placed = new Set(placedKeys(schema.form ?? []));
    expect([...placed].sort()).toEqual(Object.keys(schema.schema.properties).sort());
    const raw = rawKeys(schema.form ?? []);
    expect(raw.length).toBe(new Set(raw).size);
  });

  // Inside a fieldset, a bare object key renders nothing: its sub-fields have
  // to be named one by one or they vanish (quietHours lost both sliders).
  it('names each sub-field of an object setting', () => {
    const named = new Set(rawKeys(schema.form ?? []));
    const props = schema.schema.properties as Record<string, { type?: string; properties?: Record<string, unknown> }>;
    for (const [key, prop] of Object.entries(props)) {
      if (prop.type !== 'object') {
        continue;
      }
      expect(named.has(key)).toBe(false);
      for (const sub of Object.keys(prop.properties ?? {})) {
        expect(named.has(`${key}.${sub}`)).toBe(true);
      }
    }
  });

  // The form clears a field when a condition hides it, so a value someone set
  // was lost when they turned off the setting it depends on and saved (seen on
  // Homebridge UI, 2026-11-05). Settings always show instead.
  it('never hides a setting behind a condition', () => {
    const conditional = (items: FormItem[]): string[] =>
      items.flatMap((i) => {
        if (typeof i === 'string') {
          return [];
        }
        const node = i as { key?: string; title?: string; condition?: unknown; items?: FormItem[] };
        return [...(node.condition ? [node.key ?? node.title ?? '(container)'] : []), ...conditional(node.items ?? [])];
      });
    const props = schema.schema.properties as Record<string, { condition?: unknown }>;
    const inSchema = Object.entries(props).filter(([, p]) => p.condition).map(([k]) => k);
    // Two exceptions, each refilled by the Shade tools page when shown again:
    // the quiet hours row, and the battery refresh time with its note.
    expect([...inSchema, ...conditional(schema.form ?? [])]).toEqual(['(container)', '(container)', '(container)']);
  });

  // Times read as "2 PM" everywhere, like the quiet hours, and the box is half
  // width like From. Each choice saves the "HH:MM" text the plugin reads.
  it('picks the battery refresh time from a 12-hour dropdown at half width', () => {
    const battery = (schema.form ?? []).find(
      (i) => typeof i !== 'string' && (i as { title?: string }).title === 'Battery',
    ) as { items?: FormItem[] } | undefined;
    type Pick = { key?: string; type?: string; flex?: string; titleMap?: { value: string; name: string }[] };
    const row = (battery?.items ?? []).find((i) => typeof i !== 'string'
      && (i as { items?: Pick[] }).items?.some((x) => x.key === 'batteryPollAt')) as { type?: string; items?: Pick[] } | undefined;
    expect(row?.type).toBe('flex');
    const pick = row?.items?.[0];
    expect(pick).toMatchObject({ key: 'batteryPollAt', type: 'select', flex: '0 1 50%' });
    expect(pick?.titleMap?.map((o) => o.value)).toEqual([...Array(24).keys()].map((h) => `${String(h).padStart(2, '0')}:00`));
    const name = (v: string) => pick?.titleMap?.find((o) => o.value === v)?.name;
    expect([name('00:00'), name('09:00'), name('12:00'), name('14:00')]).toEqual(['12 AM', '9 AM', '12 PM', '2 PM']);
    // Required, or the UI adds a "None" choice.
    expect((schema.schema as { required?: string[] }).required).toContain('batteryPollAt');
    const prop = schema.schema.properties.batteryPollAt as { default?: string; placeholder?: string; description?: string };
    expect(prop.default).toBe('14:00');
    expect(prop.placeholder).toBeUndefined();
    expect(prop.description ?? '').not.toMatch(/HH:MM/);
  });

  // Name and host are short, so they share the first row, outside the sections.
  // The UI draws a field's description inside its box, so a half-width field
  // got half-width text. Each one's text moves to a full-width note under its
  // row instead, copied word for word from the setting's description.
  it('puts the description of a half-width field full width under its row', () => {
    type Node = { type?: string; key?: string; flex?: string; description?: string; helpvalue?: string; items?: Node[] };
    const props = schema.schema.properties as Record<string, { description?: string }>;
    const checked: string[] = [];
    const walk = (items: Node[]) => {
      items.forEach((node, i) => {
        if (typeof node === 'string') {
          return;
        }
        if (node.type === 'flex') {
          for (const field of node.items ?? []) {
            const text = field.key ? props[field.key]?.description : undefined;
            if (field.flex && field.flex !== '1 1 0' || field.key === 'host') {
              if (!text) {
                continue;
              }
              expect(field.description).toBe('');
              const note = items[i + 1];
              expect(note?.type).toBe('help');
              expect(note?.helpvalue).toBe(`<p class="grey-text help-block small">${text}</p>`);
              checked.push(field.key ?? '');
            }
          }
        }
        walk(node.items ?? []);
      });
    };
    walk((schema.form ?? []) as Node[]);
    expect(checked.sort()).toEqual([
      'batteryPollAt', 'healSweepIntervalMinutes', 'host', 'requestIntervalMs', 'sceneNamePrefix', 'setPositionDebounceMs', 'stopCommand',
    ]);
  });

  // The refresh time only matters while the daily refresh is on.
  it('shows the battery refresh time only while the refresh is on', () => {
    type Node = { type?: string; title?: string; description?: string; helpvalue?: string; items?: Node[]; condition?: { functionBody: string } };
    const battery = (schema.form ?? []).find((i) => typeof i !== 'string' && (i as Node).title === 'Battery') as Node;
    expect(battery.description).toBeUndefined();
    const hidden = (battery.items ?? []).filter((i) => typeof i !== 'string' && i.condition);
    expect(hidden.map((i) => i.type)).toEqual(['flex', 'help']);
    for (const item of hidden) {
      const show = new Function('model', item.condition?.functionBody ?? '') as (m: unknown) => boolean;
      expect(show({})).toBe(false);
      expect(show({ batteryPolling: true })).toBe(true);
    }
  });

  it('keeps name and host side by side outside the collapsible sections', () => {
    const first = schema.form?.[0] as { type?: string; items?: { key?: string; flex?: string }[] };
    expect(first.type).toBe('flex');
    expect(first.items?.map((i) => [i.key, i.flex])).toEqual([['name', '1 1 0'], ['host', '1 1 0']]);
  });

  // A short value in a full-width box looks out of scale, so these take half
  // the row, like From. Lists are drawn by the form itself and stay as they are.
  it('draws short fields at half width', () => {
    const rows = (items: FormItem[]): { key?: string; flex?: string }[] =>
      items.flatMap((i) => {
        if (typeof i === 'string') {
          return [];
        }
        const node = i as { type?: string; items?: FormItem[] };
        const own = node.type === 'flex' && node.items?.length === 1 ? [node.items[0] as { key?: string; flex?: string }] : [];
        return [...own, ...rows(node.items ?? [])];
      });
    const half = rows(schema.form ?? []).filter((x) => x.flex === '0 1 50%').map((x) => x.key).sort();
    expect(half).toEqual([
      'batteryPollAt', 'healSweepIntervalMinutes', 'requestIntervalMs', 'sceneNamePrefix', 'setPositionDebounceMs', 'stopCommand',
    ]);
  });

  // Positions is grouped by what each setting asks: the hub (silent), shades
  // (over RF, in the order they act), then quiet hours. The pause sits under
  // "Wait before asking": the two add up. Everything about a move and stopping
  // it sits in its own section, so stop settings are no longer split between
  // two sections.
  describe('setting order', () => {
    const section = (title: string) =>
      rawKeys(
        ((schema.form ?? []).find((i) => typeof i !== 'string' && (i as { title?: string }).title === title) as {
          items?: FormItem[];
        })?.items ?? [],
      );

    it('orders the sections: positions, moving and stopping, scenes, battery, advanced', () => {
      const titles = (schema.form ?? [])
        .filter((i) => typeof i !== 'string' && (i as { type?: string }).type === 'fieldset')
        .map((i) => (i as { title?: string }).title);
      expect(titles).toEqual(['Positions', 'Moving and stopping', 'Scenes', 'Battery', 'Advanced']);
    });

    it('orders Positions by group: hub, shades, quiet hours', () => {
      expect(section('Positions')).toEqual([
        'pollShadesForUpdate',
        'syncPositionsOnStart',
        'healSweepIntervalMinutes',
        'verifyAfterMove',
        'verifyDelayMs',
        'healSweepGapMs',
        'refreshShades',
        'quietHours.enabled',
        'quietHours.start',
        'quietHours.end',
      ]);
    });

    it('puts every move and stop setting in Moving and stopping', () => {
      expect(section('Moving and stopping')).toEqual([
        'reportTravel',
        'setPositionDebounceMs',
        'stopCommand',
        'stopSwitch',
        'stopBeforeRetarget',
      ]);
    });

    it('keeps only rarely needed settings in Advanced', () => {
      expect(section('Advanced')).toEqual([
        'strictErrors',
        'requestIntervalMs',
        'forceRollerShades',
        'forceTopBottomShades',
        'forceHorizontalShades',
        'forceVerticalShades',
      ]);
    });

    // "see Stop command" once pointed at a title that did not exist.
    it('refers to the stop setting by its title', () => {
      const props = schema.schema.properties as Record<string, { title?: string; description?: string }>;
      const stop = props.stopCommand.title ?? '';
      expect(stop).toBe('Add stop to HomeKit');
      for (const k of ['stopSwitch', 'stopBeforeRetarget']) {
        expect(props[k].description).toContain(`"${stop}" on`);
      }
    });

    it('offers Auto, On and Off for stop', () => {
      const prop = schema.schema.properties.stopCommand as { oneOf: { title: string; enum: string[] }[] };
      expect(prop.oneOf.map((o) => [o.title, o.enum[0]])).toEqual([
        ['Auto (on for Gen 2 hubs)', 'auto'],
        ['On', 'on'],
        ['Off', 'off'],
      ]);
    });

    // The settings UI adds a "None" choice to any dropdown whose field is not
    // required (seen on Homebridge UI, 2026-11-05). Each of these has a default,
    // and the plugin treats a missing value as the default.
    it('requires every dropdown field, so the UI adds no "None" choice', () => {
      const root = schema.schema as { required?: string[]; properties: Record<string, { required?: string[] }> };
      expect(root.required).toContain('stopCommand');
      expect(root.properties.quietHours.required?.sort()).toEqual(['end', 'start']);
    });

    // Two kinds of read, named the same way everywhere: "Ask hub" reads the
    // hub's stored position; "Ask shades" goes over RF and wakes motors.
    it('names each read setting after what it asks', () => {
      const title = (k: string) => (schema.schema.properties[k] as { title: string }).title;
      expect(title('syncPositionsOnStart')).toBe('Ask shades at startup');
      expect(title('pollShadesForUpdate')).toBe('Ask hub every 30 seconds');
      expect(title('healSweepIntervalMinutes')).toBe('Ask shades every (minutes)');
      expect(title('refreshShades')).toBe('Ask shades on every HomeKit read');
      expect(title('verifyAfterMove')).toBe('Ask shades after a move');
    });

    it('never says "the shade" or "the hub" in an ask phrase', () => {
      const text = JSON.stringify(schema);
      expect(text).not.toMatch(/ask(s|ing)? (the|each|every|a) (shade|hub)/i);
    });
  });

  // Quiet hours only gates the startup sync and the heal sweep, so it lives
  // beside them rather than in a section of its own.
  describe('quiet hours', () => {
    type Section = { type?: string; title?: string; helpvalue?: string; items?: FormItem[] };
    const sections = (schema.form ?? []).filter((i): i is Section => typeof i !== 'string');
    const positions = sections.find((s) => s.title === 'Positions');
    const items = positions?.items ?? [];
    // Flattened in order; containers without a key (help, flex) are marked by type.
    const flat = (list: FormItem[]): string[] =>
      list.flatMap((i) => {
        if (typeof i === 'string') {
          return [i];
        }
        const node = i as Section & { key?: string };
        return node.key ? [node.key] : [`(${node.type})`, ...flat(node.items ?? [])];
      });
    const keys = flat(items);
    type Select = { key?: string; type?: string; title?: string; titleMap?: { value: number; name: string }[] };
    type Row = { type?: string; items?: Select[]; condition?: { functionBody: string } };
    const row = items.find(
      (i) => typeof i !== 'string' && (i as Row).type === 'flex' && (i as Row).items?.some((s) => s.key === 'quietHours.start'),
    ) as Row | undefined;
    const quiet = schema.schema.properties.quietHours as {
      description?: string;
      properties: Record<string, { title?: string; type?: string; default?: unknown; description?: string }>;
    };

    it('has no section of its own', () => {
      expect(sections.some((s) => s.title === 'Quiet hours')).toBe(false);
    });

    // A rule, the on/off checkbox, then the hours.
    it('follows the last Ask shades setting, checkbox first', () => {
      const after = keys.indexOf('refreshShades');
      expect(keys.slice(after + 1, after + 6)).toEqual([
        '(help)', 'quietHours.enabled', '(flex)', 'quietHours.start', 'quietHours.end',
      ]);
    });

    // A checkbox replaced "pick the same hour twice to turn this off".
    it('turns on and off with a checkbox, on by default', () => {
      const enabled = quiet.properties.enabled;
      expect(enabled).toMatchObject({ title: 'Use quiet hours', type: 'boolean', default: true });
      // The QUIET HOURS heading says what it does; the checkbox does not repeat it.
      expect(enabled.description).toBeUndefined();
      expect(JSON.stringify(schema)).not.toMatch(/same hour/i);
    });

    // The hours hide while quiet hours are off. The form clears a hidden field
    // (seen on Homebridge UI, 2026-11-05), so the Shade tools page fills in
    // 9 PM-8 AM when the box is ticked again (homebridge-ui/public/formDefaults.js).
    it('hides the hours while quiet hours are off', () => {
      const show = new Function('model', row?.condition?.functionBody ?? 'return true;') as (m: unknown) => boolean;
      expect(show({})).toBe(true);
      expect(show({ quietHours: { enabled: true } })).toBe(true);
      expect(show({ quietHours: { enabled: false } })).toBe(false);
    });

    // Existing installs keep 9 PM-8 AM, and ticking the box again brings back
    // the same hours.
    it('defaults to 9 PM-8 AM', () => {
      const hours = quiet.properties as Record<string, { default?: unknown }>;
      expect([hours.start.default, hours.end.default]).toEqual([21, 8]);
    });

    // Sliders showed a bare "21"; clock-time dropdowns read as "9 PM".
    it('picks each hour from a side-by-side dropdown in 12-hour clock time', () => {
      const selects = row?.items ?? [];
      expect(selects.map((s) => s.key)).toEqual(['quietHours.start', 'quietHours.end']);
      expect(selects.map((s) => s.title)).toEqual(['From', 'Until']);
      for (const s of selects) {
        expect(s.type).toBe('select');
        expect(s.titleMap?.map((o) => o.value)).toEqual([...Array(24).keys()]);
        const name = (h: number) => s.titleMap?.find((o) => o.value === h)?.name;
        expect([name(0), name(8), name(12), name(21)]).toEqual(['12 AM', '8 AM', '12 PM', '9 PM']);
      }
    });

    it('says it covers asking shades at startup and on a schedule', () => {
      const note = items.find((i) => typeof i !== 'string' && /Quiet hours</.test((i as { helpvalue?: string }).helpvalue ?? '')) as
        { helpvalue?: string } | undefined;
      for (const text of [note?.helpvalue ?? '', quiet.description ?? '']) {
        expect(text).toMatch(/asked at startup or on a schedule/i);
      }
    });
  });

  // The UI draws every fieldset and list title as the same 24px bold heading
  // and every container description as white body text. Without classes, a
  // list like "Hidden scenes" looks like a section of its own and section
  // blurbs outshine the grey help text under each field.
  describe('heading styles', () => {
    type Container = { type?: string; labelHtmlClass?: string; labelHelpBlockClass?: string; items?: FormItem[] };
    const containers = (items: FormItem[]): Container[] =>
      items.flatMap((item) =>
        typeof item === 'string' ? [] : [item as Container, ...containers((item as Container).items ?? [])],
      );
    const all = containers(schema.form ?? []);
    const sections = all.filter((c) => c.type === 'fieldset');
    const lists = all.filter((c) => c.type === 'array');
    const FIELD_HELP = 'grey-text help-block small';

    it('gives section titles a section heading size', () => {
      expect(sections.length).toBeGreaterThan(0);
      for (const s of sections) {
        expect(s.labelHtmlClass).toBe('fs-5');
      }
    });

    it('sizes list titles like field labels, not like sections', () => {
      expect(lists.length).toBeGreaterThan(0);
      for (const l of lists) {
        expect(l.labelHtmlClass).toBe('fs-6 fw-light');
      }
    });

    // The UI labels each list's button "Add" + its title, so a title has to
    // read as the thing being added: "Add roller shade IDs", not "Add roller"
    // or "Add hide these scenes".
    it('titles each list so its Add button names what it adds', () => {
      const props = schema.schema.properties as Record<string, { type?: string; title?: string }>;
      const titles = Object.values(props)
        .filter((p) => p.type === 'array')
        .map((p) => p.title ?? '');
      expect(titles.length).toBeGreaterThan(0);
      for (const t of titles) {
        expect(t).toMatch(/ (shade IDs|scenes)$/);
        expect(t).not.toMatch(/^(Hide|Force|Add)\b/);
      }
    });

    // The UI draws a number with both a minimum and a maximum as a slider, and
    // one without as a field (seen on Homebridge UI, 2026-11-05). A slider is
    // hard to set to an exact value, so every number is a field.
    it('shows every number as a field, never a slider', () => {
      const props = schema.schema.properties as Record<string, { type?: string; minimum?: number; maximum?: number }>;
      const ranged = Object.entries(props)
        .filter(([, p]) => (p.type === 'integer' || p.type === 'number') && p.minimum !== undefined && p.maximum !== undefined)
        .map(([k]) => k);
      expect(ranged.sort()).toEqual(['requestIntervalMs', 'setPositionDebounceMs', 'verifyDelayMs']);
      const find = (items: FormItem[], key: string): FormItem | undefined => {
        for (const item of items) {
          if (item === key || (typeof item !== 'string' && item.key === key)) {
            return item;
          }
          const inner = typeof item === 'string' ? undefined : find(item.items ?? [], key);
          if (inner) {
            return inner;
          }
        }
        return undefined;
      };
      for (const key of ranged) {
        expect(find(schema.form ?? [], key)).toMatchObject({ key, type: 'number' });
      }
    });

    // Users see the Home app, not HomeKit; section blurbs use the same words.
    it('says "the Home app" in section descriptions', () => {
      for (const s of sections) {
        expect((s as { description?: string }).description ?? '').not.toMatch(/HomeKit/);
      }
    });

    it('styles every container description like field help text', () => {
      for (const c of [...sections, ...lists]) {
        expect(c.labelHelpBlockClass).toBe(FIELD_HELP);
      }
    });
  });

  // Positions has three groups. Each starts with a help item that draws a small
  // heading, and every group after the first has a rule above it, so related
  // settings read as a unit without the weight of a section of their own.
  describe('Positions groups', () => {
    type Node = { type?: string; key?: string; helpvalue?: string; items?: FormItem[] };
    const position = (schema.form ?? []).find(
      (i) => typeof i !== 'string' && (i as { title?: string }).title === 'Positions',
    ) as Node | undefined;
    const items = position?.items ?? [];
    // A group heading is the small uppercase title a help item draws, styled
    // apart from setting labels. A help item with no heading (the rule above
    // the Quiet hours checkbox) still starts a group.
    const HEADING_CLASS = 'text-uppercase small fw-semibold opacity-75 mb-1';
    const heading = (n: Node) => new RegExp(`class="${HEADING_CLASS}">([^<]+)</div>`).exec(n.helpvalue ?? '')?.[1];
    // Settings under each heading, in order.
    const groups: { title: string; keys: string[]; html: string }[] = [];
    const beforeFirstHeading: string[] = [];
    for (const item of items) {
      const node = item as Node;
      // A note under a half-width field (a plain <p>) stays in its group.
      if (typeof item !== 'string' && node.type === 'help' && !(node.helpvalue ?? '').startsWith('<p')) {
        groups.push({ title: heading(node) ?? '', keys: [], html: node.helpvalue ?? '' });
      } else if (groups.length === 0) {
        beforeFirstHeading.push(...rawKeys([item]));
      } else {
        groups[groups.length - 1].keys.push(...rawKeys([item]));
      }
    }

    it('puts every setting under a heading', () => {
      expect(groups.length).toBeGreaterThan(0);
      expect(beforeFirstHeading).toEqual([]);
    });

    // The pause belongs to two settings but can only sit next to one, so its
    // description names both.
    it('names both settings the pause applies to', () => {
      const props = schema.schema.properties as Record<string, { title?: string; description?: string }>;
      const gap = props.healSweepGapMs.description ?? '';
      expect(gap).toContain(`"${props.healSweepIntervalMinutes.title}"`);
      expect(gap).toContain(`"${props.verifyAfterMove.title}"`);
    });

    it('groups settings by what they ask', () => {
      expect(groups.map((g) => [g.title, g.keys])).toEqual([
        ['Ask hub', ['pollShadesForUpdate']],
        [
          'Ask shades',
          [
            'syncPositionsOnStart',
            'healSweepIntervalMinutes',
            'verifyAfterMove',
            'verifyDelayMs',
            'healSweepGapMs',
            'refreshShades',
          ],
        ],
        ['Quiet hours', ['quietHours.enabled', 'quietHours.start', 'quietHours.end']],
      ]);
    });

    it('styles every group heading the same way, apart from setting labels', () => {
      const titled = items.filter((i) => typeof i !== 'string' && (i as Node).type === 'help' && /fw-semibold/.test((i as Node).helpvalue ?? ''));
      expect(titled.map((i) => heading(i as Node))).toEqual(['Ask hub', 'Ask shades', 'Quiet hours']);
    });

    // A full-width box for a number of minutes looked out of scale; it takes
    // half the row, like From.
    it('draws "Ask shades every (minutes)" at half width', () => {
      type Flex = { type?: string; items?: { key?: string; type?: string; flex?: string }[] };
      const rowOf = items.find((i) => typeof i !== 'string' && (i as Flex).type === 'flex'
        && (i as Flex).items?.some((x) => x.key === 'healSweepIntervalMinutes')) as Flex | undefined;
      expect(rowOf?.items).toEqual([{ key: 'healSweepIntervalMinutes', type: 'number', flex: '0 1 50%', description: '' }]);
    });

    // The group line already says what asking the hub does.
    it('does not repeat the Ask hub group line under its one setting', () => {
      expect((schema.schema.properties.pollShadesForUpdate as { description?: string }).description).toBeUndefined();
    });

    it('puts the two waits side by side', () => {
      type Flex = { type?: string; items?: { key?: string; flex?: string }[]; condition?: { functionBody: string } };
      const pair = items.find((i) => typeof i !== 'string' && (i as Flex).type === 'flex'
        && (i as Flex).items?.some((x) => x.key === 'verifyDelayMs')) as Flex | undefined;
      expect(pair?.items?.map((x) => [x.key, x.flex])).toEqual([['verifyDelayMs', '1 1 0'], ['healSweepGapMs', '1 1 0']]);
    });

    // Every section with more than one group gets the same small headings as
    // Positions. Scenes and Battery are one group each, so the section title is
    // enough.
    it('heads each group in a section the same way as Positions', () => {
    type Node = { type?: string; title?: string; helpvalue?: string; items?: FormItem[] };
    const HEAD = /<div class="text-uppercase small fw-semibold opacity-75 mb-1">([^<]+)<\/div>/;
    const groupsOf = (title: string) => {
      const section = (schema.form ?? []).find((i) => typeof i !== 'string' && (i as Node).title === title) as Node;
      const out: [string, string[]][] = [];
      for (const item of section.items ?? []) {
        const h = typeof item !== 'string' && (item as Node).type === 'help' ? HEAD.exec((item as Node).helpvalue ?? '')?.[1] : undefined;
        if (h) {
          out.push([h, []]);
        } else if (out.length) {
          out[out.length - 1][1].push(...rawKeys([item]));
        }
      }
      return out;
    };
    expect(groupsOf('Moving and stopping')).toEqual([
      ['Moving', ['reportTravel', 'setPositionDebounceMs']],
      ['Stopping', ['stopCommand', 'stopSwitch', 'stopBeforeRetarget']],
    ]);
    expect(groupsOf('Advanced')).toEqual([
      ['Hub', ['strictErrors', 'requestIntervalMs']],
      ['Shade type overrides', ['forceRollerShades', 'forceTopBottomShades', 'forceHorizontalShades', 'forceVerticalShades']],
    ]);
    expect(groupsOf('Scenes')).toEqual([]);
    expect(groupsOf('Battery')).toEqual([]);
    });

    // Three of the four lists had no help at all; one note now covers them.
    it('explains the shade type overrides once, above the four lists', () => {
      const advanced = (schema.form ?? []).find(
        (i) => typeof i !== 'string' && (i as { title?: string }).title === 'Advanced',
      ) as Node | undefined;
      const list = advanced?.items ?? [];
      const at = list.findIndex((i) => typeof i !== 'string' && (i as Node).key === 'forceRollerShades');
      const note = list[at - 1] as Node;
      expect(note.type).toBe('help');
      expect(heading(note)).toBe('Shade type overrides');
      expect(note.helpvalue).toContain(`class="${HEADING_CLASS}"`);
      expect(note.helpvalue).toMatch(/Shade tools/);
    });

    it('draws a rule above every group but the first', () => {
      expect(groups[0].html).not.toMatch(/<hr/);
      for (const g of groups.slice(1)) {
        expect(g.html.startsWith('<hr')).toBe(true);
      }
    });
  });
});
