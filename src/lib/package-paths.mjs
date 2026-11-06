// A package path is one contained directory, including existing links.
import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { paths } from './config.mjs';

function isInside(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep));
}

function physicalPath(path) {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  if (parent === path) return path;
  return resolve(physicalPath(parent), relative(parent, path));
}

export function applicationPath(dir) {
  if (typeof dir !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(dir)) {
    throw new Error('Unsafe application directory: expected one directory name');
  }
  const p = paths();
  const base = resolve(p.applicationsDir);
  const target = resolve(base, dir);
  if (!isInside(physicalPath(p.root), physicalPath(base)) || !isInside(physicalPath(base), physicalPath(target))) {
    throw new Error('Unsafe application directory: path leaves the workspace');
  }
  return target;
}

