import { resolveStartupRoot } from './util/startupRoot';

process.chdir(
  resolveStartupRoot(
    process.argv.slice(2),
    process.cwd(),
    process.execPath,
    Boolean((process as NodeJS.Process & { pkg?: unknown }).pkg),
  ),
);
