// Hero demo: one key counts down, then is destroyed.
(function () {
  const clock = document.getElementById('demoClock'), chip = document.getElementById('demoChip');
  if (!clock || !chip) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const START = 12;
  let left = START, t;
  const fmt = s => '00:' + String(s).padStart(2, '0');
  function reset() { left = START; clock.className = 'clock'; clock.textContent = fmt(left); chip.className = 'chip ok'; chip.textContent = 'Active'; if (!reduce) t = setInterval(step, 1000); }
  function step() {
    left--;
    clock.textContent = fmt(Math.max(left, 0));
    if (left <= 0) { clearInterval(t); clock.className = 'clock dead'; clock.textContent = 'Destroyed'; chip.className = 'chip bad'; chip.textContent = 'Expired'; setTimeout(reset, 5000); }
  }
  reset();
})();
