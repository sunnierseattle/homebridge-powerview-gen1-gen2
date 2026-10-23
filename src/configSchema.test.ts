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

  // Position is grouped by what each setting asks: the hub (silent), shades
  // (over RF, in the order they act), quiet hours, then how the tile shows
  // travel. The pause sits under "Wait before asking": the two add up.
  describe('setting order', () => {
    const section = (title: string) =>
      rawKeys(
        ((schema.form ?? []).find((i) => typeof i !== 'string' && (i as { title?: string }).title === title) as {
          items?: FormItem[];
        })?.items ?? [],
      );

    it('orders Position by when each setting acts', () => {
      expect(section('Position')).toEqual([
        'pollShadesForUpdate',
        'syncPositionsOnStart',
        'healSweepIntervalMinutes',
        'verifyAfterMove',
        'verifyDelayMs',
        'healSweepGapMs',
        'refreshShades',
        'quietHours.start',
        'quietHours.end',
        'reportTravel',
      ]);
    });

    it('keeps Advanced free of position settings', () => {
      expect(section('Advanced')).not.toContain('refreshShades');
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
    const positions = sections.find((s) => s.title === 'Position');
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

    it('comes right after the ask-shades settings it controls', () => {
      const after = keys.indexOf('refreshShades');
      expect(after).toBeGreaterThan(keys.indexOf('healSweepIntervalMinutes'));
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
        expect(text).toMatch(/after a move still runs/i);
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

  // Position has four groups. Each starts with a help item that draws a small
  // heading, and every group after the first has a rule above it, so related
  // settings read as a unit without the weight of a section of their own.
  describe('Position groups', () => {
    type Node = { type?: string; key?: string; helpvalue?: string; items?: FormItem[] };
    const position = (schema.form ?? []).find(
      (i) => typeof i !== 'string' && (i as { title?: string }).title === 'Position',
    ) as Node | undefined;
    const items = position?.items ?? [];
    const heading = (n: Node) => /<(?:div|p)[^>]*>([^<]+)<\/(?:div|p)>/.exec(n.helpvalue ?? '')?.[1];
    // Settings under each heading, in order.
    const groups: { title?: string; keys: string[]; html: string }[] = [];
    for (const item of items) {
      const node = item as Node;
      if (typeof item !== 'string' && node.type === 'help') {
        groups.push({ title: heading(node), keys: [], html: node.helpvalue ?? '' });
      } else {
        groups.at(-1)?.keys.push(...rawKeys([item]));
      }
    }

    it('starts with a heading', () => {
      expect((items[0] as Node).type).toBe('help');
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
        ['In the Home app', ['reportTravel']],
      ]);
    });

    it('draws a rule above every group but the first', () => {
      expect(groups[0].html).not.toMatch(/<hr/);
      for (const g of groups.slice(1)) {
        expect(g.html.startsWith('<hr')).toBe(true);
      }
    });

    it('puts the pause right under the wait it adds to', () => {
      const keys = rawKeys(items);
      expect(keys.indexOf('healSweepGapMs')).toBe(keys.indexOf('verifyDelayMs') + 1);
    });
  });
});
