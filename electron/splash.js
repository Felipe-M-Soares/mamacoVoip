'use strict'
// Monta o anel de pontinhos e deixa o processo principal trocar a tela
// pro modo "Atualizando..." (window.mvSetUpdating(percentual)).
;(function () {
  var dots = document.querySelector('.dots')
  var N = 12
  for (var i = 0; i < N; i++) {
    var d = document.createElement('i')
    d.style.setProperty('--a', (i * 360) / N + 'deg')
    d.style.setProperty('--o', String(0.2 + (0.8 * (i + 1)) / N))
    dots.appendChild(d)
  }
  window.mvSetUpdating = function (pct) {
    document.body.classList.add('updating')
    document.querySelector('.label').textContent = 'Atualizando o Mamacos Voip...'
    document.querySelector('.pct').textContent = pct >= 0 ? pct + '%' : ''
  }
})()
