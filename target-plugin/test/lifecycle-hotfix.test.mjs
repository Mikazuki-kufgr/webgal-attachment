import test from 'node:test';
import assert from 'node:assert/strict';
import { findHostProcesses } from '../runtime/lifecycle-process-preflight.mjs';
import { errorDiagnostic } from '../runtime/lifecycle-diagnostics.mjs';
import { lifecycleHumanLines } from '../../20_installable-candidate/source/lifecycle-user-messages.mjs';
test('process preflight scopes exact host, excludes maintenance ancestors, retains sibling Creator and Terre', () => {
  const root = 'D:\\test\\release';
  const rows = [
    { ProcessId: 1, ParentProcessId: 0, Name: 'cmd.exe' },
    { ProcessId: 2, ParentProcessId: 1, Name: 'node.exe', ExecutablePath: root+'\\node.exe' },
    { ProcessId: 3, ParentProcessId: 1, Name: 'WebGAL_Terre.exe', ExecutablePath: root+'\\WebGAL_Terre.exe' },
    { ProcessId: 4, ParentProcessId: 1, Name: 'node.exe', ExecutablePath: 'C:\\node.exe', CommandLine: 'node "'+root+'\\WebGAL-Attachment-Manager\\runtime\\creator-launch.mjs"' },
    { ProcessId: 5, ParentProcessId: 1, Name: 'WebGAL_Terre.exe', ExecutablePath: root+'-other\\WebGAL_Terre.exe' },
  ];
  assert.deepEqual(findHostProcesses(rows, root, 2).map(p=>p.pid), [3,4]);
});
test('native EBUSY and EPERM preserve the filesystem evidence and useful human output', () => {
  for (const code of ['EBUSY','EPERM']) {
    const error = Object.assign(new Error('rename failed'), {code, syscall:'rename',path:'D:\\host\\manager',dest:'D:\\host\\txn\\old'});
    const detail = errorDiagnostic(error, {stage:'manager-commit',operation:'uninstall'});
    assert.equal(detail.syscall,'rename');assert.equal(detail.nativeCode,code);assert.equal(detail.stage,'manager-commit');assert.equal(detail.dest,error.dest);
    const lines = lifecycleHumanLines({ok:false,code,mode:'Uninstall',writesApplied:0,rolledBack:true,detail});
    assert(lines.join('\n').includes(error.path));assert(!lines.join('\n').includes('[object Object]'));
  }
});
test('hash mismatch diagnostic retains all four proof values', () => {
  const detail=errorDiagnostic(Object.assign(new Error('template changed'),{code:'AUTHORING_TEMPLATE_HASH_MISMATCH',path:'game/config.txt',expectedHash:'AA',actualHash:'BB',expectedSize:117,actualSize:131}));
  assert.equal(detail.expectedHash,'AA');assert.equal(detail.actualHash,'BB');assert.equal(detail.expectedSize,117);assert.equal(detail.actualSize,131);
});
