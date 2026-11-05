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

  it('keeps name and host outside the collapsible sections', () => {
    expect(schema.form?.slice(0, 2)).toEqual(['name', 'host']);
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
        .filter((i) => typeof i !== 'string')
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
    it('refers to Offer stop by its title', () => {
      const props = schema.schema.properties as Record<string, { title?: string; description?: string }>;
      const offer = props.stopCommand.title ?? '';
      expect(offer).toBe('Offer stop');
      for (const k of ['stopSwitch', 'stopBeforeRetarget']) {
        expect(props[k].description).toContain(`${offer} on`);
      }
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
    const helpItem = items.find(
      (i) => typeof i !== 'string' && (i as Section).type === 'help' && /Quiet hours/.test((i as Section).helpvalue ?? ''),
    ) as Section | undefined;
    type Select = { key?: string; type?: string; title?: string; titleMap?: { value: number; name: string }[] };
    const row = items.find((i) => typeof i !== 'string' && (i as Section).type === 'flex') as { items?: Select[] } | undefined;

    it('has no section of its own', () => {
      expect(sections.some((s) => s.title === 'Quiet hours')).toBe(false);
    });

    it('follows the last Ask shades setting, help note first', () => {
      const after = keys.indexOf('refreshShades');
      expect(keys.slice(after + 1, after + 5)).toEqual(['(help)', '(flex)', 'quietHours.start', 'quietHours.end']);
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

    it('says it covers asking shades at startup and on schedule', () => {
      const prop = (schema.schema.properties.quietHours as { description: string }).description;
      for (const text of [helpItem?.helpvalue ?? '', prop]) {
        expect(text).toMatch(/ask shades at startup/i);
        expect(text).toMatch(/schedule/i);
      }
    });

    // A setting that wakes shades during quiet hours says so in its own
    // description; the quiet hours note has to name it too, or the note reads
    // as if it covers that setting.
    it('names every setting that still asks shades during quiet hours', () => {
      const props = schema.schema.properties as Record<string, { title?: string; description?: string }>;
      const exempt = Object.values(props)
        .filter((p) => /even in quiet hours|quiet hours do not apply/i.test(p.description ?? ''))
        .map((p) => p.title ?? '');
      expect(exempt.sort()).toEqual(['Ask shades after a move', 'Ask shades on every HomeKit read', 'Refresh battery daily']);
      const prop = (schema.schema.properties.quietHours as { description: string }).description;
      for (const text of [helpItem?.helpvalue ?? '', prop]) {
        for (const title of exempt) {
          expect(text).toContain(`"${title}"`);
        }
      }
    });

    // Only startup and the schedule are held back (platform.ts). Stop checks,
    // Shade tools checks and a read of a shade with no known position still
    // wake motors, and the note says so.
    it('names the asks that are not settings', () => {
      const prop = (schema.schema.properties.quietHours as { description: string }).description;
      for (const text of [helpItem?.helpvalue ?? '', prop]) {
        expect(text).toMatch(/after a stop/i);
        expect(text).toMatch(/Shade tools/);
        expect(text).toMatch(/unknown position/i);
      }
    });
  });

  // The UI draws every fieldset and list title as the same 24px bold heading
  // and every container description as white body text. Without classes, a
  // list like "Hide these scenes" looks like a section of its own and section
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
    // A group heading is the bold, plain-text title a help item draws. Other
    // help notes stay inside their group instead of starting a new one.
    const heading = (n: Node) => /class="fw-semibold"[^>]*>([^<]+)<\/div>/.exec(n.helpvalue ?? '')?.[1];
    // Settings under each heading, in order.
    const groups: { title: string; keys: string[]; html: string }[] = [];
    const beforeFirstHeading: string[] = [];
    for (const item of items) {
      const node = item as Node;
      const title = typeof item !== 'string' && node.type === 'help' ? heading(node) : undefined;
      if (title) {
        groups.push({ title, keys: [], html: node.helpvalue ?? '' });
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
        ['Quiet hours', ['quietHours.start', 'quietHours.end']],
      ]);
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
