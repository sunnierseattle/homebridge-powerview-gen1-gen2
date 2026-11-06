// The settings form clears a field it hides and leaves it blank when shown
// again. When quiet hours or the daily battery refresh is ticked again, fill in
// the plugin defaults: 9 PM to 8 AM, and 2 PM. Configs that never set quiet
// hours are left alone; the plugin already uses 9 PM to 8 AM for them.
(function (root) {
  function fill(block) {
    var changed = false;
    var q = block.quietHours;
    if (q && q.enabled !== false && (q.start == null || q.end == null)) {
      block.quietHours = Object.assign({}, q, {
        start: q.start != null ? q.start : 21,
        end: q.end != null ? q.end : 8,
      });
      changed = true;
    }
    if (block.batteryPolling === true && !block.batteryPollAt) {
      block.batteryPollAt = '14:00';
      changed = true;
    }
    return changed;
  }

  // For a saved config that turned quiet hours off before the checkbox existed.
  function untickQuietHours(block) {
    var q = block.quietHours;
    if (q && q.enabled === false) {
      return false;
    }
    block.quietHours = { enabled: false };
    return true;
  }

  root.PowerViewFormDefaults = { fill: fill, untickQuietHours: untickQuietHours };
})(globalThis);
