import { assert, test } from './testlib.js';

import { World, defineComponent } from '../core.js';
import { defineArchetype, createFrom, Archetype } from '../archetype.js';

const Position = defineComponent('Archetype.Position', { x: 0, y: 0 });
const Health = defineComponent('Archetype.Health', { hp: 1, max: 1 });
const Meta = defineComponent('Archetype.Meta', { tag: '' });

const Base = defineArchetype('BaseCreature', [Health, { hp: 5, max: 5 }]);

function makeWorld() {
  const world = new World();
  return world;
}

test('Archetype builder composes steps and overrides', () => {
  const builder = Archetype('Orc')
    .add(Position, (params) => ({ x: params.x ?? 0, y: params.y ?? 0 }))
    .use(Base)
    .with({ [Health.name]: { hp: 10 } })
    .step((world, id, params) => {
      world.add(id, Meta, { tag: params.tag ?? 'grunt' });
    });

  const Orc = builder.build();

  const world = makeWorld();
  const id = createFrom(world, Orc, { x: 3, tag: 'brute' });

  assert.deepEqual(world.get(id, Position), { x: 3, y: 0 });
  assert.deepEqual(world.get(id, Health), { hp: 10, max: 5 });
  assert.deepEqual(world.get(id, Meta), { tag: 'brute' });
});

test('Archetype builder include and reuse protections', () => {
  const Extra = defineArchetype('Extra', [Meta, { tag: 'extra' }]);

  const builder = Archetype('Combo').include(Base, Extra);
  const Combo = builder.create();

  const world = makeWorld();
  const id = createFrom(world, Combo, {});

  assert.equal(world.get(id, Health).hp, 5);
  assert.equal(world.get(id, Meta).tag, 'extra');

  assert.throws(() => builder.add(Position), /builder already used/i);
});
