import "./style.css";

// Phase 1 walking-skeleton placeholder. Later issues wire the simulation core
// (src/sim) to the news-feed UI (src/ui) from here. The sim/ <- ui/ boundary is
// firm: sim/ must never import from ui/.
const app = document.querySelector<HTMLDivElement>("#app");

if (app) {
  app.innerHTML = `
    <section class="boot">
      <h1>Starfall</h1>
      <p class="tagline">A sci-fi world generator — seed a sector, watch a history unfold.</p>
      <span class="status">coming online&hellip;</span>
    </section>
  `;
}
