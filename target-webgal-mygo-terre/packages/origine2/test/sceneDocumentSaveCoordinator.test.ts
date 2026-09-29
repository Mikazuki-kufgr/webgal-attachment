import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SceneDocumentSaveCoordinator,
  type SceneDocumentSaveRequest,
  type SceneDocumentSaveResponse,
} from '../src/utils/sceneDocumentSaveCoordinator.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  assert.fail('condition was not reached');
}

function responseFor(request: SceneDocumentSaveRequest): SceneDocumentSaveResponse {
  return {
    ok: true,
    path: request.path,
    saveSessionId: request.saveSessionId,
    revision: request.revision,
    contentHash: request.contentHash,
    ...(request.verifyOnly ? { verifiedCurrent: true } : {}),
  };
}

test('rechecks an unchanged saved document and blocks preview on external change', async () => {
  const coordinator = new SceneDocumentSaveCoordinator('disk-check');
  let disk = '';
  const requests: SceneDocumentSaveRequest[] = [];
  const transport = async (request: SceneDocumentSaveRequest) => {
    requests.push(request);
    if (request.verifyOnly) {
      if (disk !== request.textFile) throw new Error('SCENE_WRITE_CONFLICT');
    } else disk = request.textFile;
    return responseFor(request);
  };
  await coordinator.save('scene.txt', 'A', transport);
  disk = 'external B';
  let runs = 0;
  await assert.rejects(coordinator.saveAndRun('scene.txt', 'A', { transport, run: () => { runs++; } }), /SCENE_WRITE_CONFLICT/);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].verifyOnly, true);
  assert.equal(runs, 0);
  assert.equal(disk, 'external B');
  assert.equal(coordinator.getLatestText('scene.txt'), 'A');
  assert.equal(coordinator.hasDirtyDraft('scene.txt'), true);
  assert.equal(coordinator.acceptPersisted('scene.txt', 'external B'), false);
  disk = 'A';
  assert.equal(await coordinator.saveAndRun('scene.txt', 'A', { transport, run: () => { runs++; } }), true);
  assert.equal(runs, 1);
  assert.equal(coordinator.hasDirtyDraft('scene.txt'), false);
});

test('loaded clean documents require a fresh server verification, including superseded verification', async () => {
  const coordinator = new SceneDocumentSaveCoordinator('loaded');
  coordinator.acceptPersisted('scene.txt', 'A');
  const gate = deferred<SceneDocumentSaveResponse>();
  let request: SceneDocumentSaveRequest | undefined;
  let runs = 0;
  const operation = coordinator.saveAndRun('scene.txt', 'A', { transport: r => { request = r; return gate.promise; }, run: () => { runs++; } });
  await until(() => request !== undefined);
  assert.equal(request!.verifyOnly, true);
  coordinator.stage('scene.txt', 'new draft');
  gate.resolve(responseFor(request!));
  assert.equal(await operation, false);
  assert.equal(runs, 0);
  assert.equal(coordinator.hasDirtyDraft('scene.txt'), true);
});

test('serializes per-document saves and never lets an older request write after a newer draft', async () => {
  const coordinator = new SceneDocumentSaveCoordinator('session-a');
  const gates = [deferred<SceneDocumentSaveResponse>(), deferred<SceneDocumentSaveResponse>()];
  const requests: SceneDocumentSaveRequest[] = [];
  const transport = (request: SceneDocumentSaveRequest) => {
    requests.push(request);
    return gates[requests.length - 1].promise;
  };

  const saveA = coordinator.save('game/scene/start.txt', 'A', transport);
  const saveB = coordinator.save('game/scene/start.txt', 'B', transport);

  await until(() => requests.length === 1);
  assert.equal(requests[0].textFile, 'A');
  gates[0].resolve(responseFor(requests[0]));
  assert.equal((await saveA).status, 'superseded');

  await until(() => requests.length === 2);
  assert.equal(requests[1].textFile, 'B');
  assert.ok(requests[1].revision > requests[0].revision);
  gates[1].resolve(responseFor(requests[1]));
  assert.equal((await saveB).status, 'saved');
  assert.equal(coordinator.getLatestText('game/scene/start.txt'), 'B');
  assert.equal(coordinator.hasDirtyDraft('game/scene/start.txt'), false);
});

test('waits for the clicked draft to save before running preview', async () => {
  const coordinator = new SceneDocumentSaveCoordinator('session-b');
  const gate = deferred<SceneDocumentSaveResponse>();
  let request: SceneDocumentSaveRequest | undefined;
  let previewRuns = 0;

  const operation = coordinator.saveAndRun('game/scene/start.txt', 'new draft', {
    transport: (nextRequest) => {
      request = nextRequest;
      return gate.promise;
    },
    run: () => {
      previewRuns += 1;
    },
  });

  await until(() => request !== undefined);
  assert.equal(previewRuns, 0);
  gate.resolve(responseFor(request!));
  assert.equal(await operation, true);
  assert.equal(previewRuns, 1);
});

test('keeps a failed draft dirty, suppresses preview, and permits an exact retry', async () => {
  const coordinator = new SceneDocumentSaveCoordinator('session-c');
  let attempts = 0;
  let previewRuns = 0;
  const transport = async (request: SceneDocumentSaveRequest) => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    return responseFor(request);
  };

  await assert.rejects(
    coordinator.saveAndRun('game/scene/start.txt', 'latest', {
      transport,
      run: () => {
        previewRuns += 1;
      },
    }),
    /disk full/,
  );
  assert.equal(previewRuns, 0);
  assert.equal(coordinator.hasDirtyDraft('game/scene/start.txt'), true);
  assert.equal(coordinator.getLatestText('game/scene/start.txt'), 'latest');

  assert.equal(
    await coordinator.saveAndRun('game/scene/start.txt', 'latest', {
      transport,
      run: () => {
        previewRuns += 1;
      },
    }),
    true,
  );
  assert.equal(previewRuns, 1);
  assert.equal(coordinator.hasDirtyDraft('game/scene/start.txt'), false);
});

test('does not run a preview callback for a save superseded by a newer draft', async () => {
  const coordinator = new SceneDocumentSaveCoordinator('session-d');
  const firstGate = deferred<SceneDocumentSaveResponse>();
  const secondGate = deferred<SceneDocumentSaveResponse>();
  const requests: SceneDocumentSaveRequest[] = [];
  const transport = (request: SceneDocumentSaveRequest) => {
    requests.push(request);
    return requests.length === 1 ? firstGate.promise : secondGate.promise;
  };
  let oldPreviewRuns = 0;
  let newPreviewRuns = 0;

  const oldOperation = coordinator.saveAndRun('game/scene/start.txt', 'old', {
    transport,
    run: () => {
      oldPreviewRuns += 1;
    },
  });
  const newOperation = coordinator.saveAndRun('game/scene/start.txt', 'new', {
    transport,
    run: () => {
      newPreviewRuns += 1;
    },
  });

  await until(() => requests.length === 1);
  firstGate.resolve(responseFor(requests[0]));
  assert.equal(await oldOperation, false);
  assert.equal(oldPreviewRuns, 0);

  await until(() => requests.length === 2);
  secondGate.resolve(responseFor(requests[1]));
  assert.equal(await newOperation, true);
  assert.equal(newPreviewRuns, 1);
});
