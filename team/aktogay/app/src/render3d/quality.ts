/**
 * Качество 3D-графики. «Лёгкий» режим — для машин без видеокарты (программный WebGL:
 * SwiftShader, llvmpipe, «Microsoft Basic Render»): без теней, свечения (bloom), сглаживания,
 * россыпи камней, с частотой кадров до 30.
 *
 * Режим «Авто» включает лёгкий, если WebGL программный или сцена тормозит. Выбор пользователя
 * сохраняется в браузере; ?quality=light|high в адресе имеет приоритет.
 */
export type QualityMode = 'auto' | 'high' | 'light';
export type Quality = 'high' | 'light';

const KEY = 'aktogay.quality';
const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|lavapipe|basic render|software|mesa offscreen|gdi generic/i;

let probe: { available: boolean; software: boolean; renderer: string } | null = null;

/** Один раз создаём WebGL-контекст и смотрим, какой рендерер за ним стоит. */
function probeGL() {
  if (probe) return probe;
  let available = false;
  let renderer = '';
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      available = true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    available = false;
  }
  probe = { available, software: !available || SOFTWARE_GL.test(renderer), renderer };
  return probe;
}

export const webglAvailable = () => probeGL().available;
export const softwareGL = () => probeGL().software;
export const glRenderer = () => probeGL().renderer;

export function loadQualityMode(): QualityMode {
  const q = new URLSearchParams(window.location.search).get('quality');
  if (q === 'light' || q === 'high' || q === 'auto') return q;
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'high' || v === 'auto') return v;
  } catch {
    /* хранилище недоступно */
  }
  return 'auto';
}

export function saveQualityMode(m: QualityMode): void {
  try {
    localStorage.setItem(KEY, m);
  } catch {
    /* без сохранения */
  }
}

/** Итоговое качество: в «Авто» — лёгкое на программном WebGL или после замедления сцены. */
export function resolveQuality(mode: QualityMode, slowDetected: boolean): Quality {
  if (mode !== 'auto') return mode;
  return softwareGL() || slowDetected ? 'light' : 'high';
}
