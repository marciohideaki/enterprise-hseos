'use strict';

module.exports = {
  ...require('./common'),
  ...require('./registry'),
  ...require('./scripted-provider'),
};

for (const name of ['MAX_SSE_BUFFER_BYTES', 'OpenAICompatibleModelProvider', 'parseSse']) {
  Object.defineProperty(module.exports, name, {
    enumerable: true,
    get() {
      return require('./openai-compatible-provider')[name];
    },
  });
}
