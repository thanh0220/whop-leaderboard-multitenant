(function () {
  var nav = document.querySelector('.nav[data-shared]');
  if (!nav) return;
  var ITEMS = [
    { href: '/', label: '🏆 Leaderboard' },
    { href: '/daily.html', label: '📅 Daily' },
    { href: '/store.html', label: '🎁 Store' },
    { href: '/events.html', label: '🗓 Events' },
    { href: '/mailbox.html', label: '📬 Mailbox' },
    { href: '/milestones.html', label: '🎯 Milestones' },
  ];
  var cur = location.pathname;
  nav.innerHTML = ITEMS.map(function (it) {
    var active = it.href === '/' ? cur === '/' : cur === it.href;
    return '<a href="' + it.href + '"' + (active ? ' class="on"' : '') + '>' + it.label + '</a>';
  }).join('');
})();
