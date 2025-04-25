import { type MainModule as MainModule15 } from '../wasm/15/pg-parser.js';
import { type MainModule as MainModule16 } from '../wasm/16/pg-parser.js';
import { type MainModule as MainModule17 } from '../wasm/17/pg-parser.js';

type MainModule = MainModule15 | MainModule16 | MainModule17;
type PgParserModule = (options?: unknown) => Promise<MainModule>;

export const supportedVersions = [15, 16, 17] as const;
export type SupportedVersion = (typeof supportedVersions)[number];

export type PgParserOptions = {
  version?: SupportedVersion;
};

export class PgParser {
  readonly ready: Promise<void>;
  readonly version: number;

  #module: Promise<MainModule>;

  constructor({ version = 17 }: PgParserOptions = {}) {
    if (!supportedVersions.includes(version)) {
      throw new Error(`unsupported version: ${version}`);
    }

    this.#module = this.#init(version);
    this.ready = this.#module.then();
    this.version = version;
  }

  async #init(version: SupportedVersion) {
    const createModule = await import(
      `../wasm/${version}/pg-parser.js` as const
    ).then<PgParserModule>((module) => module.default);

    const module = await createModule();

    return module;
  }

  async parseSql(sql: string) {
    const module = await this.#module;
    const result: string = module.ccall(
      'parse_sql',
      'string',
      ['string'],
      [sql]
    );
    return JSON.parse(result);
  }
}
