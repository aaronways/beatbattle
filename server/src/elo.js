// Standard ELO. K=32 for new players, settles to 16 once they've played a bunch.

export function expectedScore(ra, rb) {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

export function kFactor(totalGames) {
  if (totalGames < 10) return 40;
  if (totalGames < 30) return 32;
  return 16;
}

// score: 1 = win, 0.5 = draw, 0 = loss (for player A)
export function applyElo(ratingA, ratingB, scoreA, gamesA, gamesB) {
  const ea = expectedScore(ratingA, ratingB);
  const eb = 1 - ea;
  const ka = kFactor(gamesA);
  const kb = kFactor(gamesB);
  const newA = Math.round(ratingA + ka * (scoreA - ea));
  const newB = Math.round(ratingB + kb * ((1 - scoreA) - eb));
  return { newA, newB, deltaA: newA - ratingA, deltaB: newB - ratingB };
}
