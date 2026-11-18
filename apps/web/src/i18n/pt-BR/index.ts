/**
 * Brazilian Portuguese, in parts by area of the interface. A phrase belongs
 * to the part of the area that uses it; one used in several areas belongs to
 * `common`. The parts are laid over each other, so a phrase written in two
 * of them must say the same in both: a test fails when it does not.
 */
import authorization from './authorization';
import chrome from './chrome';
import common from './common';
import core from './core';
import experiments from './experiments';
import guide from './guide';
import inspector from './inspector';
import scenarios from './scenarios';
import workspace from './workspace';

export const PARTS = {
  common,
  core,
  chrome,
  scenarios,
  authorization,
  inspector,
  guide,
  experiments,
  workspace,
} as const;

export const PT_BR = {
  ...common,
  ...core,
  ...chrome,
  ...scenarios,
  ...authorization,
  ...inspector,
  ...guide,
  ...experiments,
  ...workspace,
} as const;
