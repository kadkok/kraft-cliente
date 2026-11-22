// Mantém a origem de quem já tem um mundo solo neste aparelho.
if (location.hostname === 'kraft.k14.uk') {
  const q = new URLSearchParams(location.search);
  const online = q.get('partida') === 'multiplayer' || (!q.has('partida') && q.has('mundo'));
  let salvo = true;
  try {
    salvo = Object.keys(localStorage).some((k) => k.startsWith('lavra.off.') || k.startsWith('lavra.fortaleza.'));
  } catch {}
  if (
    !online &&
    !salvo &&
    !q.has('teste') &&
    !q.has('aparelho') &&
    !matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches
  ) {
    location.replace('https://kadkok.github.io/kraft-cliente/' + location.search + location.hash);
  }
}
