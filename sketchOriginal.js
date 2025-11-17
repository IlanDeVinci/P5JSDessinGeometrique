let NP = 480;
let centerX = NP / 2;
let centerY = NP / 2;

function setup() {
  createCanvas(NP, NP);
  background(255);
  stroke(0);
  strokeWeight(1);
  noFill();

  drawCourbesTournantes();

  noLoop();
}

function drawCourbesTournantes() {
  let N = 2000;
  let T1 = 0.5;
  let T2 = 50;
  let H1 = 1,
    H2 = 2;
  let K1 = 1,
    K2 = 2;
  let R1 = NP / 7;
  let R2 = NP / 4;

  beginShape();
  for (let i = 0; i <= N; i++) {
    let AN = (TWO_PI * i) / N;
    let S = 1;
    let C1 = cos(H1 * AN * T1);
    let S1 = sin(H2 * AN * T1);
    let C2 = cos(K1 * AN * T2);
    let S2 = sin(K2 * AN * T2);

    let r2s = R2 * S;
    let x = centerX + R1 * C1 + r2s * (C1 * C2 - S1 * S2);
    let y = centerY + R1 * S1 + r2s * (S1 * C2 + C1 * S2);
    vertex(x, y);
  }
  endShape();
}
