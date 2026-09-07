// Opt-in native compiler regression. Requires installed Tidal; run with audio idle.
import assert from 'node:assert/strict';
import { Tidal } from './dist/tidal.js';
import { assertAudioPortsFree } from './dist/engine.js';
import { preparedBatch, preparedCode, parseCycle } from './dist/performance.js';
import { emptyProject, applyEdits } from './dist/project.js';
import { pocketGroove } from './dist/studio-starter.js';
import { compileClip } from './dist/project-compiler.js';
import { defaults, instruments } from './dist/sound-lab.js';
import { defaultPlayback } from './dist/sampling.js';

await assertAudioPortsFree();
const tidal = new Tidal();
try {
  tidal.start();
  await tidal.waitConnected();
  assert.ok(Number.isFinite(await tidal.clock()));
  await tidal.eval(preparedCode('silence -- retained user comment'), 'native-managed-code');
  let project = emptyProject(); project = applyEdits(project, pocketGroove(project));
  const clip = project.clips[0], track = project.tracks[0];
  clip.playback = { ...defaultPlayback(), reverse: true, pitch: 7 };
  clip.parameters.speed = -0.5;
  await tidal.eval(preparedCode(compileClip(project, clip)), 'native-negative-sample-speed');
  delete clip.playback; delete clip.parameters.speed;
  track.source = {type:'synth',definitionId:'dirtymono',version:1,values:defaults(instruments[0])};
  track.modulation = [{id:'native_negative_motion',target:'synth.cutoff',source:'lfo',rate:1,amount:-0.25,enabled:true}];
  project.jam = {locks:[],macros:[{id:'native_negative_macro',name:'Negative',value:-1,enabled:true,targets:[{trackId:track.id,parameter:'synth.cutoff',amount:0.2}]}]};
  await tidal.eval(preparedCode(compileClip(project, clip)), 'native-negative-synth-motion');
  const result = await tidal.eval(preparedBatch({}, 'cycle'), 'native-empty-scene');
  assert.ok(Number.isInteger(parseCycle(result.output, 'ABX_SCHEDULED')));
  await assert.rejects(tidal.eval(preparedBatch({d1: 'missingNativeAcceptancePattern'}, 'cycle')));
  // A compiler rejection cannot poison the lock or erase the installed helper.
  const next = await tidal.eval(preparedBatch({}, 'immediate'), 'native-after-rejection');
  assert.ok(Number.isFinite(parseCycle(next.output, 'ABX_SCHEDULED')));
  await tidal.hush();
  console.log('TIDAL NATIVE PASS: boot imports, helper compilation, clock, cycle/immediate batch, compiler rejection and recovery.');
} catch (error) {
  console.error(tidal.tail(16000));
  throw error;
} finally {
  tidal.stop();
}
