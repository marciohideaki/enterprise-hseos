'use strict';

const { parentPort } = require('node:worker_threads');
const Ajv2020 = require('ajv/dist/2020');

parentPort.once('message', ({ schema, value }) => {
  try {
    const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false, loadSchema: undefined });
    ajv.addKeyword({ keyword: 'x-mcp-header', schemaType: 'string' });
    const validate = ajv.compile(schema);
    const valid = validate(value);
    parentPort.postMessage({ valid, errors: validate.errors || [] });
  } catch (error) {
    parentPort.postMessage({ valid: false, compilerError: error.message });
  }
});
