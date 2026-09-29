// Source builds only. Runtime installation never copies or pins a user's font.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const source=path.resolve(process.argv[2] || 'MISSING_HOST_FONT');
const target=path.resolve(import.meta.dirname,'../target-webgal-mygo/packages/webgal/src/assets/fonts/OPPOSans-R.ttf');
const bytes=fs.readFileSync(source);
assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(),'EA92535935F8B5DA18B64BB23E5FFBFEF1417B7AE4FF3FC15372A65EE95A9580','Exact archived build input required only for reproducing this candidate; installed host font may differ or be absent');
assert(!fs.existsSync(target),'Refusing to overwrite existing source build input');
fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);
console.log('Local build input prepared; exclude this font and compressed variants from distribution.');
