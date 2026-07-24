'use strict';

// Draft (unsent) cart lines live as a JSON blob on pos_orders.draft_items and
// get rewritten wholesale on every save. Fired lines get a stable id from the
// pos_kot_items autoincrement column; draft lines historically had none. Give
// any line missing one a negative id — never collides with a real (positive)
// pos_kot_items.id, and stays stable across re-saves since it's persisted
// back into the JSON.
function assignDraftIds(items) {
  if (!Array.isArray(items)) return items;
  let nextId = Math.min(0, ...items.map(i => (typeof i.id === 'number' ? i.id : 0)));
  return items.map(it => {
    if (typeof it.id === 'number') return it;
    nextId -= 1;
    return { ...it, id: nextId };
  });
}

module.exports = { assignDraftIds };
