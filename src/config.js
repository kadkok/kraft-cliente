// LAVRA — perfis de qualidade e detecção de aparelho. Dado, não lógica de jogo.

export function detectDevice() {
  const ua = navigator.userAgent || '';
  const quest = /OculusBrowser|Quest|Pico/i.test(ua);
  const touch = (navigator.maxTouchPoints || 0) > 1 || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && touch);
  const mobile = quest || ios || /Android/i.test(ua);
  return { quest, touch: touch && !quest, ios, mobile, cores: navigator.hardwareConcurrency || 4 };
}

// distance = raio de visão em chunks; dpr = teto da densidade de pixels
export const QUALITY = {
  // shadow: mapa de sombra do sol { size = resolução, radius = alcance em metros, every = refaz a cada N quadros, taps = amostras da penumbra, soft = raio dela em texels }
  // pbr: relevo e brilho · post: pós-processamento { msaa, bloom = força, rays = raios de sol } (null = os shaders fecham a imagem)
  // trails: desenha as trilhas no chão macio (nature/trails.js)
  // rt: luz de perto { size = caixa de voxels em volta da câmera (múltiplos de 16 em x/z e de 8 em y), range = alcance útil em metros };
  //     null = sem campo (docs/luz-de-perto.md: raio só se traça perto de quem olha, e só nos perfis que aguentam)
  // waves: faixas da água. 1 cabe no visor, 2 no celular e no iPad, 3 no PC.
  baixa: { name: 'baixa', distance: 5, dpr: 1, detail: false, cloudShadows: false, cloudOct: 2, aniso: 1, workers: 2, uploadsPerFrame: 2, texSize: 64, antialias: false, shadow: null, pbr: false, post: null, trails: false, rt: null, waves: 1 },
  media: { name: 'media', distance: 7, dpr: 1.5, detail: true, cloudShadows: false, cloudOct: 3, aniso: 4, workers: 3, uploadsPerFrame: 3, texSize: 128, antialias: true, shadow: { size: 1024, radius: 64, every: 3, taps: 4, soft: 1.5 }, pbr: true, post: { msaa: 4, bloom: 0.42, rays: false }, trails: true, rt: { size: [96, 48, 96], range: 24 }, waves: 2 },
  alta: { name: 'alta', distance: 10, dpr: 2, detail: true, cloudShadows: true, cloudOct: 3, aniso: 8, workers: 4, uploadsPerFrame: 4, texSize: 256, antialias: true, shadow: { size: 2048, radius: 100, every: 2, taps: 8, soft: 2.4 }, pbr: true, post: { msaa: 4, bloom: 0.5, rays: true }, trails: true, rt: { size: [128, 64, 128], range: 40 }, waves: 3 },
};

// Realismo (19/11/2026; referência do Kadmus: screen.toys/firewood; aprovado por ele no mesmo dia: "ficou excelente a
// terra e a iluminação e o foco"). Ligado por padrão no PC, perfil alto. Desliga na pausa ("Realismo") ou com `?real=0`;
// celular, iPad e visor nunca ligam. O que cada parte faz está em docs/realismo.md.
//   shadowNear: segundo mapa de sombra, justo em volta de quem olha { size, radius (m), penumbra = tangente do raio
//               aparente do sol: quanto a borda da sombra abre por metro de distância até quem a projeta }
//   relva: lâminas de grama de verdade sobre o gramado { raio (m), porMetro = lâminas por m² junto de quem olha }
//   camera: { tom: 'neutro' = curva que preserva a cor do material · foco = abertura da lente (0 = tudo nítido) }
//   luz: balanço sol × céu da prova (atmosphere.js)
export const REAL = {
  shadowNear: { size: 4096, radius: 14, penumbra: 0.0105 },
  relva: { raio: 22, porMetro: 170 },
  camera: { tom: 'neutro', foco: 0.75 },
  luz: { sol: 2.7, ceu: 0.88 },
};

// O perfil que o jogo escolhe sozinho para o aparelho (ajuste "Qualidade: Automática").
export const perfilDoAparelho = (device) => (device.quest ? 'baixa' : device.mobile ? 'media' : 'alta');

// `ajustes` = os ajustes guardados de quem joga (settings): além do perfil, a pessoa pode desligar partes pesadas no
// próprio aparelho (tabela AJUSTES, abaixo). Desligar é sempre um estado que algum perfil já usa (`null`), nunca um novo.
export function pickQuality(device, wanted, ajustes) {
  const base = QUALITY[wanted] || QUALITY[perfilDoAparelho(device)];
  const q = { ...base };
  q.workers = Math.max(1, Math.min(q.workers, device.cores - 1));
  if (device.quest) { q.antialias = true; q.distance = Math.min(q.distance, 6); q.shadow = { size: 1024, radius: 36, every: 4, taps: 2, soft: 1.2 }; q.post = null; q.rt = null; q.waves = 1;
    q.texSize = Math.max(q.texSize, 128); }   // 19/11: com o chão e a casca de foto ao lado, a folha e o bloco de 64 px destoavam no visor // no visor o MSAA é barato e faz falta. Sombra (17/11): sem ela o VR ficava chapado; um mapa pequeno, perto, refeito a cada 4 quadros e o regulador (game/vr-desempenho.js) a desliga quando aperta
  // Celular e iPad: a mesma leitura da água, com menos pixels. A tela do iPad é grande.
  if (device.mobile && !device.quest) {
    q.distance = Math.min(q.distance, device.ios ? 6 : 7);
    q.dpr = Math.min(q.dpr, 1.25);
    q.waves = Math.min(q.waves || 2, 2);
    if (q.post) q.post = { ...q.post, msaa: 2, rays: false, bloom: Math.min(q.post.bloom ?? 0.4, 0.32) };
    if (q.shadow) q.shadow = { ...q.shadow, size: Math.min(q.shadow.size, 1024), every: Math.max(q.shadow.every || 1, 4), taps: Math.min(q.shadow.taps || 4, 4) };
    if (q.rt) q.rt = { size: [64, 32, 64], range: Math.min(q.rt.range || 24, 16) };
  }
  if (ajustes) for (const a of AJUSTES) if (a.aplica) a.aplica(q, ajustes[a.chave], device);
  return q;
}

// ---- ajustes do aparelho ---------------------------------------------------------------------
// A seção "Este aparelho" da pausa (game/cliente.js) é montada a partir desta tabela: cada linha é um ajuste que quem
// joga escolhe para o aparelho dele e que fica guardado nele (`lavra.cfg`, junto dos outros). Para a frente visual:
// ajuste novo = uma linha aqui (e o valor padrão em SETTINGS_DEFAULT); perfil novo em QUALITY (ex.: `ultra`) aparece
// sozinho na lista de qualidade.
//   chave    onde fica em settings
//   rotulo   o que a pessoa lê
//   tipo     'escolha' (opcoes(device) → [[valor, texto], …]) ou 'liga' (caixa de marcar)
//   aplica   (q, valor, device) → muda o perfil já escolhido; só para ajuste de qualidade
//   Todos valem ao recarregar o jogo (os shaders e o laço são montados na partida): a tela guarda e oferece "Aplicar".
const NOME_PERFIL = { baixa: 'Baixa', media: 'Média', alta: 'Alta', ultra: 'Ultra' };
export const nomeDoPerfil = (k) => NOME_PERFIL[k] || (k.charAt(0).toUpperCase() + k.slice(1));
export const AJUSTES = [
  { chave: 'quality', rotulo: 'Qualidade', tipo: 'escolha',
    opcoes: (device) => [['auto', `Automática (${nomeDoPerfil(perfilDoAparelho(device))} neste aparelho)`], ...Object.keys(QUALITY).map((k) => [k, nomeDoPerfil(k)])] },
  // teto de quadros: nunca acima de 60 (20/11: sem teto a placa de vídeo do PC ia ao limite de potência e travou)
  { chave: 'fps', rotulo: 'Limite de quadros por segundo', tipo: 'escolha',
    opcoes: (device) => [[0, `Automático (${device.mobile && !device.quest ? 30 : 60})`], [30, '30'], [60, '60']] },
  { chave: 'sombras', rotulo: 'Sombras', tipo: 'liga', aplica: (q, v) => { if (v === false) q.shadow = null; } },
  { chave: 'efeitos', rotulo: 'Efeitos de imagem (brilho, raios de sol)', tipo: 'liga', aplica: (q, v) => { if (v === false) q.post = null; } },
];

export const SETTINGS_DEFAULT = {
  quality: 'auto',
  distance: 0,          // 0 = o do perfil
  fov: 72,
  sensitivity: 1,
  invertY: false,
  volume: 0.6,
  music: 0.5,           // volume da música (0 = sem música)
  autoJump: null,       // null = ligado no toque e no VR
  snapTurn: true,
  real: true,           // realismo no PC (relva, sombra de perto, chão e casca escaneados, lente): config.js → REAL
  fps: 0,               // limite de quadros escolhido por quem joga (0 = o do aparelho: 60 no PC, 30 no celular)
  sombras: true,        // false = sem mapa de sombra, seja qual for o perfil
  efeitos: true,        // false = sem pós-processamento (o caminho direto, o mesmo do visor e do &post=0)
};

export function loadSettings() {
  try { return { ...SETTINGS_DEFAULT, ...JSON.parse(localStorage.getItem('lavra.cfg') || '{}') }; }
  catch { return { ...SETTINGS_DEFAULT }; }
}
export function saveSettings(s) {
  try { localStorage.setItem('lavra.cfg', JSON.stringify(s)); } catch { /* armazenamento indisponível */ }
}
