import { parentPort, workerData } from 'node:worker_threads';
import { createCreatorStore } from './creator-store.mjs';

// The HTTP listener remains responsive during durable filesystem transactions.
// Cancellation asks the transaction to roll back; never terminate a writer mid-commit.
const abort = new Int32Array(workerData.abort);
let processed = 0;
const store = createCreatorStore(workerData.grants, {
  log: event => parentPort.postMessage({ event }),
  fault(stage) {
    if (stage === 'installed') processed++;
    if (stage === 'preflight' || stage === 'installed')
      parentPort.postMessage({ progress: { phase: stage === 'installed' ? '正在写入并校验' : '依赖检查完成，准备写入', processed } });
  },
});
try {
  const signal = { get aborted() { return Atomics.load(abort, 0) !== 0; } };
  const result = workerData.operation === 'import'
    ? store.importModel(workerData.body, { signal })
    : store.copyImportedModelToGame(workerData.body, { signal });
  parentPort.postMessage({ result });
} catch (error) {
  parentPort.postMessage({ error: { code:error.code, message:error.message, journalPath:error.journalPath } });
} finally { store.close(); }
