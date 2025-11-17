let NP = 800; // de 580 à 800 : Taille du canevas augmentée pour mieux voir les détails
let centerX = NP / 2; // centre X du canevas
let centerY = NP / 2; // centre Y du canevas

function setup() {
  INIT(); // init_trace : crée un canevas de 800x800 pixels
  background_(255); // fond blanc
  stroke_([125, 0, 100]); // de 0 à (125, 0, 100) : Change la couleur de la courbe de noir à mauve
  strokeWeight(1);
  noFill_();

  drawCourbesTournantes();
}

function drawCourbesTournantes() {
  let N = 10000; // de 2000 à 10000 : Plus grand nombre de points pour une courbe plus lisse
  let T1 = -0.5; // de 0.5 à -0.5 : Inverse le sens de rotation de la courbe
  let T2 = 100; // de 50 à 100 : Augmente la densité de la courbe
  let H1 = 3, // de 2 à 3 : Change la forme globale de la courbe
    H2 = 2;
  let K1 = 1.5, // de 1 à 1.5 : Change les oscillations de la courbe
    K2 = 3; // de 2 à 3 : Change les oscillations de la courbe
  let R1 = NP / 10; // de NP/7 à NP/10 : Réduit le rayon de la courbe pour qu'elle tienne dans le canevas
  let R2 = NP / 5; // de NP/4 à NP/5 : Réduit le rayon des oscillations pour une courbe plus compacte

  beginShape_();
  for (let i = 0; i <= N; i++) {
    let AN = (TWO_PI * i) / N;
    let S = 1 + 0.25 * sin(AN * 5); // de S = 1 à S = 1 + 0.2 * sin(AN * 5) : Ajoute une variation dynamique au rayon des oscillations pour une forme moins symmétrique
    let C1 = cos(H1 * AN * T1);
    let S1 = sin(H2 * AN * T1);
    let C2 = cos(K1 * AN * T2);
    let S2 = sin(K2 * AN * T2);

    let r2s = R2 * S;
    let x = centerX + R1 * C1 + r2s * (C1 * C2 - S1 * S2);
    let y = centerY + R1 * S1 + r2s * (S1 * C2 + C1 * S2);
    vertex_(x, y);
  }
  endShape_();
}
