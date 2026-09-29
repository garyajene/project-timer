import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

test('Projects expose priority, default block length, and persistent project color controls', () => {
  const projectList = mainSource.slice(mainSource.indexOf('function masterProjectList()'), mainSource.indexOf('function calendarTaskSummary'));
  assert.match(projectList, /class="project-priority"/);
  assert.match(projectList, /type="radio"/);
  assert.match(projectList, /1 highest · 5 lowest/);
  assert.match(projectList, /required/);
  assert.match(projectList, /class="text-input project-duration"/);
  assert.match(projectList, /Default block length/);
  assert.match(projectList, /class="project-color"/);
  assert.match(projectList, /Project color/);
  assert.match(projectList, /settings\.color === id/);
});

test('Calendar inherits an enabled project duration while keeping its block selector editable', () => {
  const handler = mainSource.slice(mainSource.indexOf('function handleProjectSelectChange'), mainSource.indexOf('function showInlineProjectCreator'));
  assert.match(handler, /projectSettings\(select\.value\)\.defaultDuration/);
  assert.match(handler, /calendarDraft\[select\.dataset\.index\]\.duration = defaultDuration/);
  assert.match(mainSource, /class="text-input calendar-duration"/);
});
