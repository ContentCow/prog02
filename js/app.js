// Tabs: show one section at a time.
document.querySelectorAll('nav button').forEach((btn) => {
  btn.onclick = () => {
    for (const name of ['measures', 'compare', 'offices']) {
      document.getElementById('tab-' + name).hidden = (name !== btn.dataset.tab);
    }
  };
});