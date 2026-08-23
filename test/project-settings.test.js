import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

test('Projects expose a required one-to-five priority and optional default block length', () => {
  const projectList = mainSource.slice(mainSource.indexOf('function masterProjectList()'), mainSource.indexOf('function calendarTaskSummary'));
  assert.match(projectList, /class="project-priority"/);
  assert.match(projectList, /type="radio"/);
  assert.match(projectList, /1 highest · 5 lowest/);
  assert.match(projectList, /required/);
  assert.match(projectList, /class="project-duration-enabled"/);
  assert.match(projectList, /Set default block length/);
  assert.match(projectList, /durationEnabled \? '' : 'disabled'/);
});

test('Calendar inherits an enabled project duration while keeping its block selector editable', () => {
  const handler = mainSource.slice(mainSource.indexOf('function handleProjectSelectChange'), mainSource.indexOf('function showInlineProjectCreator'));
  assert.match(handler, /projectSettings\(select\.value\)\.defaultDuration/);
  assert.match(handler, /calendarDraft\[select\.dataset\.index\]\.duration = defaultDuration/);
  assert.match(mainSource, /class="text-input calendar-duration"/);
});
