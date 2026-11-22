const { inflateSync } = require('node:zlib');
// pngjs subclasses Node's internal Inflate implementation, which Workers does not expose.
module.exports = (data, options = {}) => inflateSync(data, { maxOutputLength: options.maxLength || 34 * 1024 * 1024 });
