import path from 'node:path';
const source=path.join(import.meta.dirname,'target-webgal-mygo');
export default {
 resolve:{alias:{'@':path.join(source,'packages/webgal/src'),'webgal-parser':path.join(source,'packages/parser/src/index.ts')}},
 test:{include:['src/**/*.test.ts'],threads:true,minThreads:1,maxThreads:1,environment:'node',testTimeout:15000},
};
