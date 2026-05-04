import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Vector2 } from 'three';

export const DEFAULT_MONOCHROME_CRT_PARAMS = {
  resDiv: 5.0,
  hardScan: -20.0,
  hardPix: -5.0,
  warpX: 1.0 / 32.0,
  warpY: 1.0 / 24.0,
  maskDark: 0.5,
  maskLight: 1.5,
  phosphorAmount: 0.16
};

const MonochromeShader = {
  uniforms: {
    tDiffuse: { value: null },
    tint: { value: new THREE.Color(0xffffff) },
    iResolution: { value: new Vector2(1280, 1280) },
    resDiv: { value: DEFAULT_MONOCHROME_CRT_PARAMS.resDiv },
    hardScan: { value: DEFAULT_MONOCHROME_CRT_PARAMS.hardScan },
    hardPix: { value: DEFAULT_MONOCHROME_CRT_PARAMS.hardPix },
    warpX: { value: DEFAULT_MONOCHROME_CRT_PARAMS.warpX },
    warpY: { value: DEFAULT_MONOCHROME_CRT_PARAMS.warpY },
    maskDark: { value: DEFAULT_MONOCHROME_CRT_PARAMS.maskDark },
    maskLight: { value: DEFAULT_MONOCHROME_CRT_PARAMS.maskLight },
    phosphorAmount: { value: DEFAULT_MONOCHROME_CRT_PARAMS.phosphorAmount },
    iTime: { value: 0 }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 tint;
    uniform vec2 iResolution;
    uniform float resDiv;
    uniform float hardScan;
    uniform float hardPix;
    uniform float warpX;
    uniform float warpY;
    uniform float maskDark;
    uniform float maskLight;
    uniform float phosphorAmount;
    uniform float iTime;
    varying vec2 vUv;

    float ToLinear1(float c){return(c<=0.04045)?c/12.92:pow((c+0.055)/1.055,2.4);}
    vec3 ToLinear(vec3 c){return vec3(ToLinear1(c.r),ToLinear1(c.g),ToLinear1(c.b));}

    float ToSrgb1(float c){return(c<0.0031308?c*12.92:1.055*pow(c,0.41666)-0.055);}
    vec3 ToSrgb(vec3 c){return vec3(ToSrgb1(c.r),ToSrgb1(c.g),ToSrgb1(c.b));}

    vec2 Res(){return iResolution.xy/max(resDiv, 0.0001);}
    float Hash21(vec2 p){
      p=fract(p*vec2(123.34,345.45));
      p+=dot(p,p+34.345);
      return fract(p.x*p.y);
    }
    float Hash31(vec3 p){
      return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
    }

    vec3 Fetch(vec2 pos,vec2 off){
      vec2 res=Res();
      pos=floor(pos*res+off)/res;
      if(max(abs(pos.x-0.5),abs(pos.y-0.5))>0.5)return vec3(0.0,0.0,0.0);
      return ToLinear(texture2D(tDiffuse,pos.xy,-16.0).rgb);}

    vec2 Dist(vec2 pos){vec2 res=Res();pos=pos*res;return -((pos-floor(pos))-vec2(0.5));}
    float Gaus(float pos,float scale){return exp2(scale*pos*pos);}

    vec3 Horz3(vec2 pos,float off){
      vec3 b=Fetch(pos,vec2(-1.0,off));
      vec3 c=Fetch(pos,vec2( 0.0,off));
      vec3 d=Fetch(pos,vec2( 1.0,off));
      float dst=Dist(pos).x;
      float scale=hardPix;
      float wb=Gaus(dst-1.0,scale);
      float wc=Gaus(dst+0.0,scale);
      float wd=Gaus(dst+1.0,scale);
      return (b*wb+c*wc+d*wd)/(wb+wc+wd);}

    vec3 Horz5(vec2 pos,float off){
      vec3 a=Fetch(pos,vec2(-2.0,off));
      vec3 b=Fetch(pos,vec2(-1.0,off));
      vec3 c=Fetch(pos,vec2( 0.0,off));
      vec3 d=Fetch(pos,vec2( 1.0,off));
      vec3 e=Fetch(pos,vec2( 2.0,off));
      float dst=Dist(pos).x;
      float scale=hardPix;
      float wa=Gaus(dst-2.0,scale);
      float wb=Gaus(dst-1.0,scale);
      float wc=Gaus(dst+0.0,scale);
      float wd=Gaus(dst+1.0,scale);
      float we=Gaus(dst+2.0,scale);
      return (a*wa+b*wb+c*wc+d*wd+e*we)/(wa+wb+wc+wd+we);}

    float Scan(vec2 pos,float off){
      float dst=Dist(pos).y;
      return Gaus(dst+off,hardScan);}

    vec3 Tri(vec2 pos){
      vec3 a=Horz3(pos,-1.0);
      vec3 b=Horz5(pos, 0.0);
      vec3 c=Horz3(pos, 1.0);
      float wa=Scan(pos,-1.0);
      float wb=Scan(pos, 0.0);
      float wc=Scan(pos, 1.0);
      return a*wa+b*wb+c*wc;}

    vec2 Warp(vec2 pos){
      pos=pos*2.0-1.0;
      pos*=vec2(1.0+(pos.y*pos.y)*warpX,1.0+(pos.x*pos.x)*warpY);
      return pos*0.5+0.5;}

    vec3 Mask(vec2 pos){
      pos.x+=pos.y*3.0;
      vec3 mask=vec3(maskDark,maskDark,maskDark);
      pos.x=fract(pos.x/6.0);
      if(pos.x<0.333)mask.r=maskLight;
      else if(pos.x<0.666)mask.g=maskLight;
      else mask.b=maskLight;
      return mask;}

    void main() {
      vec2 fragCoord = vUv * iResolution;
      vec2 pos = Warp(fragCoord.xy / iResolution.xy);
      vec3 color = Tri(pos) * Mask(fragCoord.xy);
      float phosphorFrame=floor(iTime*30.0);
      vec3 phosphorDots=vec3(0.0);
      for (int i = 0; i < 7; i++) {
        float idx=float(i);
        vec2 dotPos=vec2(
          Hash21(vec2(phosphorFrame*1.173+11.0, idx*13.17+3.1)),
          Hash21(vec2(phosphorFrame*1.731+29.0, idx*17.73+5.7))
        )*iResolution;
        float dotActive=step(0.84, Hash21(vec2(phosphorFrame+idx*9.7, 91.3)));
        float radius=mix(0.8, 1.9, Hash21(vec2(phosphorFrame+idx*5.3, 44.1)));
        float flash=dotActive*smoothstep(radius, 0.0, length(fragCoord-dotPos));
        phosphorDots+=vec3(flash);
      }
      color+=phosphorDots*phosphorAmount*2.0;
      vec3 srgb = ToSrgb(color);
      float luminance = dot(srgb, vec3(0.299, 0.587, 0.114));
      vec3 tinted = tint * luminance;
      gl_FragColor = vec4(tinted, 1.0);
    }
  `
};

export function createMonochromeCrtPass({ width, height }) {
  const pass = new ShaderPass(MonochromeShader);
  const { uniforms } = pass.material;
  const tintUniform = uniforms.tint;
  const resolutionUniform = uniforms.iResolution;

  function setSize(nextWidth, nextHeight) {
    resolutionUniform.value.set(nextWidth, nextHeight);
  }

  function setParams(params = {}) {
    if (typeof params.resDiv === 'number') uniforms.resDiv.value = params.resDiv;
    if (typeof params.hardScan === 'number') uniforms.hardScan.value = params.hardScan;
    if (typeof params.hardPix === 'number') uniforms.hardPix.value = params.hardPix;
    if (typeof params.warpX === 'number') uniforms.warpX.value = params.warpX;
    if (typeof params.warpY === 'number') uniforms.warpY.value = params.warpY;
    if (typeof params.maskDark === 'number') uniforms.maskDark.value = params.maskDark;
    if (typeof params.maskLight === 'number') uniforms.maskLight.value = params.maskLight;
    if (typeof params.phosphorAmount === 'number') uniforms.phosphorAmount.value = params.phosphorAmount;
  }

  setSize(width, height);
  setParams(DEFAULT_MONOCHROME_CRT_PARAMS);

  return {
    key: 'monochrome',
    label: 'Monochrome CRT',
    pass,
    setSize,
    setParams,
    update(time = 0) {
      uniforms.iTime.value = time;
    },
    setTint(color) {
      if (!color) return;
      if (color.isColor) {
        tintUniform.value.copy(color);
      } else if (typeof color === 'number') {
        tintUniform.value.set(color);
      }
    },
    dispose() {
      pass.dispose();
    }
  };
}
