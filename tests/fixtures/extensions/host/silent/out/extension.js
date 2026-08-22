'use strict';
// A `main` with no `activate`: legal, and common in declarative extensions
// that ship a bundle they never run.
module.exports = { helper: () => 'nothing to activate' };
