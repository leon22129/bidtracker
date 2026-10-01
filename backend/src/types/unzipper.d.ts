declare module 'unzipper' {
  import { Transform } from 'node:stream';
  export function Parse(options?: { forceStream?: boolean }): Transform;
}
