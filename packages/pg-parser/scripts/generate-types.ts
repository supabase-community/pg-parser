/// <reference types="node" />

import { PgProtoParser, PgProtoParserOptions } from 'pg-proto-parser';
import { parseArgs } from 'node:util';

const {
  values: { ['input-file']: inFile, ['output-dir']: outDir },
} = parseArgs({
  options: {
    ['input-file']: {
      type: 'string',
      short: 'i',
    },
    ['output-dir']: {
      type: 'string',
      short: 'o',
    },
  },
});

if (!inFile) {
  throw new Error('input-file is required');
}

if (!outDir) {
  throw new Error('output-dir is required');
}

const options: PgProtoParserOptions = {
  outDir,
  types: {
    enabled: true,
    wrappedNodeTypeExport: true,
    optionalFields: true,
    filename: 'pg-parser-types.d.ts',
    enumsSource: './pg-parser-enums.js',
  },
  enums: {
    enabled: true,
    enumsAsTypeUnion: true,
    filename: 'pg-parser-enums.d.ts',
  },
};

const parser = new PgProtoParser(inFile, options);

parser.write();
