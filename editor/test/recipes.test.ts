import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BG_LIST, CARD_LIST, LOOK_LIST, LOWER_LIST, OVERLAY_LIST, TEXT_LIST, TRANSITION_LIST, type Named } from '../../src/fx/registry';
import { SOUNDS } from '../../src/fx/sounds';
import { SCENE_FX, allFields, catalogText } from '../src/catalog';
import { RECIPE_CATS, RECIPES, recipesText } from '../src/recipes';

// Every registry kind a recipe may point at
const LISTS: Record<string, Named[]> = {
  transition: TRANSITION_LIST,
  overlay: OVERLAY_LIST,
  sound: SOUNDS.map((s) => ({ id: s.id, en: s.en, zh: s.zh })),
  card: CARD_LIST,
  text: TEXT_LIST,
  lower: LOWER_LIST,
  look: LOOK_LIST,
  bg: BG_LIST,
};
const fields = allFields(SCENE_FX);

test('recipe ids are unique and their categories exist', () => {
  const ids = RECIPES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const r of RECIPES) {
    assert.match(r.id, /^[a-z]+(-[a-z]+)*$/, r.id);
    assert.ok(RECIPE_CATS[r.cat], `${r.id}: category ${r.cat}`);
    assert.ok(r.uses.length, `${r.id}: uses nothing`);
  }
});

test('every effect a recipe uses exists, is not against a house rule and is named in its steps', () => {
  for (const r of RECIPES) {
    for (const u of r.uses) {
      const [kind, id] = [u.slice(0, u.indexOf(':')), u.slice(u.indexOf(':') + 1)];
      if (kind === 'fx') {
        const f = fields.find((x) => x.path === id);
        assert.ok(f, `${r.id}: no scene effect ${id}`);
        assert.ok(!f.rule, `${r.id}: ${id} is against a house rule`);
      } else {
        const list = LISTS[kind];
        assert.ok(list, `${r.id}: unknown kind in ${u}`);
        const item = list.find((x) => x.id === id);
        assert.ok(item, `${r.id}: no ${kind} "${id}"`);
        assert.ok(!item.rule, `${r.id}: ${u} is against a house rule`);
      }
      assert.ok(r.how.includes(id), `${r.id}: steps don't mention ${id}`);
    }
  }
});

test('recipe steps never quote an effect that is against a house rule', () => {
  const ruled = [...TRANSITION_LIST, ...OVERLAY_LIST, ...TEXT_LIST].filter((x) => x.rule).map((x) => x.id);
  for (const r of RECIPES) for (const id of ruled) assert.ok(!r.how.includes(`"${id}"`), `${r.id} quotes "${id}"`);
});

test('the AI catalog lists every recipe by category', () => {
  const text = catalogText();
  assert.ok(text.includes(recipesText()));
  for (const r of RECIPES) assert.ok(text.includes(`  ${r.id} — ${r.en} (${r.zh}):`), r.id);
  for (const c of Object.values(RECIPE_CATS)) assert.ok(text.includes(` ${c.en}\n`), c.en);
});
