// LAVRA — quanto de cada matéria o ar perto da câmera carrega.
// Números puros: o shader só desenha. Vento em m/s, o resto de 0 a 1.

export function leisDaMateria({ wind = [0, 0], rain = 0, fog = 0, cover = 0, night = 0, grass = 0, sand = 0, snow = 0, leaves = 0, open = 1 }) {
  const w = Math.hypot(wind[0] || 0, wind[1] || 0);
  const claro = (1 - cover) * (1 - night);
  const seco = 1 - rain;
  const ar = open;
  return {
    vento: w,
    // pó no sol, mais no vento e na areia, a chuva lava o ar
    poeira: ar * (0.16 + Math.min(1, w / 7) * 0.72 + sand * 0.28) * (0.35 + 0.65 * seco) * (0.45 + 0.55 * (1 - night)),
    // saltação de verdade só passa de um vento moderado
    areia: sand * ar * Math.max(0, Math.min(1, (w - 2.4) / 4.5)),
    folhas: leaves * ar * (0.12 + Math.min(1, Math.max(0, w - 0.35) / 4) * 0.88) * (0.55 + 0.45 * seco),
    reflexo: grass * claro * seco * ar,
    nevoa: Math.max(fog, rain * 0.22) * ar,
    chuva: rain * ar,
    neve: snow * (rain > 0.45 ? 0.08 : 0.55 + fog * 0.35) * ar,
  };
}
