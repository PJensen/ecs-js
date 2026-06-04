import { assert, test } from './testlib.js';

import { EcsEvent, World } from '../core.js';

class DamageApplied extends EcsEvent {
  constructor({ id, amount }) {
    super();
    this.id = id;
    this.amount = amount;
    Object.freeze(this);
  }
}

class NamedLikeString extends EcsEvent {
  static get eventName() {
    return 'damage';
  }
}

test('string events still deliver payload and world', () => {
  const world = new World();
  const payload = { id: 1, amount: 10 };
  let seenPayload = null;
  let seenWorld = null;

  const count = world.on('damage', (p, w) => {
    seenPayload = p;
    seenWorld = w;
  });

  assert.equal(typeof count, 'function');
  assert.equal(world.emit('damage', payload), 1);
  assert.equal(seenPayload, payload);
  assert.equal(seenWorld, world);
});

test('concrete event classes deliver the emitted event instance and world', () => {
  const world = new World();
  const event = new DamageApplied({ id: 1, amount: 10 });
  let seenEvent = null;
  let seenWorld = null;

  world.on(DamageApplied, (ev, w) => {
    seenEvent = ev;
    seenWorld = w;
  });

  assert.equal(world.emit(event), 1);
  assert.equal(seenEvent, event);
  assert.equal(seenEvent.id, 1);
  assert.equal(seenEvent.amount, 10);
  assert.equal(seenWorld, world);
});

test('concrete event subscriptions can be unsubscribed', () => {
  const world = new World();
  let count = 0;

  const unsubscribe = world.on(DamageApplied, () => {
    count++;
  });

  world.emit(new DamageApplied({ id: 1, amount: 10 }));
  unsubscribe();
  world.emit(new DamageApplied({ id: 1, amount: 10 }));

  assert.equal(count, 1);
});

test('EcsEvent cannot be constructed directly', () => {
  assert.throws(() => new EcsEvent(), Error, /EcsEvent is abstract/);
});

test('invalid event API forms throw', () => {
  const world = new World();

  assert.throws(
    () => world.emit(DamageApplied, { id: 1, amount: 10 }),
    Error,
    /expected non-empty string event name or EcsEvent instance/
  );

  assert.throws(
    () => world.on(new DamageApplied({ id: 1, amount: 10 }), () => {}),
    Error,
    /event key must be a non-empty string event name or concrete EcsEvent class/
  );

  assert.throws(
    () => world.on('damage', 'not a function'),
    Error,
    /listener must be a function/
  );
});

test('string event names and concrete event classes do not cross-deliver', () => {
  const world = new World();
  const hits = [];

  world.on('damage', () => hits.push('string'));
  world.on(NamedLikeString, () => hits.push('class'));

  assert.equal(world.emit('damage', { amount: 3 }), 1);
  assert.deepEqual(hits, ['string']);

  assert.equal(world.emit(new NamedLikeString()), 1);
  assert.deepEqual(hits, ['string', 'class']);
});
