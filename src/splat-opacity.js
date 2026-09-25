import {WORK_BUFFER_MODIFIER_GLSL, WORK_BUFFER_MODIFIER_WGSL} from '@viggle/splat-engine';

// Characters represent solid surfaces. Increase optical density without making tiny
// reconstruction outliers opaque. Preserve the engine's animation and lighting code.
export function solidCharacter(character, density=2.5) {
  const glsl=WORK_BUFFER_MODIFIER_GLSL.replace('void modifySplatColor(vec3 center, inout vec4 color) {', `void modifySplatColor(vec3 center, inout vec4 color) {
#ifdef GSPLAT_CENTER_NOPROJ
color.a = 1.0 - pow(1.0 - clamp(color.a, 0.0, 1.0), ${density.toFixed(2)});
#endif`);
  const wgsl=WORK_BUFFER_MODIFIER_WGSL.replace('fn modifySplatColor(center: vec3f, color: ptr<function, vec4f>) {', `fn modifySplatColor(center: vec3f, color: ptr<function, vec4f>) {
#ifdef GSPLAT_CENTER_NOPROJ
(*color).a = 1.0 - pow(1.0 - clamp((*color).a, 0.0, 1.0), ${density.toFixed(2)});
#endif`);
  for(const splat of character.splats){
    const defines=splat.splatWeights?'#define USE_BONE_BLENDING\n':'';
    splat.entity.gsplat.setWorkBufferModifier({glsl:defines+glsl,wgsl:defines+wgsl});
  }
}
