'use strict';

module.exports = {
  ...require('./common'),
  ...require('./provider-contracts'),
  ...require('./agent-contracts'),
  ...require('./compaction-contracts'),
  ...require('./orchestration-contracts'),
  ...require('./event-contracts'),
  ...require('./ports'),
};
