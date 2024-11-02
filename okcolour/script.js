function expDecay(a, b, decay, dt) {
  return b + (a - b) * Math.exp(-decay * dt);
}

let leftNext = 0;
let rightNext = 0;
function changeColours() {
  leftNext = Math.random() * 200 + 200;
  rightNext = Math.random() * 200 + 200;
}
changeColours();
let leftPrev = leftNext;
let rightPrev = rightNext;
changeColours(); // randomise both
let lastChangeTime = performance.now();
const changeTime = 2000;
const decay = 0.7; // 1 to 25
let lastFrameStart = performance.now();

// state for decay
let leftCur = leftPrev;
let rightCur = rightPrev;
let alpha = 0;

const bg = document.getElementById("bg");

function animLoop() {
  requestAnimationFrame((frameStart) => {
    const dt = frameStart - lastFrameStart;
    if (frameStart - lastChangeTime > changeTime) {
      lastChangeTime += changeTime;
      const leftProgress = (leftNext - leftPrev) / leftNext;
      const rightProgress = (rightNext - rightPrev) / rightNext;
      leftPrev = leftNext;
      rightPrev = rightNext;
      changeColours();
      console.log({
        leftProgress,
        rightProgress,
        leftPrev,
        rightPrev,
        leftNext,
        rightNext,
      });
    }

    leftCur = expDecay(leftCur, leftNext, decay, dt / 1000);
    rightCur = expDecay(rightCur, rightNext, decay, dt / 1000);
    // console.log((leftCur - leftPrev) / (leftNext - leftPrev));
    alpha = Math.min(
      Math.max(
        expDecay(
          alpha,
          Math.min(document.body.scrollTop / 3000, 1),
          10, // decay
          dt / 1000
        ),
        0
      ),
      1
    );

    document.body.style.backgroundImage = `linear-gradient(
      to left,
      oklch(${Math.max(0.5, 1 - alpha) * 100}% ${alpha * 100}% ${leftCur}deg),
      oklch(${Math.max(0.5, 1 - alpha) * 100}% ${alpha * 100}% ${rightCur}deg)
    )
    `;
    lastFrameStart = frameStart;
    animLoop();
  });
}

animLoop();
