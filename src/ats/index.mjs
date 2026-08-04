// Registry of ATS read clients. Add a module + entry here to support a new ATS.
import * as greenhouse from './greenhouse.mjs';
import * as lever from './lever.mjs';
import * as ashby from './ashby.mjs';

export const SOURCES = {
  greenhouse,
  lever,
  ashby,
};

export function getSource(ats) {
  return SOURCES[ats] ?? null;
}
