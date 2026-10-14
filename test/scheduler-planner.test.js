import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('../src/main.js', import.meta.url),'utf8');
import test from 'node:test';
test('month planner renders original and copied weeks with selected date controls in both views', () => {
const weekDays=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const days=Object.fromEntries(weekDays.map(day=>[day,{enabled:true,start:'10:30',end:'23:30',blocks:3,cushion:'medium',breakEnabled:false,breakStart:'12:00',breakEnd:'13:00'}]));
const context=vm.createContext({schedulerMode:'repeat',schedulerRangeStart:'2026-10-19',schedulerRangeEnd:'2026-10-25',schedulerRepeatSource:'2026-10-12',plannerDate:'2026-10-20',plannerMonth:'2026-10-12',plannerPresentation:'standard',repeatRules:{},repeatDrafts:{},weekDays,state:{projects:['Design','Writing'],schedulerSettings:{days,dateRules:{}}},projectSettings: () => ({color:'lavender'}),getScheduleForDate: date=>['2026-10-13','2026-10-15'].includes(date)?[{project:'Design',time:'10:30',duration:90,title:'Focus',done:true}]:[],escapeHtml: value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),formatTime: value=>value});
vm.runInContext(source.slice(source.indexOf('function toDateKey('),source.indexOf('function sortBlocks(')),context);
vm.runInContext(source.slice(source.indexOf('function schedulerDayCard('),source.indexOf('function schedulerPage(')),context);
const standard=context.schedulerMonthPlanner();
assert.equal((standard.match(/data-planner-date=/g)||[]).length,42);
assert.equal((standard.match(/planner-source/g)||[]).length,7);
assert.equal((standard.match(/planner-target/g)||[]).length,7);
assert.match(standard,/data-planner-callout-target/);
assert.match(standard,/data-planner-callout/);
assert.match(standard,/planner-color-lavender/);
assert.match(standard,/Copied blocks — not saved yet/);
assert.match(standard,/data-planner-rule="2026-10-20"/);
context.plannerPresentation='three-d';
const three=context.schedulerMonthPlanner();
assert.equal((three.match(/calendar-cube-row/g)||[]).length,6);
assert.equal((three.match(/data-planner-date=/g)||[]).length,42);

});
