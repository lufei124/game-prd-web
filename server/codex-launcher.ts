import { writeFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
// Runs only trusted host plumbing before applying the OS sandbox. Imported code never runs here.
export async function createCodexLauncher(
  work: string,
  binary: string,
  profile: string,
) {
  const launcher = join(work, "launch.mjs"),
    wrapper = join(work, "codex-sandbox.sh");
  const temporaryRoot = await realpath(tmpdir());
  await writeFile(
    launcher,
    `import {readFile,writeFile,realpath} from 'node:fs/promises';
import {join,dirname,basename} from 'node:path';
import {spawn} from 'node:child_process';
const work=${JSON.stringify(work)}, args=process.argv.slice(2);
const index=args.indexOf('--output-schema');
if(index>=0){
 const source=await realpath(args[index+1]);
 if(dirname(dirname(source))!==${JSON.stringify(temporaryRoot)} || !basename(dirname(source)).startsWith('codex-output-schema-') || basename(source)!=='schema.json') throw new Error('Unexpected SDK schema location');
 const schema=await readFile(source,'utf8'); if(schema.length>1000000)throw new Error('Schema too large'); JSON.parse(schema);
 const target=join(work,'output-schema.json'); await writeFile(target,schema,{mode:0o600});args[index+1]=target;
}
const child=spawn('/usr/bin/sandbox-exec',['-p',${JSON.stringify(profile)},${JSON.stringify(binary)},...args],{cwd:work,env:process.env,stdio:'inherit'});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
child.on('error',()=>process.exit(1));child.on('exit',(code)=>process.exit(code??1));
`,
    { mode: 0o600 },
  );
  await writeFile(
    wrapper,
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(launcher)} "$@"\n`,
    { mode: 0o700 },
  );
  return wrapper;
}
